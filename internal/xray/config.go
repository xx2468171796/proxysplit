// Package xray runs Xray-core as a sidecar for the nodes sing-box cannot
// carry (XHTTP / mKCP transports, VLESS encryption). Each such node gets a
// loopback SOCKS inbound in one shared Xray process; sing-box keeps TUN,
// per-app routing, rules and DNS and reaches the node through that inbound.
//
// Field names follow Xray-core v26 infra/conf (checked against the source of
// the pinned tag, see bin/xray-release.json).
package xray

import (
	"encoding/json"
	"fmt"
	"sort"

	"proxysplit/internal/nodes"
)

// M is a JSON object.
type M = map[string]any

// Endpoint is where sing-box reaches one node's sidecar inbound: SOCKS5 on
// 127.0.0.1:Port with a per-launch random user / password, so no other local
// program can borrow the node through the loopback port.
type Endpoint struct {
	Port int
	User string
	Pass string
}

// Entry is one node served by the sidecar.
type Entry struct {
	Key string // Key(node); also the inbound / outbound tag suffix
	Endpoint
	Node *nodes.Node
}

// directDNS are the China resolvers Xray uses for its own server lookups
// (first one wins, the rest are fallbacks). Never the OS resolver: under TUN
// that lookup would be hijacked into sing-box's remote DNS, which goes through
// the proxy — i.e. through this very sidecar — and never resolves.
var directDNS = []string{"223.5.5.5", "119.29.29.29"}

// resolveStrategy makes every outbound resolve its server via the "dns" block
// above instead of the system resolver (sockopt.domainStrategy).
const resolveStrategy = "UseIP"

// dnsTag / directTag route the DNS module's queries straight out (see BuildConfig).
const (
	dnsTag    = "dns-direct"
	directTag = "direct"
)

// Key identifies a node across lines / extra nodes / port proxies so the same
// node shares one inbound.
func Key(n *nodes.Node) string {
	if n.ID != "" {
		return n.ID
	}
	return fmt.Sprintf("%s-%s-%d", n.Type, n.Server, n.Port)
}

// BuildConfig renders the Xray JSON config: one SOCKS inbound (password auth,
// UDP on) per entry, routed by inboundTag to that entry's outbound, plus a
// direct-resolver "dns" block for the outbounds' own server names.
func BuildConfig(entries []Entry, logLevel string) ([]byte, error) {
	if len(entries) == 0 {
		return nil, fmt.Errorf("xray: no nodes")
	}
	sorted := append([]Entry(nil), entries...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Port < sorted[j].Port })
	var inbounds, outbounds, rules []M
	for _, e := range sorted {
		if e.Port <= 0 || e.Node == nil || e.User == "" || e.Pass == "" {
			return nil, fmt.Errorf("xray: bad entry %q", e.Key)
		}
		ob, err := Outbound(e.Node, "out-"+e.Key)
		if err != nil {
			return nil, err
		}
		inbounds = append(inbounds, M{
			"tag": "in-" + e.Key, "listen": "127.0.0.1", "port": e.Port, "protocol": "socks",
			"settings": M{"auth": "password", "accounts": []M{{"user": e.User, "pass": e.Pass}}, "udp": true, "ip": "127.0.0.1"},
		})
		outbounds = append(outbounds, ob)
		rules = append(rules, M{"type": "field", "inboundTag": []string{"in-" + e.Key}, "outboundTag": "out-" + e.Key})
	}
	if logLevel == "" {
		logLevel = "warning"
	}
	cfg := M{
		"log": M{"loglevel": logLevel},
		// The DNS module's own queries are routed like any traffic and would
		// otherwise take the default (first) outbound — the node, whose server
		// name is what we are resolving — so they go out a freedom outbound.
		"dns":       M{"servers": directDNS, "queryStrategy": "UseIP", "tag": dnsTag},
		"inbounds":  inbounds,
		"outbounds": append(outbounds, M{"tag": directTag, "protocol": "freedom"}),
		"routing":   M{"domainStrategy": "AsIs", "rules": append([]M{{"type": "field", "inboundTag": []string{dnsTag}, "outboundTag": directTag}}, rules...)},
	}
	return json.MarshalIndent(cfg, "", "  ")
}

