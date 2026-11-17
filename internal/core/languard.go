package core

import (
	"net"
	"sort"
	"strconv"
)

// selfCIDRs are the destinations that mean "this machine itself".
var selfCIDRs = []string{"127.0.0.0/8", "0.0.0.0/32", "::1/128", "::/128", "::ffff:127.0.0.0/104"}

// lanGuardRules keeps the clients of a LAN-shared inbound (listening on every
// interface, often without credentials) away from this machine itself. Without
// them `ip_is_private → direct` (and 直连 mode) made the inbound a way into
// every loopback service — other local proxies, dev servers, our control API.
// Rejected: loopback addresses and names, and — on private addresses, i.e. this
// machine's own LAN address — the local ports this config opens. They must
// come before any rule that can send the inbound's traffic direct.
func lanGuardRules(inbound string, ownPorts []int) []M {
	in := []string{inbound}
	rules := []M{
		{"inbound": in, "ip_cidr": selfCIDRs, "action": "reject"},
		{"inbound": in, "domain": []string{"localhost"}, "domain_suffix": []string{".localhost"}, "action": "reject"},
	}
	if ports := uniquePorts(ownPorts); len(ports) > 0 {
		rules = append(rules, M{"inbound": in, "ip_is_private": true, "port": ports, "action": "reject"})
	}
	return rules
}

// uniquePorts returns the valid ports sorted, without duplicates (the config
// must be byte-stable).
func uniquePorts(ports []int) []int {
	seen := map[int]bool{}
	var out []int
	for _, p := range ports {
		if p > 0 && p <= 65535 && !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	sort.Ints(out)
	return out
}

// controllerPort is the port of a "host:port" clash controller address (0 = none).
func controllerPort(addr string) int {
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return 0
	}
	n, _ := strconv.Atoi(port)
	return n
}

// lanSelfRules is lanGuardRules for the main core's LAN inbound (nil when LAN
// sharing is off), closing every local port this config opens. extra adds the
// ports the caller's inbounds use.
func lanSelfRules(opts Options, extra ...int) []M {
	if !opts.LanShare {
		return nil
	}
	lanPort := opts.LanPort
	if lanPort == 0 {
		lanPort = 7890
	}
	ports := append([]int{lanPort, controllerPort(opts.ClashController), opts.AccelPort}, extra...)
	if opts.AIProxy != nil {
		ports = append(ports, opts.AIProxy.Port)
	}
	if opts.ExitProbe != nil {
		ports = append(ports, opts.ExitProbe.Port)
	}
	if opts.Process != nil {
		for _, p := range opts.Process.Ports {
			ports = append(ports, p)
		}
	}
	return lanGuardRules("in-lan", ports)
}
