package nodes

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
)

// HasRaw reports whether the node is backed by verbatim sing-box outbounds.
func (n *Node) HasRaw() bool { return n != nil && len(n.Outbounds) > 0 }

// RawKey is a stable fingerprint of the raw outbounds (for dedupe/reconcile).
func (n *Node) RawKey() string {
	if !n.HasRaw() {
		return ""
	}
	h := sha256.New()
	h.Write([]byte(n.EntryTag))
	for _, r := range n.Outbounds {
		h.Write([]byte{0})
		h.Write(r)
	}
	return hex.EncodeToString(h.Sum(nil))
}

// DecodeOutbound decodes one raw sing-box outbound, keeping numbers exact.
func DecodeOutbound(raw json.RawMessage) (map[string]any, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var m map[string]any
	if err := dec.Decode(&m); err != nil {
		return nil, err
	}
	if m == nil {
		return nil, fmt.Errorf("outbound is not an object")
	}
	return m, nil
}

// OutboundRefs lists the tags an outbound references: group members
// ("outbounds"), selector "default" and dial "detour".
func OutboundRefs(m map[string]any) []string {
	var refs []string
	if list, ok := m["outbounds"].([]any); ok {
		for _, v := range list {
			if s, ok := v.(string); ok && s != "" {
				refs = append(refs, s)
			}
		}
	}
	for _, k := range []string{"default", "detour"} {
		if s, ok := m[k].(string); ok && s != "" {
			refs = append(refs, s)
		}
	}
	return refs
}

// OutboundClosure returns entry plus every outbound it (transitively)
// references, entry first, in a stable order. References to tags that are not
// in the list (e.g. "direct") are left for the caller to resolve.
func OutboundClosure(all []json.RawMessage, entry string) ([]json.RawMessage, error) {
	byTag := map[string]json.RawMessage{}
	decoded := map[string]map[string]any{}
	for _, raw := range all {
		m, err := DecodeOutbound(raw)
		if err != nil {
			return nil, err
		}
		tag, _ := m["tag"].(string)
		if tag == "" {
			continue
		}
		byTag[tag] = raw
		decoded[tag] = m
	}
	if _, ok := byTag[entry]; !ok {
		return nil, fmt.Errorf("outbound %q not found", entry)
	}
	var out []json.RawMessage
	seen := map[string]bool{}
	queue := []string{entry}
	for len(queue) > 0 {
		tag := queue[0]
		queue = queue[1:]
		if seen[tag] {
			continue
		}
		raw, ok := byTag[tag]
		if !ok {
			continue
		}
		seen[tag] = true
		out = append(out, raw)
		queue = append(queue, OutboundRefs(decoded[tag])...)
	}
	return out, nil
}

// EndpointOf returns the first server/port found in the closure (entry first),
// used for TCP latency probing and display.
func EndpointOf(raws []json.RawMessage) (typ, server string, port int) {
	for i, raw := range raws {
		m, err := DecodeOutbound(raw)
		if err != nil {
			continue
		}
		t, _ := m["type"].(string)
		if i == 0 {
			typ = t
		}
		s, _ := m["server"].(string)
		if s == "" {
			continue
		}
		if n, ok := m["server_port"].(json.Number); ok {
			v, _ := n.Int64()
			port = int(v)
		}
		return typ, s, port
	}
	return typ, "", 0
}

// proxyOutboundTypes are sing-box outbound types that are actual proxies (as
// opposed to direct/block/dns/selector/urltest).
var proxyOutboundTypes = map[string]bool{
	"vless": true, "vmess": true, "trojan": true, "shadowsocks": true, "hysteria": true,
	"hysteria2": true, "tuic": true, "anytls": true, "socks": true, "http": true,
	"ssh": true,
	// naive needs with_naive_outbound (cronet), which the bundled platform
	// kernel does not include: one naive node makes the whole core exit.
	// shadowtls is only a detour for shadowsocks, never a standalone node.
	// wireguard is an endpoint since sing-box 1.11; the legacy outbound was
	// removed in 1.13 and makes the whole core refuse to start.
}

// NeutraliseForeign strips from a third-party outbound (decoded, modified in
// place) the fields that point at things only the author's machine has, which
// would make the embedded core refuse to start (sing-box 1.14):
//   - domain_resolver: names a DNS server of *their* config ("domain resolver
//     not found"); without it the route's default_domain_resolver applies;
//   - legacy domain_strategy: removed in 1.14 (fatal without an env override);
//   - routing_mark / netns / bind_interface / inet4|6_bind_address: their
//     machine's network setup (routing_mark is fatal off Linux);
//   - certificate / key / ECH config file paths that don't exist here (fatal
//     "read certificate"); exists reports whether a local file is present.
//
// Tag references (detour, group members) are resolved by the config builder.
// It returns the removed field names (dotted for nested ones).
func NeutraliseForeign(m map[string]any, exists func(path string) bool) []string {
	var removed []string
	for _, k := range []string{"domain_resolver", "domain_strategy", "routing_mark", "netns", "bind_interface", "inet4_bind_address", "inet6_bind_address"} {
		if _, ok := m[k]; ok {
			delete(m, k)
			removed = append(removed, k)
		}
	}
	dropMissing := func(obj map[string]any, prefix string, keys ...string) {
		for _, k := range keys {
			if p, ok := obj[k].(string); ok && p != "" && !exists(p) {
				delete(obj, k)
				removed = append(removed, prefix+k)
			}
		}
	}
	dropMissing(m, "", "private_key_path") // ssh
	if tls, ok := m["tls"].(map[string]any); ok {
		dropMissing(tls, "tls.", "certificate_path", "client_certificate_path", "client_key_path")
		if ech, ok := tls["ech"].(map[string]any); ok {
			dropMissing(ech, "tls.ech.", "config_path")
		}
	}
	return removed
}

// ParseSingboxJSON parses a sing-box configuration (or bare {"outbounds":[...]})
// and returns one raw-backed node per proxy outbound. Each node carries the
// outbound plus anything it references via detour, verbatim.
func ParseSingboxJSON(body []byte) ([]*Node, error) {
	var doc struct {
		Outbounds []json.RawMessage `json:"outbounds"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(body), &doc); err != nil {
		return nil, err
	}
	var out []*Node
	for _, raw := range doc.Outbounds {
		m, err := DecodeOutbound(raw)
		if err != nil {
			continue
		}
		typ, _ := m["type"].(string)
		tag, _ := m["tag"].(string)
		if tag == "" || !proxyOutboundTypes[strings.ToLower(typ)] {
			continue
		}
		closure, err := OutboundClosure(doc.Outbounds, tag)
		if err != nil {
			continue
		}
		n := &Node{Name: tag, EntryTag: tag, Outbounds: closure}
		n.Type, n.Server, n.Port = EndpointOf(closure)
		n.ID = "sb-" + n.RawKey()[:16]
		out = append(out, n)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no proxy outbounds in sing-box config")
	}
	return out, nil
}
