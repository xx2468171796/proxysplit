package capture

import (
	"encoding/binary"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// associateSOCKS is a SOCKS5 server that only answers UDP ASSOCIATE and
// reports every datagram relayed to it as "dst|payload".
func associateSOCKS(t *testing.T) (int, <-chan string) {
	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	got := make(chan string, 64)
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				b := make([]byte, 262)
				if _, err := io.ReadFull(c, b[:2]); err != nil {
					return
				}
				_, _ = io.ReadFull(c, b[:b[1]])
				_, _ = c.Write([]byte{5, 0})
				if _, err := io.ReadFull(c, b[:10]); err != nil || b[1] != 3 {
					return
				}
				relay, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
				if err != nil {
					return
				}
				defer relay.Close()
				reply := []byte{5, 0, 0, 1, 127, 0, 0, 1, 0, 0}
				binary.BigEndian.PutUint16(reply[8:], uint16(relay.LocalAddr().(*net.UDPAddr).Port))
				_, _ = c.Write(reply)
				go func() {
					buf := make([]byte, 2048)
					for {
						n, _, err := relay.ReadFromUDP(buf)
						if err != nil {
							return
						}
						if dst, payload, err := DecodeUDPHeader(buf[:n]); err == nil {
							got <- dst.String() + "|" + string(payload)
						}
					}
				}()
				_, _ = io.Copy(io.Discard, c) // the association lives as long as the control connection
			}(c)
		}
	}()
	return ln.Addr().(*net.TCPAddr).Port, got
}

// TestEngineRelaysFirstUDPDatagram: a selected program that creates a UDP
// socket and sends at once (implicit bind, the race the old bind-event
// registration lost) must have that very first datagram relayed.
// Needs admin rights and the driver files in bin/:
// PROXYSPLIT_CAPTURE_IT=1 go test ./internal/capture -run EngineRelaysFirstUDP -v
func TestEngineRelaysFirstUDPDatagram(t *testing.T) {
	if os.Getenv("PROXYSPLIT_CAPTURE_IT") != "1" {
		t.Skip("set PROXYSPLIT_CAPTURE_IT=1 (admin + bin/WinDivert*.{dll,sys})")
	}
	dll, _ := filepath.Abs(filepath.Join("..", "..", "bin", "WinDivert.dll"))
	port, got := associateSOCKS(t)
	// powershell.exe plays the listed program: one socket, one datagram, exit.
	eng, err := Start(Options{DLLPath: dll, Log: func(s string) { t.Log(s) }}, &Routes{Apps: map[string]int{"powershell.exe": port}})
	if err != nil {
		t.Fatal(err)
	}
	defer eng.Stop()
	send := `$u=[Net.Sockets.UdpClient]::new(); [void]$u.Send([byte[]](102,105,114,115,116),5,'192.0.2.55',4433)`
	for round := 1; round <= 3; round++ { // a fresh socket (new port) each time
		if out, err := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", send).CombinedOutput(); err != nil {
			t.Fatalf("sender failed: %v %s", err, out)
		}
		select {
		case d := <-got:
			if d != "192.0.2.55:4433|first" {
				t.Fatalf("round %d: relayed %q", round, d)
			}
		case <-time.After(5 * time.Second):
			t.Fatalf("round %d: the first datagram of a new socket was not relayed (it left directly or was lost)", round)
		}
	}
}
