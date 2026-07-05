// Package latency measures node reachability. The real implementation is filled
// in by the workflow agent; this file defines the stable contract.
package latency

import (
	"context"
	"net"
	"strconv"
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

// dial opens a single TCP connection either through the core's SOCKS5 inbound
// (measuring the full tunnel to a fixed probe endpoint) or directly to the node.
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
	return net.DialTimeout("tcp", addr, timeout)
}
