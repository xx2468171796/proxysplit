// Package latency measures node reachability. The real implementation is filled
// in by the workflow agent; this file defines the stable contract.
package latency

import (
	"bufio"
	"context"
	"crypto/sha1"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/proxy"

	"proxysplit/internal/nodes"
)

// probeTarget is a lightweight, globally reachable endpoint used to measure true
// end-to-end latency through the proxy. A bare TCP connect to :443 is enough to
// exercise the full tunnel without transferring a payload.
const probeTarget = "www.gstatic.com:443"

// Result is a latency/speed measurement.
type Result struct {
	Latency int     // round-trip ms, -1 on failure
	Speed   float64 // MB/s, 0 when not measured
}

// Measure tests connectivity to a node. When socksAddr is non-empty the running
// core's SOCKS inbound may be used to measure true end-to-end latency (an HTTP
// request to a lightweight endpoint through the proxy); otherwise a plain TCP
// connect to node.Server:node.Port is the fallback.
//
// IMPLEMENTED BY WORKFLOW AGENT (latency).
func Measure(n *nodes.Node, socksAddr string, timeout time.Duration) Result {
	if timeout <= 0 {
		timeout = 5 * time.Second
	}

	start := time.Now()

	conn, err := dial(n, socksAddr, timeout)
	if err != nil {
		return Result{Latency: -1}
	}
	elapsed := time.Since(start)
	conn.Close()

	return Result{Latency: int(elapsed.Round(time.Millisecond) / time.Millisecond)}
}

// dial opens a connection either through the core's SOCKS5 inbound or directly
// to the node. Direct WebSocket probes complete the HTTP Upgrade handshake:
// merely opening the edge TCP port creates false positives for stale/disabled
// subscriptions whose front door still accepts TCP but never serves WebSocket.
func dial(n *nodes.Node, socksAddr string, timeout time.Duration) (net.Conn, error) {
	if socksAddr != "" {
		dialer, err := proxy.SOCKS5("tcp", socksAddr, nil, proxy.Direct)
		if err != nil {
			return nil, err
		}
		if cd, ok := dialer.(proxy.ContextDialer); ok {
			ctx, cancel := context.WithTimeout(context.Background(), timeout)
			defer cancel()
			return cd.DialContext(ctx, "tcp", probeTarget)
		}
		return dialer.Dial("tcp", probeTarget)
	}

	addr := net.JoinHostPort(n.Server, strconv.Itoa(n.Port))
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return nil, err
	}
	if err := conn.SetDeadline(time.Now().Add(timeout)); err != nil {
		conn.Close()
		return nil, err
	}

	// Reality is not a conventional TLS handshake: it needs the protocol's
	// public-key/short-id exchange. Keep its direct fallback at TCP level rather
	// than incorrectly marking every healthy Reality node as unavailable.
	if strings.EqualFold(n.Security, "tls") {
		serverName := strings.TrimSpace(n.SNI)
		if serverName == "" {
			serverName = strings.TrimSpace(n.Host)
		}
		if serverName == "" {
			serverName = n.Server
		}
		tlsConn := tls.Client(conn, &tls.Config{
			ServerName:         serverName,
			InsecureSkipVerify: n.Insecure, // user-imported node setting
		})
		if err := tlsConn.Handshake(); err != nil {
			conn.Close()
			return nil, err
		}
		conn = tlsConn
	}

	if strings.EqualFold(n.Network, "ws") {
		if err := websocketUpgrade(conn, n); err != nil {
			conn.Close()
			return nil, err
		}
	}
	return conn, nil
}

func websocketUpgrade(conn net.Conn, n *nodes.Node) error {
	path := strings.TrimSpace(n.Path)
	if path == "" {
		path = "/"
	} else if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	host := strings.TrimSpace(n.Host)
	if host == "" {
		host = net.JoinHostPort(n.Server, strconv.Itoa(n.Port))
	}

	// Fixed nonce is sufficient for a reachability probe. The server response is
	// still validated against RFC 6455's accept value.
	const key = "UHJveHlTcGxpdFByb2JlIQ=="
	req := "GET " + path + " HTTP/1.1\r\n" +
		"Host: " + host + "\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Key: " + key + "\r\n" +
		"Sec-WebSocket-Version: 13\r\n\r\n"
	if _, err := conn.Write([]byte(req)); err != nil {
		return err
	}

	resp, err := http.ReadResponse(bufio.NewReader(conn), &http.Request{Method: http.MethodGet})
	if err != nil {
		return fmt.Errorf("websocket upgrade: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusSwitchingProtocols {
		return fmt.Errorf("websocket upgrade: unexpected status %s", resp.Status)
	}
	sum := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	want := base64.StdEncoding.EncodeToString(sum[:])
	if !strings.EqualFold(strings.TrimSpace(resp.Header.Get("Sec-WebSocket-Accept")), want) {
		return fmt.Errorf("websocket upgrade: invalid accept header")
	}
	return nil
}
