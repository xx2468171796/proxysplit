package core

import (
	"fmt"
	"os"

	"proxysplit/internal/nodes"
)

// withRealityHybrid sets `tls.reality.relayops_hybrid` on a VLESS + Reality
// outbound (relayops patch 0005). Callers only pass POWER云 signed outbounds
// and only when the bundled core has coreupdate.RealityHybridTag.
func withRealityHybrid(m M) {
	if m["type"] != "vless" {
		return
	}
	tls, _ := m["tls"].(map[string]interface{})
	reality, _ := tls["reality"].(map[string]interface{})
	if reality == nil || reality["enabled"] != true {
		return
	}
	reality["relayops_hybrid"] = true
}

// buildOutbound converts a Node into a sing-box outbound object.
// buildOutbounds returns the outbound(s) for a node: the first one carries tag
// (what routes point at); raw-backed nodes may add helper outbounds (urltest
// members, detours) whose tags are prefixed with tag.
func buildOutbounds(n *nodes.Node, tag string, realityHybrid bool) ([]M, error) {
	if n.HasRaw() {
		return buildRawOutbounds(n, tag, realityHybrid && n.Official)
	}
	ob, err := buildOutbound(n, tag)
	if err != nil {
		return nil, err
	}
	// Compat: Clash smux / brutal-opts → sing-box multiplex (only when the
	// subscription asked for it; never added on our own).
	// VLESS vision flow cannot be multiplexed (sing-box rejects the config).
	if len(n.Multiplex) > 0 && n.Flow == "" {
		switch n.Type {
		case "vless", "vmess", "trojan", "shadowsocks":
			ob["multiplex"] = n.Multiplex
		}
	}
	return []M{ob}, nil
}

// buildRawOutbounds emits the node's verbatim sing-box outbounds. Only tags are
// rewritten: the entry outbound becomes tag, every other outbound becomes
// "tag/<original>", and references (group members, selector default, detour)
// are renamed to match. All other parameters are passed through untouched,
// except that third-party outbounds lose fields that only work on the
// author's machine (nodes.NeutraliseForeign).
func buildRawOutbounds(n *nodes.Node, tag string, realityHybrid bool) ([]M, error) {
	entry := n.EntryTag
	decoded := make([]M, 0, len(n.Outbounds))
	rename := map[string]string{}
	for i, raw := range n.Outbounds {
		m, err := nodes.DecodeOutbound(raw)
		if err != nil {
			return nil, fmt.Errorf("node %q: bad outbound: %w", n.Name, err)
		}
		orig, _ := m["tag"].(string)
		if entry == "" && i == 0 {
			entry = orig
		}
		if !n.Official {
			// Someone else's sing-box config: drop references to their DNS
			// servers, files and network setup, or the core would not start.
			// (POWER云 profiles are signed and passed through untouched.)
			nodes.NeutraliseForeign(m, localFileExists)
		}
		if realityHybrid {
			withRealityHybrid(m)
		}
		decoded = append(decoded, M(m))
		if orig != "" {
			rename[orig] = tag + "/" + orig
		}
	}
	if _, ok := rename[entry]; !ok {
		return nil, fmt.Errorf("node %q: entry outbound %q missing", n.Name, entry)
	}
	rename[entry] = tag
	var badRef string
	ref := func(v string) string {
		if r, ok := rename[v]; ok {
			return r
		}
		// Only "direct" exists in every generated config; any other outside
		// reference would silently bind to one of our own outbounds (e.g.
		// another node's tag), so it is rejected.
		if v != "direct" && badRef == "" {
			badRef = v
		}
		return v
	}
	out := make([]M, 0, len(decoded))
	var entryOb M
	for _, m := range decoded {
		orig, _ := m["tag"].(string)
		m["tag"] = ref(orig)
		if list, ok := m["outbounds"].([]any); ok {
			renamed := make([]any, len(list))
			for i, v := range list {
				if sv, ok := v.(string); ok {
					renamed[i] = ref(sv)
				} else {
					renamed[i] = v
				}
			}
			m["outbounds"] = renamed
		}
		for _, k := range []string{"default", "detour"} {
			if sv, ok := m[k].(string); ok && sv != "" {
				m[k] = ref(sv)
			}
		}
		if orig == entry {
			entryOb = m
		} else {
			out = append(out, m)
		}
	}
	if badRef != "" {
		return nil, fmt.Errorf("node %q: outbound references unknown tag %q", n.Name, badRef)
	}
	return append([]M{entryOb}, out...), nil
}

