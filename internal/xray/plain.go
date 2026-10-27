package xray

import "proxysplit/internal/nodes"

// plainSettings is the flat outbound "settings" of shadowsocks / socks / http
// (Xray docs: outbounds/shadowsocks.md, socks.md, http.md — address, port,
// method + password for shadowsocks, optional user + pass for socks / http).
// HTTPS proxies get TLS from streamSettings (security "tls").
func plainSettings(n *nodes.Node) M {
	s := M{"address": n.Server, "port": n.Port}
	if n.Type == "shadowsocks" {
		s["method"] = n.Method
		s["password"] = n.Password
		return s
	}
	if n.Username != "" || n.Password != "" {
		s["user"] = n.Username
		s["pass"] = n.Password
	}
	return s
}

// tlsExtras adds the Xray v26 tlsSettings fields sing-box has no equivalent
// for here (names from v26.6.1 infra/conf/transport_internet.go TLSConfig).
func tlsExtras(n *nodes.Node, t M) {
	if n.ECH != "" {
		t["echConfigList"] = n.ECH
		if n.ECHForceQuery != "" {
			t["echForceQuery"] = n.ECHForceQuery
		}
	}
	if n.PinnedCert != "" {
		t["pinnedPeerCertSha256"] = n.PinnedCert
	}
}
