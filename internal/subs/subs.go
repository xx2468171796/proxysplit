// Package subs fetches and parses subscription URLs into nodes.
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
	"proxysplit/internal/powervpn"
)

// maxBodyBytes caps the subscription body we will read, to avoid abuse.
const maxBodyBytes = 8 << 20 // 8MB

// Result is a fetched subscription.
type Result struct {
	Nodes    []*nodes.Node
	Official bool     // signed POWER云 account profile
	Notices  []string // e.g. device limit reached (official only)
}

// Fetch downloads a subscription URL and returns the nodes it contains
// (compat mode only; kept for callers without a POWER云 client).
func Fetch(url string, viaProxy string) ([]*nodes.Node, error) {
	res, err := FetchWith(url, viaProxy, nil)
	if err != nil {
		return nil, err
	}
	return res.Nodes, nil
}

// FetchWith downloads a subscription. With a POWER云 client it identifies as
// "ProxySplit/<version>" with the device headers (design §2.2); a response
// carrying a valid X-PowerVPN-Signature (type profile) becomes an official
// account profile; one that declares X-PowerVPN-Sig-Type but does not verify is
// an error (powervpn.ErrProfileSignature: upgrade ProxySplit). Anything else is
// parsed in compat mode: base64 / plain share links, Clash YAML, or sing-box
// JSON. viaProxy (host:port SOCKS) may be used to fetch through the core.
func FetchWith(url string, viaProxy string, pv *powervpn.Client) (*Result, error) {
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
	// Many subscription panels negotiate on User-Agent. Asking for Clash format
	// gives complete structured proxy fields; ParseClashYAML below handles it,
	// while panels that return universal/base64 links remain supported. The
	// POWER云 panel keys on the "ProxySplit/" prefix; third-party panels still
	// see "clash.meta" in the UA and answer in Clash format.
	req.Header.Set("User-Agent", "Clash.Meta")
	official := false
	if pv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		official = pv.IsPowerVPNURL(ctx, url)
		cancel()
	}
	if official {
		// Device identity goes only to POWER云 (panel / verified entry hosts);
		// third-party panels keep seeing the plain Clash.Meta request.
		for k, v := range pv.ClientHeaders() {
			req.Header[k] = v
		}
		req.Header.Set("User-Agent", pv.UserAgent()+" clash.meta")
	}

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

	// The panel declares its signed profiles with X-PowerVPN-Sig-Type.
	declared := strings.TrimSpace(resp.Header.Get(powervpn.HeaderSigType)) != ""
	if declared || (official && resp.Header.Get(powervpn.HeaderSignature) != "") {
		verifier := powervpn.DefaultVerifier()
		if pv != nil {
			verifier = pv.Verifier()
		}
		prof, perr := powervpn.ParseSignedProfile(verifier, resp.Header, body)
		if perr == nil {
			list, notices := prof.Nodes()
			if len(list) == 0 && len(notices) > 0 {
				return nil, fmt.Errorf("%s", strings.Join(notices, "；"))
			}
			if len(list) == 0 {
				return nil, fmt.Errorf("POWER云 账号下暂无可用线路")
			}
			return &Result{Nodes: list, Official: true, Notices: notices}, nil
		}
		if declared {
			// A POWER云 profile this build cannot verify / read (panel key or
			// format newer than this ProxySplit). Parsed as a third-party
			// subscription it would just come out as zero nodes, so say why.
			return nil, perr
		}
		// Signature header without the panel's type header and not verifying:
		// someone else's subscription (compat).
	}

	out, err := ParseBody(body)
	if err != nil {
		return nil, err
	}
	return &Result{Nodes: out}, nil
}

// ParseBody parses a third-party subscription body (compat mode).
func ParseBody(body []byte) ([]*nodes.Node, error) {
	var out []*nodes.Node
	trimmed := strings.TrimSpace(string(body))
	if strings.HasPrefix(trimmed, "{") {
		out, _ = nodes.ParseSingboxJSON(body)
	}
	if len(out) == 0 {
		out, _ = nodes.ParseMany(decodeBody(string(body)))
	}
	if len(out) == 0 {
		var err error
		out, err = nodes.ParseClashYAML(body)
		if err != nil {
			return nil, fmt.Errorf("subscription has no supported nodes: %w", err)
		}
	}
	filtered := out[:0]
	for _, node := range out {
		if !isMetadataNode(node.Name) {
			filtered = append(filtered, node)
		}
	}
	if len(filtered) == 0 {
		return nil, fmt.Errorf("subscription contains only metadata entries")
	}
	return filtered, nil
}

// Providers often encode traffic/expiry notices as valid-looking proxy links.
// They are account metadata, not selectable nodes, and otherwise create three
// confusing duplicates that can never be expected to represent real routes.
func isMetadataNode(name string) bool {
	compact := strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(name)), ""))
	markers := []string{
		"剩余流量", "流量剩余", "套餐到期", "到期时间", "过期时间",
		"过滤掉", "官网", "官方网站", "telegram", "电报群", "客服",
		"traffic:", "traffic：", "expire:", "expire：",
	}
	for _, marker := range markers {
		if strings.Contains(compact, marker) {
			return true
		}
	}
	return false
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
