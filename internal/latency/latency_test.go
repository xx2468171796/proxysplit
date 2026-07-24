package latency

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"proxysplit/internal/nodes"
)

func startTestSOCKS5(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		for {
			client, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer client.Close()
				header := make([]byte, 2)
				if _, err := io.ReadFull(client, header); err != nil {
					return
				}
				methods := make([]byte, int(header[1]))
				if _, err := io.ReadFull(client, methods); err != nil {
					return
				}
				if _, err := client.Write([]byte{5, 0}); err != nil {
					return
				}
				req := make([]byte, 4)
				if _, err := io.ReadFull(client, req); err != nil || req[0] != 5 || req[1] != 1 {
					return
				}
				var host string
				switch req[3] {
				case 1:
					ip := make([]byte, 4)
					if _, err := io.ReadFull(client, ip); err != nil {
						return
					}
					host = net.IP(ip).String()
				case 3:
					size := make([]byte, 1)
					if _, err := io.ReadFull(client, size); err != nil {
						return
					}
					name := make([]byte, int(size[0]))
					if _, err := io.ReadFull(client, name); err != nil {
						return
					}
					host = string(name)
				default:
					return
				}
				portBytes := make([]byte, 2)
				if _, err := io.ReadFull(client, portBytes); err != nil {
					return
				}
				upstream, err := net.Dial("tcp", net.JoinHostPort(host, fmt.Sprint(binary.BigEndian.Uint16(portBytes))))
				if err != nil {
					_, _ = client.Write([]byte{5, 5, 0, 1, 0, 0, 0, 0, 0, 0})
					return
				}
				defer upstream.Close()
				if _, err := client.Write([]byte{5, 0, 0, 1, 0, 0, 0, 0, 0, 0}); err != nil {
					return
				}
				go func() { _, _ = io.Copy(upstream, client); _ = upstream.Close() }()
				_, _ = io.Copy(client, upstream)
			}()
		}
	}()
	return ln.Addr().String()
}

func TestGoogleConnectivityRequiresHTTP204ThroughSOCKS(t *testing.T) {
	status := http.StatusNoContent
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
	}))
	defer server.Close()
	socksAddr := startTestSOCKS5(t)
	tlsConfig := server.Client().Transport.(*http.Transport).TLSClientConfig

	if _, err := measureHTTPThroughSOCKS(socksAddr, server.URL, time.Second, tlsConfig); err != nil {
		t.Fatalf("HTTP 204 through SOCKS must be available: %v", err)
	}
	status = http.StatusOK
	if _, err := measureHTTPThroughSOCKS(socksAddr, server.URL, time.Second, tlsConfig); err == nil {
		t.Fatal("an intercepted/non-204 response must not be reported as available")
	}
}

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
