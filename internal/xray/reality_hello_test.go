package xray

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"proxysplit/internal/nodes"
)

// groupMLKEM is X25519MLKEM768 (TLS named group 0x11ec).
const groupMLKEM = 0x11ec

// TestRealityChromeSendsMLKEM runs the real xray (socks inbound → vless +
// REALITY, fingerprint chrome) against a local TCP listener and checks the
// captured ClientHello offers X25519MLKEM768 in supported_groups and
// key_share.
func TestRealityChromeSendsMLKEM(t *testing.T) {
	bin := xrayBin(t)
	for _, fp := range []string{"chrome", "firefox", "safari", "edge", "random"} {
		groups, shares := realityHello(t, bin, fp)
		t.Logf("fp=%s supported_groups=%x key_share=%x", fp, groups, shares)
		if fp == "chrome" && (!contains(groups, groupMLKEM) || !contains(shares, groupMLKEM)) {
			t.Errorf("chrome ClientHello lacks X25519MLKEM768: groups=%x shares=%x", groups, shares)
		}
	}
}

func realityHello(t *testing.T, bin, fp string) (groups, shares []uint16) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	hello := make(chan []byte, 1)
	go captureHello(ln, hello)
	n := &nodes.Node{ID: "r", Type: "vless", Server: "127.0.0.1", Port: ln.Addr().(*net.TCPAddr).Port,
		UUID: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", Security: "reality", SNI: "www.microsoft.com",
		Fingerprint: fp, PublicKey: "Z84J2IelR9ch3k8VtlVhhs5ycBUlXA7wHBWcBrjqnAw", ShortID: "6ba85179e30d4fc2", Network: "tcp"}
	socks := freeTestPort(t)
	cmd := startXray(t, bin, n, socks)
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	go socksConnect(socks, "example.com", 443)
	select {
	case b := <-hello:
		return parseHello(t, b)
	case <-time.After(10 * time.Second):
		t.Fatalf("fp=%s: no ClientHello captured", fp)
	}
	return nil, nil
}

func startXray(t *testing.T, bin string, n *nodes.Node, socks int) *exec.Cmd {
	t.Helper()
	ob, err := Outbound(n, "out")
	if err != nil {
		t.Fatal(err)
	}
	cfg := M{
		"log":       M{"loglevel": "warning"},
		"inbounds":  []M{{"listen": "127.0.0.1", "port": socks, "protocol": "socks", "settings": M{"auth": "noauth"}}},
		"outbounds": []M{ob},
	}
	raw, _ := json.Marshal(cfg)
	path := filepath.Join(t.TempDir(), "xray.json")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(bin, "run", "-c", path)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if c, err := net.Dial("tcp", "127.0.0.1:"+strconv.Itoa(socks)); err == nil {
			c.Close()
			return cmd
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("xray socks inbound did not come up")
	return nil
}

func captureHello(ln net.Listener, out chan<- []byte) {
	c, err := ln.Accept()
	if err != nil {
		return
	}
	defer c.Close()
	_ = c.SetReadDeadline(time.Now().Add(10 * time.Second))
	hdr := make([]byte, 5)
	if _, err := io.ReadFull(c, hdr); err != nil || hdr[0] != 0x16 {
		return
	}
	body := make([]byte, binary.BigEndian.Uint16(hdr[3:5]))
	if _, err := io.ReadFull(c, body); err != nil {
		return
	}
	out <- body
}

// socksConnect does a no-auth SOCKS5 CONNECT and sends a byte so the
// outbound dials.
func socksConnect(port int, host string, dport int) {
	c, err := net.DialTimeout("tcp", "127.0.0.1:"+strconv.Itoa(port), 3*time.Second)
	if err != nil {
		return
	}
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(10 * time.Second))
	_, _ = c.Write([]byte{5, 1, 0})
	buf := make([]byte, 262)
	if _, err := io.ReadFull(c, buf[:2]); err != nil {
		return
	}
	req := append([]byte{5, 1, 0, 3, byte(len(host))}, host...)
	req = append(req, byte(dport>>8), byte(dport))
	_, _ = c.Write(req)
	_, _ = c.Read(buf)
	_, _ = c.Write([]byte("GET / HTTP/1.1\r\n\r\n"))
	_, _ = c.Read(buf)
}

// parseHello walks a ClientHello handshake message to extensions 10 / 51.
func parseHello(t *testing.T, b []byte) (groups, shares []uint16) {
	t.Helper()
	r := reader{b: b}
	if r.u8() != 1 { // handshake type client_hello
		t.Fatal("not a ClientHello")
	}
	r.skip(3 + 2 + 32)   // length, version, random
	r.skip(int(r.u8()))  // session id
	r.skip(int(r.u16())) // cipher suites
	r.skip(int(r.u8()))  // compression
	end := r.u16() + r.p // extensions
	for r.p < end && r.err == nil {
		typ, l := r.u16(), r.u16()
		ext := reader{b: r.take(l)}
		switch typ {
		case 10:
			for n := ext.u16() / 2; n > 0; n-- {
				groups = append(groups, uint16(ext.u16()))
			}
		case 51:
			for stop := ext.u16() + ext.p; ext.p < stop && ext.err == nil; {
				shares = append(shares, uint16(ext.u16()))
				ext.skip(ext.u16())
			}
		}
	}
	if r.err != nil {
		t.Fatal(r.err)
	}
	return groups, shares
}

type reader struct {
	b   []byte
	p   int
	err error
}

func (r *reader) take(n int) []byte {
	if r.err != nil || r.p+n > len(r.b) {
		r.err = fmt.Errorf("short ClientHello")
		return nil
	}
	s := r.b[r.p : r.p+n]
	r.p += n
	return s
}
func (r *reader) skip(n int) { r.take(n) }
func (r *reader) u8() int {
	if s := r.take(1); s != nil {
		return int(s[0])
	}
	return 0
}
func (r *reader) u16() int {
	if s := r.take(2); s != nil {
		return int(binary.BigEndian.Uint16(s))
	}
	return 0
}

func contains(list []uint16, v uint16) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func freeTestPort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}