// localFileExists reports whether a file referenced by an imported outbound
// is present on this machine.
func localFileExists(path string) bool {
	st, err := os.Stat(path)
	return err == nil && !st.IsDir()
}

func buildOutbound(n *nodes.Node, tag string) (M, error) {
	if n == nil {
		return nil, fmt.Errorf("nil node")
	}
	switch n.Type {
	case "vless":
		return buildVLESS(n, tag), nil
	case "vmess":
		return buildVMess(n, tag), nil
	case "trojan":
		return buildTrojan(n, tag), nil
	case "shadowsocks":
		return buildShadowsocks(n, tag), nil
	case "socks":
		return buildSocks(n, tag), nil
	case "http":
		return buildHTTP(n, tag), nil
	case "hysteria2":
		return buildHysteria2(n, tag), nil
	case "tuic":
		return buildTUIC(n, tag), nil
	case "anytls":
		return buildAnyTLS(n, tag), nil
	default:
		return nil, fmt.Errorf("unsupported node type %q", n.Type)
	}
}

func buildSocks(n *nodes.Node, tag string) M {
	o := M{"type": "socks", "tag": tag, "server": n.Server, "server_port": n.Port, "version": "5"}
	if n.Username != "" {
		o["username"] = n.Username
	}
	if n.Password != "" {
		o["password"] = n.Password
	}
	return o
}

func buildHTTP(n *nodes.Node, tag string) M {
	o := M{"type": "http", "tag": tag, "server": n.Server, "server_port": n.Port}
	if n.Username != "" {
		o["username"] = n.Username
	}
	if n.Password != "" {
		o["password"] = n.Password
	}
	if n.Security == "tls" {
		o["tls"] = M{"enabled": true, "server_name": firstNonEmpty(n.SNI, n.Server), "insecure": n.Insecure}
	}
	return o
}

func buildHysteria2(n *nodes.Node, tag string) M {
	tls := M{"enabled": true, "server_name": firstNonEmpty(n.SNI, n.Server), "insecure": n.Insecure}
	if len(n.ALPN) > 0 {
		tls["alpn"] = n.ALPN
	}
	return M{"type": "hysteria2", "tag": tag, "server": n.Server, "server_port": n.Port, "password": n.Password, "tls": tls}
}

func buildAnyTLS(n *nodes.Node, tag string) M {
	tls := M{"enabled": true, "server_name": firstNonEmpty(n.SNI, n.Server), "insecure": n.Insecure}
	if len(n.ALPN) > 0 {
		tls["alpn"] = n.ALPN
	}
	return M{"type": "anytls", "tag": tag, "server": n.Server, "server_port": n.Port, "password": n.Password, "tls": tls}
}

func buildTUIC(n *nodes.Node, tag string) M {
	tls := M{"enabled": true, "server_name": firstNonEmpty(n.SNI, n.Server), "insecure": n.Insecure}
	if len(n.ALPN) > 0 {
		tls["alpn"] = n.ALPN
	}
	return M{
		"type": "tuic", "tag": tag, "server": n.Server, "server_port": n.Port,
		"uuid": n.UUID, "password": n.Password, "congestion_control": firstNonEmpty(n.CC, "bbr"), "tls": tls,
	}
}

func buildVLESS(n *nodes.Node, tag string) M {
	o := M{
		"type":        "vless",
		"tag":         tag,
		"server":      n.Server,
		"server_port": n.Port,
		"uuid":        n.UUID,
	}
	if n.Flow != "" {
		o["flow"] = n.Flow
	}
	if tls := buildTLS(n); tls != nil {
		o["tls"] = tls
	}
	if tr := buildTransport(n); tr != nil {
		o["transport"] = tr
	}
	return o
}