// Outbound converts a node into an Xray outbound object.
func Outbound(n *nodes.Node, tag string) (M, error) {
	var settings M
	switch n.Type {
	case "vless":
		settings = M{"address": n.Server, "port": n.Port, "id": n.UUID, "encryption": firstNonEmpty(n.Encryption, "none")}
		if n.Flow != "" {
			settings["flow"] = n.Flow
		}
	case "vmess":
		settings = M{"address": n.Server, "port": n.Port, "id": n.UUID, "security": firstNonEmpty(n.Cipher, "auto")}
	case "trojan":
		settings = M{"address": n.Server, "port": n.Port, "password": n.Password}
	case "shadowsocks", "socks", "http":
		if !n.XraySupports() {
			return nil, fmt.Errorf("xray: unsupported node %q (shadowsocks plugin?)", n.Name)
		}
		settings = plainSettings(n)
	default:
		return nil, fmt.Errorf("xray: unsupported node type %q", n.Type)
	}
	stream, err := streamSettings(n)
	if err != nil {
		return nil, err
	}
	return M{"tag": tag, "protocol": n.Type, "settings": settings, "streamSettings": stream}, nil
}

func streamSettings(n *nodes.Node) (M, error) {
	network := n.XrayNetwork()
	s := M{"network": network, "sockopt": M{"domainStrategy": resolveStrategy}}
	switch network {
	case nodes.NetXHTTP:
		x := M{"path": firstNonEmpty(n.Path, "/")}
		if n.Host != "" {
			x["host"] = n.Host
		}
		if n.Mode != "" {
			x["mode"] = n.Mode
		}
		if n.Extra != "" {
			x["extra"] = json.RawMessage(n.Extra)
		}
		s["xhttpSettings"] = x
	case nodes.NetKCP:
		s["kcpSettings"] = M{}
		if mask := kcpMask(n); mask != nil {
			s["finalmask"] = M{"udp": mask}
		}
	case "ws":
		ws := M{"path": firstNonEmpty(n.Path, "/")}
		if n.Host != "" {
			ws["host"] = n.Host
		}
		s["wsSettings"] = ws
	case "grpc":
		s["grpcSettings"] = M{"serviceName": n.Path}
	case "raw":
	default:
		return nil, fmt.Errorf("xray: unsupported transport %q", n.Network)
	}
	security(n, s)
	return s, nil
}

// kcpMask maps the legacy mKCP header / seed to Xray v26 FinalMask
// "mkcp-legacy" (header and seed were removed from kcpSettings). With
// neither set, legacy servers still use the old default XOR obfuscation.
func kcpMask(n *nodes.Node) []M {
	header := n.HeaderType
	if header == "none" {
		header = ""
	}
	switch header {
	case "wechat-video":
		header = "wechat"
	case "dtls", "srtp", "utp", "wireguard", "dns", "":
	default:
		header = ""
	}
	var masks []M
	if header != "" {
		masks = append(masks, M{"type": "mkcp-legacy", "settings": M{"header": header}})
	}
	if n.Seed != "" || header == "" {
		masks = append(masks, M{"type": "mkcp-legacy", "settings": M{"value": n.Seed}})
	}
	return masks
}

func security(n *nodes.Node, s M) {
	sni := firstNonEmpty(n.SNI, n.Host, n.Server)
	switch n.Security {
	case "reality":
		r := M{"serverName": sni, "fingerprint": firstNonEmpty(n.Fingerprint, "chrome"), "password": n.PublicKey, "shortId": n.ShortID}
		if n.SpiderX != "" {
			r["spiderX"] = n.SpiderX
		}
		if n.PQV != "" {
			r["mldsa65Verify"] = n.PQV
		}
		s["security"] = "reality"
		s["realitySettings"] = r
	case "tls", "xtls":
		// No "allowInsecure": Xray v26 refuses to start with it since
		// 2026-06-01 (pinnedPeerCertSha256 replaces it), so an insecure node
		// fails its own handshake instead of taking the whole sidecar down.
		t := M{"serverName": sni}
		if n.Fingerprint != "" {
			t["fingerprint"] = n.Fingerprint
		}
		if len(n.ALPN) > 0 {
			t["alpn"] = n.ALPN
		}
		tlsExtras(n, t)
		s["security"] = "tls"
		s["tlsSettings"] = t
	default:
		s["security"] = "none"
	}
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
