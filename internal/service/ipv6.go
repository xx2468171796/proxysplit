package service

import (
	"net"
	"net/netip"
)

// ourTUN6 is the IPv6 prefix our own TUN carries while AI 劫持 is on
// (core.aiTUN6); a route through it is not real IPv6 connectivity.
var ourTUN6 = netip.MustParsePrefix("fdfe:dcba:9876::/48")

// teredo is Windows' IPv4-tunnelled pseudo IPv6 — not a usable uplink.
var teredo = netip.MustParsePrefix("2001::/32")

// hostIPv6 is hostHasIPv6 measured while our core is stopped: once the TUN
// carries IPv6, the OS routes IPv6 into it and the probe would always say
// "none". While the core runs, the last stopped-time answer is reused.
func (s *Service) hostIPv6() bool {
	if s.coreRunning() && s.hostIPv6Known.Load() {
		return s.hostIPv6Seen.Load()
	}
	v := hostHasIPv6()
	s.hostIPv6Seen.Store(v)
	s.hostIPv6Known.Store(true)
	return v
}

// hostHasIPv6 reports whether the OS has an IPv6 route to the internet. A UDP
// "connect" only consults the routing table — no packet is sent.
func hostHasIPv6() bool {
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
