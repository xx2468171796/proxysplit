package accel

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"strings"
	"testing"
	"time"

	utls "github.com/refraction-networking/utls"
)

// clientHello is a parsed ClientHello with the random parts (random, session ID,
// key-share keys) set aside, so two captures of the same client compare equal.
type clientHello struct {
	recordLen   int
	version     []byte
	sessionLen  int
	ciphers     []byte
	compression []byte
	extensions  []tlsExt
}

type tlsExt struct {
	typ  uint16
	data []byte // key_share (51): only the group IDs and key lengths
}

func parseClientHello(t *testing.T, rec []byte) clientHello {
	t.Helper()
	r := bytes.NewReader(rec)
	next := func(n int) []byte {
		b := make([]byte, n)
		if _, err := io.ReadFull(r, b); err != nil {
			t.Fatalf("ClientHello truncated: %v", err)
		}
		return b
	}
	u8 := func() int { return int(next(1)[0]) }
	u16 := func() int { return int(binary.BigEndian.Uint16(next(2))) }
	var h clientHello
	if next(1)[0] != 0x16 {
		t.Fatal("not a handshake record")
	}
	next(2)
	h.recordLen = u16()
	if u8() != 1 {
		t.Fatal("not a ClientHello")
	}
	next(3)
	h.version = next(2)
	next(32) // random
	h.sessionLen = u8()
	next(h.sessionLen)
	h.ciphers = next(u16())
	h.compression = next(u8())
	ext := bytes.NewReader(next(u16()))
	for ext.Len() > 0 {
		var hdr [4]byte
		_, _ = io.ReadFull(ext, hdr[:])
		data := make([]byte, binary.BigEndian.Uint16(hdr[2:]))
		_, _ = io.ReadFull(ext, data)
		e := tlsExt{typ: binary.BigEndian.Uint16(hdr[:2]), data: data}
		if e.typ == 51 {
			var shape []byte
			ks := data[2:]
			for len(ks) >= 4 {
				n := int(binary.BigEndian.Uint16(ks[2:4]))
				shape = append(shape, ks[:4]...)
				ks = ks[4+n:]
			}
			e.data = shape
		}
		h.extensions = append(h.extensions, e)
	}
	return h
}

// The fallback handshake must match a real Claude Code ClientHello byte for byte
// apart from random values (captured by cc-watch from the official client, SNI localhost).
func TestFallbackHelloMatchesOfficialClaudeCode(t *testing.T) {
	raw, err := os.ReadFile("testdata/claude-code-2.1.306-clienthello.hex")
	if err != nil {
		t.Fatal(err)
	}
	official, err := hex.DecodeString(strings.TrimSpace(string(raw)))
	if err != nil {
		t.Fatal(err)
	}

	c, s := net.Pipe()
	defer s.Close()
	go func() {
		tc := utls.UClient(c, &utls.Config{ServerName: "localhost", NextProtos: []string{"http/1.1"}}, utls.HelloCustom)
		if err := tc.ApplyPreset(claudeHelloSpec()); err != nil {
			c.Close()
			return
		}
		_ = c.SetDeadline(time.Now().Add(5 * time.Second))
		_ = tc.Handshake()
	}()
	_ = s.SetDeadline(time.Now().Add(5 * time.Second))
	var hdr [5]byte
	if _, err := io.ReadFull(s, hdr[:]); err != nil {
		t.Fatal(err)
	}
	body := make([]byte, binary.BigEndian.Uint16(hdr[3:]))
	if _, err := io.ReadFull(s, body); err != nil {
		t.Fatal(err)
	}
	ours := parseClientHello(t, append(hdr[:], body...))
	want := parseClientHello(t, official)

	if ours.recordLen != want.recordLen || !bytes.Equal(ours.version, want.version) || ours.sessionLen != want.sessionLen {
		t.Errorf("record %d/%d, version %x/%x, session id %d/%d (ours/official)",
			ours.recordLen, want.recordLen, ours.version, want.version, ours.sessionLen, want.sessionLen)
	}
	if !bytes.Equal(ours.ciphers, want.ciphers) || !bytes.Equal(ours.compression, want.compression) {
		t.Errorf("cipher suites\n ours     %x\n official %x", ours.ciphers, want.ciphers)
	}
	if len(ours.extensions) != len(want.extensions) {
		t.Fatalf("extension count %d, official %d: ours %v official %v", len(ours.extensions), len(want.extensions), types(ours), types(want))
	}
	for i, e := range want.extensions {
		o := ours.extensions[i]
		if o.typ != e.typ || !bytes.Equal(o.data, e.data) {
			t.Errorf("extension #%d: ours %d %x, official %d %x", i, o.typ, o.data, e.typ, e.data)
		}
	}
}

func types(h clientHello) []uint16 {
	var out []uint16
	for _, e := range h.extensions {
		out = append(out, e.typ)
	}
	return out
}

// fallbackHandshake must equal the relay's handshake fingerprint (sub2api accel
// TlsProfile::handshake_sha256: sorted compact JSON without "name") of the
// profile that claudeHelloSpec reproduces — a copy of the relay's stable profile.
func TestFallbackHandshakeIsRelayProfileFingerprint(t *testing.T) {
	raw, err := os.ReadFile("testdata/claude-code-2.1.302-profile.json")
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	delete(m, "name")
	canon, _ := json.Marshal(m) // map keys marshal sorted, no whitespace — same as serde_json
	if got := fmt.Sprintf("%x", sha256.Sum256(canon)); got != fallbackHandshake {
		t.Fatalf("fallbackHandshake = %s, profile fingerprint %s", fallbackHandshake, got)
	}
}
