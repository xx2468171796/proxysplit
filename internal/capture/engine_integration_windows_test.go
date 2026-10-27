package capture

import (
	"encoding/binary"
	"io"
	"net"
	"net/netip"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// connectSOCKS is a tiny SOCKS5 CONNECT server that records targets and
// forwards for real.
func connectSOCKS(t *testing.T) (int, func() []string) {
	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	var mu sync.Mutex
	var seen []string
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
				if _, err := io.ReadFull(c, b[:10]); err != nil || b[3] != 1 {
					return
				}
				ip, _ := netip.AddrFromSlice(b[4:8])
				target := netip.AddrPortFrom(ip, binary.BigEndian.Uint16(b[8:10])).String()
				mu.Lock()
				seen = append(seen, target)
				mu.Unlock()
				up, err := net.DialTimeout("tcp", target, 10*time.Second)
				if err != nil {
					return
				}
				defer up.Close()
				_, _ = c.Write([]byte{5, 0, 0, 1, 0, 0, 0, 0, 0, 0})
				go func() { _, _ = io.Copy(up, c) }()
				_, _ = io.Copy(c, up)
			}(c)
		}
	}()
	return ln.Addr().(*net.TCPAddr).Port, func() []string { mu.Lock(); defer mu.Unlock(); return append([]string(nil), seen...) }
}

// TestEngineCapturesOnlyListedProcess needs admin rights, the driver files in
// bin/ and Internet access: PROXYSPLIT_CAPTURE_IT=1 go test ./internal/capture -run Engine
func TestEngineCapturesOnlyListedProcess(t *testing.T) {
	if os.Getenv("PROXYSPLIT_CAPTURE_IT") != "1" {
		t.Skip("set PROXYSPLIT_CAPTURE_IT=1 (admin + bin/WinDivert*.{dll,sys})")
	}
	dll, _ := filepath.Abs(filepath.Join("..", "..", "bin", "WinDivert.dll"))
	port, seen := connectSOCKS(t)
	// curl.exe (in System32) plays the listed program; this test process (the
	// SOCKS server dialing out) stays unlisted, like sing-box in production.
	routes := &Routes{Apps: map[string]int{"curl.exe": port}}
	eng, err := Start(Options{DLLPath: dll, Log: func(s string) { t.Log(s) }}, routes)
	if err != nil {
		t.Fatal(err)
	}
	defer eng.Stop()
	get := func() string {
		out, err := exec.Command("curl.exe", "-s", "-I", "--max-time", "15", "http://1.1.1.1/").Output()
		if err != nil {
			t.Fatalf("curl through the capture failed: %v", err)
		}
		return string(out)
	}
	if line := get(); !strings.HasPrefix(line, "HTTP/1.1 ") {
		t.Fatalf("unexpected reply %q", line)
	}
	if s := seen(); len(s) == 0 || s[0] != "1.1.1.1:80" {
		t.Fatalf("connection did not go through the group inbound: %v", s)
	}
	eng.SetRoutes(&Routes{}) // hot change: now unlisted -> direct
	before := len(seen())
	get()
	if len(seen()) != before {
		t.Fatal("after removing the app its new connection must go direct")
	}
	t.Logf("flows tracked: %d, socks port %s", eng.Flows(), strconv.Itoa(port))
}
