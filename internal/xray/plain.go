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
