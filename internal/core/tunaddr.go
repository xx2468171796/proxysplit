package core

import (
	"net"
	"net/netip"
)

// tunAddr4Pool are the TUN's IPv4 /30 candidates, first free wins. Hyper-V's
// Default Switch, WSL and Docker take random 172.16/12 subnets; when one covers
// ours sing-box fails with "set ipv4 address: The object already exists"
// (v2rayN #9810), so the others stay outside 172.16/12. 198.18/15 is the
// benchmarking range (RFC 2544), never assigned on real networks.
var tunAddr4Pool = []string{"172.19.0.1/30", "198.18.0.1/30", "10.255.254.1/30"}

// localPrefixes lists the host's interface subnets (stubbed in tests).
var localPrefixes = func() []netip.Prefix {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return nil
	}
	var out []netip.Prefix
	for _, a := range addrs {
		if n, ok := a.(*net.IPNet); ok {
			if p, err := netip.ParsePrefix(n.String()); err == nil {
				out = append(out, p)
			}
		}
	}
	return out
}

// tunAddr4 picks the first pool subnet no other interface overlaps. An
// interface holding exactly our address is our own TUN from a previous run.
func tunAddr4() string {
	local := localPrefixes()
	for _, c := range tunAddr4Pool {
		cp := netip.MustParsePrefix(c)
		free := true
		for _, p := range local {
			if p.Addr() == cp.Addr() {
				continue
			}
			if p.Overlaps(cp.Masked()) {
				free = false
				break
			}
		}
		if free {
			return c
		}
	}
	return tunAddr4Pool[0]
}
