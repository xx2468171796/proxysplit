// Package hostnet holds host network facts shared by service and noderesolve.
package hostnet

import (
	"net"
	"net/netip"
)

// ourTUN6 is the IPv6 prefix our own TUN carries while AI 劫持 is on
// (core.aiTUN6); a route through it is not real IPv6 connectivity.
var ourTUN6 = netip.MustParsePrefix("fdfe:dcba:9876::/48")

// teredo is Windows' IPv4-tunnelled pseudo IPv6 — not a usable uplink.
var teredo = netip.MustParsePrefix("2001::/32")

// HasIPv6 reports whether the OS has an IPv6 route to the internet. A UDP
// "connect" only consults the routing table — no packet is sent.
func HasIPv6() bool {
	c, err := net.Dial("udp6", "[2400:3200::1]:53")
	if err != nil {
		return false
	}
	defer c.Close()
	ap, err := netip.ParseAddrPort(c.LocalAddr().String())
	if err != nil {
		return false
	}
	a := ap.Addr().Unmap()
	return a.IsGlobalUnicast() && !a.IsPrivate() && !ourTUN6.Contains(a) && !teredo.Contains(a)
}
