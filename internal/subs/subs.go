// Package subs fetches and parses subscription URLs into nodes. The real
// implementation is filled in by the workflow agent; this file is the contract.
package subs

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"golang.org/x/net/proxy"

	"proxysplit/internal/nodes"
)

// maxBodyBytes caps the subscription body we will read, to avoid abuse.
const maxBodyBytes = 8 << 20 // 8MB

// Fetch downloads a subscription URL and returns the nodes it contains. Real
// implementations must handle both base64-encoded and plain-text bodies (one
// share link per line), tolerate CRLF, and parse via nodes.ParseMany. viaProxy
// (host:port SOCKS) may be used to fetch through the core when set.
//
// IMPLEMENTED BY WORKFLOW AGENT (subs).
func Fetch(url string, viaProxy string) ([]*nodes.Node, error) {
	tr := &http.Transport{}
	if viaProxy != "" {
		d, err := proxy.SOCKS5("tcp", viaProxy, nil, proxy.Direct)
		if err != nil {
			return nil, fmt.Errorf("socks dialer: %w", err)
		}
		tr.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
			return d.Dial(network, addr)
		}
	}
	client := &http.Client{Transport: tr, Timeout: 15 * time.Second}

	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("User-Agent", "ProxySplit")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch %q: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch %q: unexpected status %s", url, resp.Status)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}

	text := decodeBody(string(body))
	out, _ := nodes.ParseMany(text)
	return out, nil
}

// decodeBody returns the usable share-link text from a subscription body.
// Subscription bodies are usually base64 (standard or url-safe, possibly
// unpadded) of newline-separated links, but are sometimes plain text. It tries
// base64-decoding the trimmed body and uses the result when it looks like it
// contains links; otherwise it falls back to the raw body.
func decodeBody(body string) string {
	trimmed := strings.TrimSpace(body)
	if dec, err := b64decode(trimmed); err == nil && strings.Contains(string(dec), "://") {
		return string(dec)
	}
	return body
}

// b64decode accepts standard/url-safe base64 with or without padding, and
// tolerates internal whitespace (some servers wrap the payload at 76 columns).
func b64decode(s string) ([]byte, error) {
	s = strings.Join(strings.Fields(s), "")
	s = strings.ReplaceAll(s, "-", "+")
	s = strings.ReplaceAll(s, "_", "/")
	if m := len(s) % 4; m != 0 {
		s += strings.Repeat("=", 4-m)
	}
	return base64.StdEncoding.DecodeString(s)
}
