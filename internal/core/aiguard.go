package core

// AIGuard (AI-site customers) pins AI services to our own line. Its rules sit
// right after the housekeeping rules (sniff, DNS hijack, 拦截 apps, our API, LAN)
// and before every app list and 代理策略, so whichever program connects —
// listed or not, 直连 / 规则 / 全局 — AI traffic leaves through Outbound and
// never from the customer's own (mainland) IP:
//   - QUIC to AI is rejected, so the connection retries over TCP where the
//     domain is always sniffed (and the TLS fingerprint is the browser's own);
//   - AI names resolve through Outbound, IPv4 only (AAAA / HTTPS answers
//     blanked, short TTL), and the TUN gets an IPv6 address so any IPv6 the
//     app learns elsewhere still enters the tunnel instead of going around it;
//   - the Windows AI lock (NRPT, package aiguard) sends AI names to the TUN's
//     IPv6 peer while the core runs; the TUN's DNS hijack answers them here.
//
// Outbound "reject" (no line of ours is available) makes AI unreachable rather
// than direct. The 仅 AI / blocked-list rewrite (restrictEgress) never touches
// these rules: sending AI direct would defeat the purpose.
type AIGuard struct {
	DomainSuffixes []string
	Domains        []string
	IPCIDRs        []string
	Outbound       string // "proxy", "node-<id>" or "reject"
	// STUNProcesses send their WebRTC STUN through Outbound too, so a page's
	// ICE candidates show the AI exit instead of the customer's mainland IP
	// (browsers and the AI desktop apps; other programs' calls are untouched).
	STUNProcesses []string
}

const aiDNSServer = "dns-ai"

func (g *AIGuard) active() bool {
	return g != nil && g.Outbound != "" && (len(g.DomainSuffixes)+len(g.Domains)+len(g.IPCIDRs)) > 0
}

// match is the destination condition (domain and IP fields are OR'ed inside
// one sing-box rule).
func (g *AIGuard) match(withIPs bool) M {
	m := M{}
	if v := cleanList(g.DomainSuffixes); len(v) > 0 {
		m["domain_suffix"] = v
	}
	if v := cleanList(g.Domains); len(v) > 0 {
		m["domain"] = v
	}
	if withIPs {
		if v := cleanList(g.IPCIDRs); len(v) > 0 {
			m["ip_cidr"] = v
		}
	}
	return m
}

// aiTUN6 gives the TUN an IPv6 address, so IPv6 enters the tunnel too and
// follows the same rules as IPv4. Without it an IPv4-only TUN leaves every
// IPv6 connection outside: a proxied app reaching an IPv6 address would leave
// from this PC's own IPv6 (real-IP leak, 业主 2026-10-28), and an AI address
// learnt outside our DNS (app DoH, hosts file) would bypass the guard. DNS
// answers are IPv4-only and public IPv6 is refused (tunIPv6Rules). Its
// peer ::2 is the AI lock's DNS server (aiguard.TunnelServer) while the core
// runs.
const aiTUN6 = "fdfe:dcba:9876::1/126"

// tunIPv6Rules refuse public IPv6 destinations that reach the TUN, after the
// DNS hijack, LAN / private addresses, ProxySplit itself and the direct app
// list, and before anything that could send them to a node. Our DNS only answers
// IPv4, so these are apps with their own resolver or literal addresses: a
// node usually cannot dial IPv6, and a refused connection makes the app fall
// back to IPv4 at once instead of retrying a tunnel that never connects. IPv6
// therefore never leaks around the proxy and never hangs.
func tunIPv6Rules() []M {
	return []M{{"ip_version": 6, "action": "reject"}}
}

// tunPreSniffRules run ahead of sniff, while a TUN connection is still a bare
// SYN / packet:
//   - public IPv6 (DNS excepted, hijacked below) is refused for every app, the
//     direct ones too. Refused after sniff, the TUN has already completed the
//     handshake, so the app sees "connected, then closed" and keeps retrying
//     IPv6 instead of falling back; on a PC without an IPv6 uplink WeChat
//     failed to send images that way (业主 2026-10-28, 240e:… "unreachable
//     network" in a loop). A refused SYN makes it use IPv4 at once.
//   - ICMP (ping, WinMTR) goes direct: only the direct outbound can carry it,
//     so in 默认全走代理 it was refused by the node and the app looked
//     "proxied though set to 不走代理" (customer, 2026-10-28).
func tunPreSniffRules() []M {
	return []M{
		{"type": "logical", "mode": "and", "rules": []M{
			{"ip_version": 6},
			{"ip_is_private": true, "invert": true},
			{"port": []int{53}, "invert": true},
		}, "action": "reject"},
		{"network": []string{"icmp"}, "outbound": "direct"},
	}
}

