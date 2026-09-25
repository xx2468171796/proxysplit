package service

import (
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// closeProcessConnections must close exactly the named programs' open
// connections through the clash API of a real core.
func TestCloseProcessConnections(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "bin", "sing-box.exe"))
	if err != nil {
		t.Skip("sing-box.exe not present")
	}
	dir := t.TempDir()
	bin := filepath.Join(dir, "sing-box.exe") // private copy: see routing_matrix_test
	os.WriteFile(bin, src, 0o755)

	// A local origin that holds every connection open until the client leaves.
	origin, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer origin.Close()
	go func() {
		for {
			c, err := origin.Accept()
			if err != nil {
				return
			}
			go func() { io.Copy(io.Discard, c); c.Close() }()
		}
	}()

	free := func() int {
		l, _ := net.Listen("tcp", "127.0.0.1:0")
		defer l.Close()
		return l.Addr().(*net.TCPAddr).Port
	}
	mixed, clash := free(), free()
	cfg := fmt.Sprintf(`{"log":{"level":"warn"},"inbounds":[{"type":"mixed","listen":"127.0.0.1","listen_port":%d}],
"outbounds":[{"type":"direct","tag":"direct"}],"route":{"final":"direct","find_process":true},
"experimental":{"clash_api":{"external_controller":"127.0.0.1:%d","secret":"s"}}}`, mixed, clash)
	p := filepath.Join(dir, "c.json")
	os.WriteFile(p, []byte(cfg), 0o600)
	sb := exec.Command(bin, "run", "-c", p)
	if err := sb.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { sb.Process.Kill(); sb.Wait() }()

	ready := false // the clash controller can come up after the inbound
	for i := 0; i < 300 && !ready; i++ {
		if c, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", clash)); err == nil {
			c.Close()
			ready = true
		} else {
			time.Sleep(100 * time.Millisecond)
		}
	}
	conn, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", mixed))
	if !ready || err != nil {
		t.Fatal("core did not come up")
	}
	defer conn.Close()
	fmt.Fprintf(conn, "CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n", origin.Addr(), origin.Addr())
	buf := make([]byte, 64)
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	if n, _ := conn.Read(buf); !strings.Contains(string(buf[:n]), "200") {
		t.Fatalf("CONNECT failed: %q", buf[:n])
	}

	// The core dials out (and tracks the connection) on the first payload byte.
	conn.Write([]byte("ping"))
	for i := 0; i < 50; i++ {
		if conns, _ := clashConnections(clash, "s"); len(conns) > 0 {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	exe, _ := os.Executable()
	if n := closeProcessConnections(clash, "s", map[string]bool{"someone-else.exe": true}); n != 0 {
		t.Fatalf("closed %d connections of an unrelated program", n)
	}
	if n := closeProcessConnections(clash, "s", map[string]bool{strings.ToLower(filepath.Base(exe)): true}); n < 1 {
		t.Fatal("our own connection was not closed")
	}
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, err := conn.Read(buf); err == nil {
		t.Fatal("connection still open after closeProcessConnections")
	}
}
