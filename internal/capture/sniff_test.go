package capture

import (
	"crypto/tls"
	"net"
	"testing"
	"time"
)

// clientHello captures a real ClientHello produced by crypto/tls for sni.
func clientHello(t *testing.T, sni string) []byte {
	t.Helper()
	a, b := net.Pipe()
	go func() {
		_ = tls.Client(a, &tls.Config{ServerName: sni, InsecureSkipVerify: true}).Handshake()
	}()
	_ = b.SetReadDeadline(time.Now().Add(2 * time.Second))
	buf := make([]byte, 4096)
	n, _ := b.Read(buf)
	a.Close()
	b.Close()
	return buf[:n]
}

func TestHostFromTLS(t *testing.T) {
	hello := clientHello(t, "www.google.com")
	if h, done := hostFrom(hello); !done || h != "www.google.com" {
		t.Fatalf("got %q done=%v", h, done)
	}
	if _, done := hostFrom(hello[:10]); done {
		t.Fatal("partial record must ask for more bytes")
	}
}

func TestHostFromHTTPAndOthers(t *testing.T) {
	cases := []struct {
		in   string
		host string
		done bool
	}{
		{"GET / HTTP/1.1\r\nHost: Example.COM:8080\r\n\r\n", "example.com", true},
		{"GET / HTTP/1.1\r\nHost: 1.2.3.4\r\n\r\n", "", true},
		{"GET / HTTP/1.1\r\nHo", "", false},
		{"GE", "", false},
		{"SSH-2.0-OpenSSH\r\n", "", true},
	}
	for _, c := range cases {
		h, done := hostFrom([]byte(c.in))
		if h != c.host || done != c.done {
			t.Errorf("%q: got %q,%v want %q,%v", c.in, h, done, c.host, c.done)
		}
	}
}

func TestPeekHostTimesOutForServerFirst(t *testing.T) {
	a, b := net.Pipe()
	defer a.Close()
	defer b.Close()
	start := time.Now()
	first, host := peekHost(b) // client never speaks (SMTP / SSH style)
	if host != "" || len(first) != 0 || time.Since(start) > 2*sniffWait {
		t.Fatalf("got %q %d bytes after %v", host, len(first), time.Since(start))
	}
}
