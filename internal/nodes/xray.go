package nodes

import (
	"encoding/json"
	"net/url"
	"strings"
)

// Transports and features sing-box does not implement. Nodes using them are
// carried by the Xray sidecar (internal/xray); sing-box only sees a local
// SOCKS outbound pointing at it.
const (
	NetXHTTP = "xhttp" // also called splithttp
	NetKCP   = "kcp"   // mKCP
)

// NeedsXray reports whether this node can only be served by Xray-core:
// XHTTP (splithttp) or mKCP transport, or VLESS "encryption" other than none.
// Raw sing-box outbounds (POWER云 / imported configs) never do.
func (n *Node) NeedsXray() bool {
	if n == nil || n.HasRaw() {
		return false
	}
	switch n.Type {
	case "vless", "vmess", "trojan":
	default:
		return false
	}
	switch normalNetwork(n.Network) {
	case NetXHTTP, NetKCP:
		return true
	}
	return n.Type == "vless" && n.Encryption != "" && n.Encryption != "none"
}

// XrayNetwork returns the node's transport in Xray naming (xhttp / kcp / ws /
// grpc / raw ...).
func (n *Node) XrayNetwork() string { return normalNetwork(n.Network) }

func normalNetwork(network string) string {
	switch strings.ToLower(strings.TrimSpace(network)) {
	case "xhttp", "splithttp":
		return NetXHTTP
	case "kcp", "mkcp":
		return NetKCP
	case "", "tcp", "raw":
		return "raw"
	case "websocket":
		return "ws"
	default:
		return strings.ToLower(strings.TrimSpace(network))
	}
}

// applyXrayQuery reads the v2rayN / Xray share-link parameters sing-box
// ignores: encryption, xhttp mode / extra, mKCP headerType / seed, REALITY
// spiderX / mldsa65Verify.
func applyXrayQuery(n *Node, q url.Values) {
	if enc := strings.TrimSpace(q.Get("encryption")); enc != "" {
		n.Encryption = enc
	}
	n.SpiderX = q.Get("spx")
	n.PQV = q.Get("pqv")
	switch normalNetwork(n.Network) {
	case NetXHTTP:
		n.Network = NetXHTTP
		n.Mode = q.Get("mode")
		n.Extra = compactJSON(q.Get("extra"))
		// Host fallback to sni is a sing-box habit; xhttp derives it itself.
		n.Host = q.Get("host")
	case NetKCP:
		n.Network = NetKCP
		n.HeaderType = q.Get("headerType")
		n.Seed = firstNonEmpty(q.Get("seed"), q.Get("path"))
		n.Path, n.Host = "", ""
	}
}

// applyVMessXray maps the vmess JSON link's "type" field: mKCP header type,
// or the xhttp mode. For mKCP the seed travels in "path".
func applyVMessXray(n *Node, typ string) {
	switch normalNetwork(n.Network) {
	case NetXHTTP:
		n.Network = NetXHTTP
		if typ != "none" {
			n.Mode = typ
		}
	case NetKCP:
		n.Network = NetKCP
		n.HeaderType, n.Seed, n.Path = typ, n.Path, ""
	}
}

// compactJSON keeps s only if it is a JSON object (re-encoded compactly), so
// a malformed "extra" cannot break the whole Xray config.
func compactJSON(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	var obj map[string]any
	if err := json.Unmarshal([]byte(s), &obj); err != nil {
		return ""
	}
	b, err := json.Marshal(obj)
	if err != nil {
		return ""
	}
	return string(b)
}

// clashXHTTP is Mihomo's `xhttp-opts`.
type clashXHTTP struct {
	Path    string         `yaml:"path"`
	Host    string         `yaml:"host"`
	Mode    string         `yaml:"mode"`
	Headers map[string]any `yaml:"headers"`
}

// applyClashXray copies the Mihomo fields only Xray understands.
func applyClashXray(n *Node, p clashProxy) {
	n.Encryption = strings.TrimSpace(p.Encryption)
	if normalNetwork(n.Network) == NetXHTTP {
		n.Network = NetXHTTP
		n.Path = strings.TrimSpace(p.XHTTPOpts.Path)
		n.Host = firstNonEmpty(strings.TrimSpace(p.XHTTPOpts.Host), clashHeader(p.XHTTPOpts.Headers, "host"))
		n.Mode = strings.TrimSpace(p.XHTTPOpts.Mode)
	}
}

// clashXrayID adds the Xray-only fields to a Clash node's identity, only for
// nodes that need Xray so every other node keeps its existing ID.
func clashXrayID(n *Node) string {
	if !n.NeedsXray() {
		return ""
	}
	return "|" + strings.Join([]string{n.Mode, n.Encryption, n.Extra}, "|")
}