func buildVMess(n *nodes.Node, tag string) M {
	o := M{
		"type":        "vmess",
		"tag":         tag,
		"server":      n.Server,
		"server_port": n.Port,
		"uuid":        n.UUID,
		"alter_id":    n.AlterID,
		"security":    firstNonEmpty(n.Cipher, "auto"),
	}
	if tls := buildTLS(n); tls != nil {
		o["tls"] = tls
	}
	if tr := buildTransport(n); tr != nil {
		o["transport"] = tr
	}
	return o
}

func buildTrojan(n *nodes.Node, tag string) M {
	o := M{
		"type":        "trojan",
		"tag":         tag,
		"server":      n.Server,
		"server_port": n.Port,
		"password":    n.Password,
	}
	// trojan is TLS by default
	if tls := buildTLS(n); tls != nil {
		o["tls"] = tls
	} else {
		o["tls"] = M{"enabled": true, "server_name": firstNonEmpty(n.SNI, n.Server), "insecure": n.Insecure}
	}
	if tr := buildTransport(n); tr != nil {
		o["transport"] = tr
	}
	return o
}

func buildShadowsocks(n *nodes.Node, tag string) M {
	o := M{
		"type":        "shadowsocks",
		"tag":         tag,
		"server":      n.Server,
		"server_port": n.Port,
		"method":      n.Method,
		"password":    n.Password,
	}
	if n.Plugin != "" {
		o["plugin"] = n.Plugin
		if n.PluginOpts != "" {
			o["plugin_opts"] = n.PluginOpts
		}
	}
	return o
}

// buildTLS returns a sing-box tls block, or nil when the node uses no TLS.
func buildTLS(n *nodes.Node) M {
	switch n.Security {
	case "tls", "reality", "xtls":
	default:
		return nil
	}
	tls := M{
		"enabled":     true,
		"server_name": firstNonEmpty(n.SNI, n.Host, n.Server),
		"insecure":    n.Insecure,
	}
	if len(n.ALPN) > 0 {
		tls["alpn"] = n.ALPN
	}
	if n.Fingerprint != "" {
		tls["utls"] = M{"enabled": true, "fingerprint": n.Fingerprint}
	}
	if n.Security == "reality" && n.PublicKey != "" {
		tls["reality"] = M{
			"enabled":    true,
			"public_key": n.PublicKey,
			"short_id":   n.ShortID,
		}
		// Reality mandates a real uTLS fingerprint.
		if n.Fingerprint == "" {
			tls["utls"] = M{"enabled": true, "fingerprint": "chrome"}
		}
	}
	return tls
}

// buildTransport returns a sing-box transport block for ws/grpc/http, or nil for
// plain TCP.
func buildTransport(n *nodes.Node) M {
	switch n.Network {
	case "ws", "websocket":
		t := M{"type": "ws"}
		if n.Path != "" {
			t["path"] = n.Path
		}
		if n.Host != "" {
			t["headers"] = M{"Host": n.Host}
		}
		return t
	case "grpc":
		return M{"type": "grpc", "service_name": n.Path}
	case "http", "h2":
		t := M{"type": "http"}
		if n.Path != "" {
			t["path"] = n.Path
		}
		if n.Host != "" {
			t["host"] = []string{n.Host}
		}
		return t
	default:
		return nil
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

// remoteDNSServer is the foreign resolver reached through the node. SOCKS5 and
// HTTP proxies often cannot relay UDP (HTTP never can; many sold SOCKS5 IPs
// skip UDP ASSOCIATE), so plain UDP DNS through them fails and every foreign
// site looks dead while v2rayN (system proxy, remote hostname) still works.
// Those nodes get DNS over TCP instead.
func remoteDNSServer(n *nodes.Node, detour string) M {
	typ := "udp"
	if n != nil && (n.Type == "socks" || n.Type == "http") {
		typ = "tcp"
	}
	return M{"type": typ, "tag": "dns-remote", "server": "8.8.8.8", "detour": detour}
}
