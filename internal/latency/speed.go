package latency

import (
	"context"
	"errors"
	"io"
	"net/http"
	"time"

	"golang.org/x/net/proxy"
)

// speedTarget streams an arbitrary number of bytes from Cloudflare's speed
// endpoint. It is reachable through the proxy tunnel and lets us measure raw
// download throughput without depending on any node-specific host.
const speedTarget = "https://speed.cloudflare.com/__down?bytes=30000000"

// SpeedTest measures download throughput in MB/s (megabytes per second) by
// streaming a fixed payload from a globally reachable endpoint through the
// core's SOCKS5 inbound at socksAddr. Only the body read is timed.
func SpeedTest(socksAddr string, timeout time.Duration) (float64, error) {
	if socksAddr == "" {
		return 0, errors.New("speed: empty socks address")
	}
	if timeout <= 0 {
		timeout = 12 * time.Second
	}

	d, err := proxy.SOCKS5("tcp", socksAddr, nil, proxy.Direct)
	if err != nil {
		return 0, err
	}
	cd, ok := d.(proxy.ContextDialer)
	if !ok {
		return 0, errors.New("speed: dialer does not support context")
	}

	tr := &http.Transport{
		DialContext:         cd.DialContext,
		TLSHandshakeTimeout: 10 * time.Second,
		DisableKeepAlives:   true,
	}
	client := &http.Client{Transport: tr}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	req, err := http.NewRequest(http.MethodGet, speedTarget, nil)
	if err != nil {
		return 0, err
	}
	req = req.WithContext(ctx)

	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	start := time.Now()
	bytesRead, err := io.Copy(io.Discard, resp.Body)
	elapsed := time.Since(start)
	if err != nil && bytesRead == 0 {
		return 0, err
	}
	if bytesRead == 0 {
		return 0, errors.New("speed: no bytes read")
	}

	secs := elapsed.Seconds()
	if secs <= 0 {
		return 0, errors.New("speed: measurement interval too small")
	}

	mbps := float64(bytesRead) / (1024 * 1024) / secs
	return mbps, nil
}
