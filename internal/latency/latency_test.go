package latency

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"net"
	"strings"
	"testing"
	"time"

	"proxysplit/internal/nodes"
)

func TestMeasureWebSocketRequiresUpgrade(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		time.Sleep(20 * time.Millisecond)
	}()
	port := ln.Addr().(*net.TCPAddr).Port
	got := Measure(&nodes.Node{
		Server: "127.0.0.1", Port: port, Network: "ws", Path: "/",
	}, "", 200*time.Millisecond)
	if got.Latency != -1 {
		t.Fatalf("plain TCP listener must not pass a WebSocket probe: %+v", got)
	}
}

func TestMeasureWebSocketUpgrade(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		reader := bufio.NewReader(conn)
		req, err := reader.ReadString('\n')
		if err != nil || !strings.HasPrefix(req, "GET /probe ") {
			return
		}
		key := ""
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			if strings.HasPrefix(strings.ToLower(line), "sec-websocket-key:") {
				key = strings.TrimSpace(strings.SplitN(line, ":", 2)[1])
			}
			if line == "\r\n" {
				break
			}
		}
		sum := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
		accept := base64.StdEncoding.EncodeToString(sum[:])
		fmt.Fprintf(conn, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n", accept)
	}()
	port := ln.Addr().(*net.TCPAddr).Port
	got := Measure(&nodes.Node{
		Server: "127.0.0.1", Port: port, Network: "ws", Path: "/probe",
	}, "", time.Second)
	if got.Latency < 0 {
		t.Fatalf("valid WebSocket upgrade should pass: %+v", got)
	}
}

func TestMeasureRealityDoesNotUsePlainTLSHandshake(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		conn, err := ln.Accept()
		if err == nil {
			conn.Close()
		}
	}()
	port := ln.Addr().(*net.TCPAddr).Port
	got := Measure(&nodes.Node{
		Server: "127.0.0.1", Port: port, Security: "reality",
	}, "", time.Second)
	if got.Latency < 0 {
		t.Fatalf("Reality direct fallback must not attempt ordinary TLS: %+v", got)
	}
}