// tunAddresses is the TUN inbound's address list: IPv4 and IPv6, always.
func tunAddresses(Options) []string {
	return []string{"172.19.0.1/30", aiTUN6}
}

// aiDNSTTL caps the TTL clients see for AI names, so after the core stops
// cached addresses run out within seconds (the service also flushes the
// Windows cache on stop); the core keeps its own cache.
const aiDNSTTL = 10

// aiGuardRules are the route entries; nil when the guard is off.
func aiGuardRules(opts Options) []M {
	g := opts.AIGuard
	if !g.active() {
		return nil
	}
	quic := g.match(true)
	quic["network"] = []string{"udp"}
	quic["port"] = []int{443}
	quic["action"] = "reject"
	// AI over IPv6 (app DoH, cached AAAA): refused like any public IPv6
	// (tunIPv6Rules) so the app retries IPv4 through the line at once.
	v6 := g.match(true)
	v6["ip_version"] = 6
	v6["action"] = "reject"
	rules := []M{quic, v6, emit(g.match(true), g.Outbound)}
	if procs := cleanList(g.STUNProcesses); len(procs) > 0 {
		rules = append(rules, emit(M{"protocol": []string{"stun"}, "process_name": procs}, g.Outbound))
	}
	return rules
}

// aiGuardDNS returns the DNS rules for AI names (IPv6-bearing answers blanked,
// then resolve through the guard's line) and, when that is not the active
// node, the extra server it uses.
func aiGuardDNS(opts Options) (rules []M, server M) {
	g := opts.AIGuard
	if !g.active() {
		return nil, nil
	}
	m := g.match(false)
	if len(m) == 0 {
		return nil, nil
	}
	target := "dns-remote"
	if g.Outbound != "proxy" && g.Outbound != "reject" {
		target = aiDNSServer
		server = M{"type": "udp", "tag": aiDNSServer, "server": "8.8.8.8", "detour": g.Outbound}
	}
	noV6 := cloneMatch(m)
	noV6["query_type"] = []string{"AAAA", "HTTPS"}
	noV6["action"] = "predefined"
	noV6["rcode"] = "NOERROR"
	route := cloneMatch(m)
	route["action"] = "route"
	route["server"] = target
	route["rewrite_ttl"] = aiDNSTTL
	return []M{noV6, route}, server
}

// AIProxy is a loopback-only proxy (with credentials) whose every connection
// leaves through the AI line: other programs on this PC (the aigw switcher's
// fingerprint browser) point at it to reach AI from our exit and never direct.
// Independent of the guard: present whenever the core runs with a line.
type AIProxy struct {
	Port       int
	User, Pass string
	Outbound   string // "proxy", "node-<id>" or "reject"
}

const aiProxyInbound = "ai-proxy-in"

func aiProxyInboundFor(opts Options) M {
	p := opts.AIProxy
	if p == nil || p.Port <= 0 || p.Outbound == "" {
		return nil
	}
	in := M{"type": "mixed", "tag": aiProxyInbound, "listen": "127.0.0.1", "listen_port": p.Port}
	if p.User != "" {
		in["users"] = []M{{"username": p.User, "password": p.Pass}}
	}
	return in
}

// aiProxyRules: everything entering the AI proxy takes the AI line (or is
// rejected) — kept in the AI block so no app list / 代理策略 / egress rewrite
// can send it direct.
func aiProxyRules(opts Options) []M {
	if aiProxyInboundFor(opts) == nil {
		return nil
	}
	return []M{emit(M{"inbound": []string{aiProxyInbound}}, opts.AIProxy.Outbound)}
}

// ExitProbe (same shape as AIProxy, Outbound "proxy") is the AI page's
// loopback way into the selected node: TUN mode has no per-line inbound, and
// ProxySplit's own traffic is never tunnelled, so the live 分应用代理出口 is
// measured through this.
const exitProbeInbound = "exit-probe-in"

func exitProbeInboundFor(opts Options) M {
	p := opts.ExitProbe
	if p == nil || p.Port <= 0 || p.User == "" {
		return nil
	}
	return M{"type": "mixed", "tag": exitProbeInbound, "listen": "127.0.0.1", "listen_port": p.Port,
		"users": []M{{"username": p.User, "password": p.Pass}}}
}

func exitProbeRules(opts Options) []M {
	if exitProbeInboundFor(opts) == nil {
		return nil
	}
	return []M{emit(M{"inbound": []string{exitProbeInbound}}, "proxy")}
}
