package proc

import (
	"net"
	"os"
	"strings"
	"testing"
	"time"
)

func TestUDPLookupResolvesOwnProcess(t *testing.T) {
	// Bind a UDP socket and "connect" it so it gets a fixed local port.
	conn, err := net.Dial("udp", "8.8.8.8:443")
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	localPort := uint16(conn.LocalAddr().(*net.UDPAddr).Port)

	l := NewLookup(0)
	pid, exe, ok := l.ExeByLocalUDPPort(localPort)
	if !ok {
		t.Fatalf("failed to resolve local UDP port %d to a process", localPort)
	}
	if int(pid) != os.Getpid() {
		t.Fatalf("resolved pid %d, want own pid %d", pid, os.Getpid())
	}
	t.Logf("udp port %d -> pid %d -> %s", localPort, pid, BaseName(exe))
}

func TestLookupResolvesOwnProcess(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		c, err := ln.Accept()
		if err == nil {
			time.Sleep(200 * time.Millisecond)
			c.Close()
		}
	}()

	conn, err := net.Dial("tcp", ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	localPort := uint16(conn.LocalAddr().(*net.TCPAddr).Port)

	l := NewLookup(0)
	pid, exe, ok := l.ExeByLocalPort(localPort)
	if !ok {
		t.Fatalf("failed to resolve local port %d to a process", localPort)
	}
	if int(pid) != os.Getpid() {
		t.Fatalf("resolved pid %d, want own pid %d", pid, os.Getpid())
	}
	if !strings.HasSuffix(strings.ToLower(exe), ".exe") {
		t.Fatalf("exe path looks wrong: %q", exe)
	}
	t.Logf("port %d -> pid %d -> %s (base %s)", localPort, pid, exe, BaseName(exe))
}
