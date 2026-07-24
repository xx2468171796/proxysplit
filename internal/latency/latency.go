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
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/proxy"

	"proxysplit/internal/nodes"
)

// connectivityURL deliberately checks an actual Google HTTPS response. Opening
// a TCP connection to a CDN edge is not sufficient: expired credentials,
// broken protocol handshakes and captive/intercept pages can all produce a
// plausible "latency" while the node cannot carry real traffic.
const connectivityURL = "https://www.google.com/generate_204"

// Result is a latency/speed measurement. Latency and TCPLatency are two distinct
// metrics and are always reported separately:
//   - Latency:    Google 延迟 — full end-to-end HTTPS 204 round-trip through the
//                 complete proxy tunnel. Reflects real usability.
//   - TCPLatency: TCP 延迟 — raw TCP (+protocol handshake) connect time to the
//                 node's edge. Reflects transport-layer reachability only.
//
// Each field is -1 on failure and 0 when that metric was not measured.
type Result struct {
	Latency    int     // Google 延迟 ms, -1 on failure
	TCPLatency int     // TCP 延迟 ms, -1 on failure
	Speed      float64 // MB/s, 0 when not measured
}

// Measure tests connectivity to a node and reports both metrics independently.
//
// The TCP 延迟 is always taken by dialing node.Server:node.Port directly (plus
// the protocol handshake for tls/reality/ws). When socksAddr is non-empty the
// Google 延迟 is additionally measured by requesting an HTTPS 204 endpoint
// through the running core's SOCKS inbound (true end-to-end latency). Without a
// tunnel only the TCP 延迟 is available and Latency stays 0 (not measured).
func Measure(n *nodes.Node, socksAddr string, timeout time.Duration) Result {
	if timeout <= 0 {
		timeout = 5 * time.Second
	}

	res := Result{TCPLatency: measureTCP(n, timeout)}

	if socksAddr != "" {
		elapsed, err := measureHTTPThroughSOCKS(socksAddr, connectivityURL, timeout, nil)
		if err != nil {
			res.Latency = -1
		} else {
			res.Latency = int(elapsed.Round(time.Millisecond) / time.Millisecond)
		}
	}
	return res
}

// measureTCP returns the raw TCP 延迟 to the node's edge (with the protocol
// handshake so stale front doors don't register as reachable), -1 on failure.
func measureTCP(n *nodes.Node, timeout time.Duration) int {
	start := time.Now()
	conn, err := dial(n, timeout)
	if err != nil {
		return -1
	}
	elapsed := time.Since(start)
	conn.Close()
	return int(elapsed.Round(time.Millisecond) / time.Millisecond)
}

// dial opens a connection either through the core's SOCKS5 inbound or directly
// to the node. Direct WebSocket probes complete the HTTP Upgrade handshake:
// merely opening the edge TCP port creates false positives for stale/disabled
// subscriptions whose front door still accepts TCP but never serves WebSocket.
func dial(n *nodes.Node, timeout time.Duration) (net.Conn, error) {
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

func measureHTTPThroughSOCKS(socksAddr, targetURL string, timeout time.Duration, tlsConfig *tls.Config) (time.Duration, error) {
	dialer, err := proxy.SOCKS5("tcp", socksAddr, nil, proxy.Direct)
	if err != nil {
		return 0, fmt.Errorf("socks dialer: %w", err)
	}
	cd, ok := dialer.(proxy.ContextDialer)
	if !ok {
		return 0, fmt.Errorf("socks dialer does not support context cancellation")
	}
	tr := &http.Transport{
		DialContext:         cd.DialContext,
		TLSClientConfig:     tlsConfig,
		TLSHandshakeTimeout: timeout,
		DisableKeepAlives:   true,
	}
	defer tr.CloseIdleConnections()

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("User-Agent", "ProxySplit-Connectivity-Check")

	start := time.Now()
	resp, err := (&http.Client{Transport: tr}).Do(req)
	if err != nil {
		return 0, fmt.Errorf("google connectivity: %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
	if resp.StatusCode != http.StatusNoContent {
		return 0, fmt.Errorf("google connectivity: expected HTTP 204, got %s", resp.Status)
	}
	return time.Since(start), nil
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
