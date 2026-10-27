package core

import (
	"net/netip"
	"strings"

	"proxysplit/internal/nodes"
)

// PinNode returns a copy of n that dials ips[n.Server] (the pre-resolved
// address, internal/noderesolve) while every name the protocol derived from
// the domain stays exactly what it was: the TLS / REALITY server name the
// builders would have picked (sing-box buildTLS / Xray security use
// SNI→Host→Server, the others SNI→Server) and the HTTP Host of ws / http /
// h2 / httpupgrade / xhttp transports. n itself is returned when there is
// nothing to pin: no entry, already an IP, raw sing-box outbounds (verbatim,
// incl. POWER云 signed profiles), or shadowsocks plugins (obfs host
// defaults are plugin-specific).
func PinNode(n *nodes.Node, ips map[string]string) *nodes.Node {
	if n == nil || len(ips) == 0 || n.HasRaw() {
		return n
	}
	ip := ips[n.Server]
	if ip == "" || ip == n.Server {
		return n
	}
	if _, err := netip.ParseAddr(n.Server); err == nil {
		return n
	}
	if n.Type == "shadowsocks" && n.Plugin != "" {
		return n
	}
	c := *n
	c.Server = ip
	if c.SNI == "" {
		c.SNI = implicitServerName(n)
	}
	if c.Host == "" && hostHeaderTransport(n.Network) {
		c.Host = n.Server
	}
	return &c
}

// implicitServerName is the server name the outbound builders use when the
// node has no SNI.
func implicitServerName(n *nodes.Node) string {
	switch n.Type {
	case "vless", "vmess", "trojan":
		switch n.Security {
		case "tls", "reality", "xtls":
			return firstNonEmpty(n.Host, n.Server)
		}
	}
	return n.Server
}

// hostHeaderTransport: transports whose HTTP Host header defaults to the
// dialed address.
func hostHeaderTransport(network string) bool {
	switch strings.ToLower(strings.TrimSpace(network)) {
	case "ws", "websocket", "http", "h2", "httpupgrade", "xhttp", "splithttp":
		return true
	}
	return false
}

// pinAll maps PinNode over a node list.
func pinAll(list []*nodes.Node, ips map[string]string) []*nodes.Node {
	if len(ips) == 0 {
		return list
	}
	out := make([]*nodes.Node, len(list))
	for i, n := range list {
		out[i] = PinNode(n, ips)
	}
	return out
}
