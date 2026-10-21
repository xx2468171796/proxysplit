package accel

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
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

	spec, err := mustProfile(t, relayProfile(t)).spec()
	if err != nil {
		t.Fatal(err)
	}
	c, s := net.Pipe()
	defer s.Close()
	go func() {
		tc := utls.UClient(c, &utls.Config{ServerName: "localhost", NextProtos: []string{"http/1.1"}}, utls.HelloCustom)
		if err := tc.ApplyPreset(spec); err != nil {
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

// relayProfile is the relay's stable handshake profile since Claude Code 2.1.302
// (/var/lib/accel/tls-profile-stable.json on the relays).
func relayProfile(t *testing.T) []byte {
	t.Helper()
	raw, err := os.ReadFile("testdata/claude-code-2.1.302-profile.json")
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func mustProfile(t *testing.T, raw []byte) *tlsProfile {
	t.Helper()
	hs, err := handshakeSHA256(raw)
	if err != nil {
		t.Fatal(err)
	}
	p, err := parseProfile(raw, hs)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

// Same value as sub2api accel tls_profile.rs handshake_sha256_ignores_name: both
// sides canonicalise the profile the same way, so the signed hs matches.
func TestHandshakeSHA256MatchesRelay(t *testing.T) {
	hs, err := handshakeSHA256(relayProfile(t))
	if err != nil {
		t.Fatal(err)
	}
	if hs != "538b268b4fe30bacce5110b34cd963b9f545c3934a2f183097fe32ad54b0406d" {
		t.Fatalf("fingerprint %s differs from the relay's", hs)
	}
}

// Anything the client can't reproduce exactly turns the fallback off.
func TestParseProfileRejectsWhatItCannotReproduce(t *testing.T) {
	base := relayProfile(t)
	hs, _ := handshakeSHA256(base)
	if _, err := parseProfile(base, strings.Repeat("0", 64)); err == nil {
		t.Error("profile not matching the signed fingerprint accepted")
	}
	if _, err := parseProfile(nil, hs); err == nil {
		t.Error("missing profile accepted")
	}
	for name, edit := range map[string]func(map[string]any){
		"unknown field":  func(m map[string]any) { m["ech_grease"] = true },
		"unknown cipher": func(m map[string]any) { m["ciphers"] = m["ciphers"].(string) + ":NEW-CIPHER" },
		"unknown group":  func(m map[string]any) { m["curves"] = "X25519MLKEM1024:X25519" },
		"unknown sigalg": func(m map[string]any) { m["sigalgs"] = "mldsa65:" + m["sigalgs"].(string) },
		"grease":         func(m map[string]any) { m["grease"] = true },
		"permute":        func(m map[string]any) { m["permute_extensions"] = true },
		"h2":             func(m map[string]any) { m["alpn"] = []any{"h2", "http/1.1"} },
		"tls 1.3 only":   func(m map[string]any) { m["min_version"] = "1.3" },
		"format v2":      func(m map[string]any) { m["v"] = 2 },
	} {
		var m map[string]any
		_ = json.Unmarshal(base, &m)
		edit(m)
		raw, _ := json.Marshal(m)
		h, _ := handshakeSHA256(raw)
		if _, err := parseProfile(raw, h); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	// a pure config change the client knows (e.g. 2.1.302 adding ed25519) is followed without a release
	var m map[string]any
	_ = json.Unmarshal(base, &m)
	m["sigalgs"] = "ed25519:" + m["sigalgs"].(string)
	raw, _ := json.Marshal(m)
	if p := mustProfile(t, raw); !strings.HasPrefix(p.Sigalgs, "ed25519:") {
		t.Error("known config change not followed")
	}
}
