package service

import (
	"net"
	"testing"
	"time"
)

// fakeDNS answers every query with the given answer count (rcode 0).
func fakeDNS(t *testing.T, answers byte) string {
	t.Helper()
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pc.Close() })
	go func() {
		buf := make([]byte, 1500)
		for {
			n, addr, err := pc.ReadFrom(buf)
			if err != nil {
				return
			}
			resp := append([]byte{}, buf[:n]...)
			resp[2] |= 0x80 // QR
			resp[3] = 0     // rcode 0
			resp[7] = answers
			_, _ = pc.WriteTo(resp, addr)
		}
	}()
	return pc.LocalAddr().String()
}

// TestLookupA: the tunnel probe passes only on an answer with records, and
// fails fast on silence (the strict-route case that broke AI before).
func TestLookupA(t *testing.T) {
	if !lookupA(fakeDNS(t, 1), "api.anthropic.com", time.Second) {
		t.Fatal("answer with a record must pass")
	}
	if lookupA(fakeDNS(t, 0), "api.anthropic.com", time.Second) {
		t.Fatal("empty answer must fail")
	}
	silent, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer silent.Close()
	start := time.Now()
	if lookupA(silent.LocalAddr().String(), "api.anthropic.com", 300*time.Millisecond) {
		t.Fatal("no answer must fail")
	}
	if time.Since(start) > 2*time.Second {
		t.Fatal("probe must respect its timeout")
	}
}
