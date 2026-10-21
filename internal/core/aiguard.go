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
//   - DNSListen is the loopback DNS server the Windows AI lock (NRPT, package
//     aiguard) sends AI names to. Loopback so a lookup can never leave the
//     machine: core up = answered here, core down = refused at once (a
//     non-loopback address was answered by DNS-hijacking routers instead).
//
// Outbound "reject" (no line of ours is available) makes AI unreachable rather
// than direct. The 仅 AI / blocked-list rewrite (restrictEgress) never touches
// these rules: sending AI direct would defeat the purpose.
type AIGuard struct {
	DomainSuffixes []string
	Domains        []string
	IPCIDRs        []string
	Outbound       string // "proxy", "node-<id>" or "reject"
	DNSListen      string // e.g. "127.0.0.53" (port 53); "" = no listener
}

const (
	aiDNSServer  = "dns-ai"
	aiDNSInbound = "ai-dns-in"
)

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

// aiTUN6 gives the TUN an IPv6 address while the guard is on, so IPv6 also
// enters the tunnel (an AI address learnt outside our DNS — app DoH, hosts
// file — would otherwise go straight out over IPv6); non-AI IPv6 still
// follows the normal rules.
const aiTUN6 = "fdfe:dcba:9876::1/126"

// tunAddresses is the TUN inbound's address list.
func tunAddresses(opts Options) []string {
	if opts.AIGuard.active() {
		return []string{"172.19.0.1/30", aiTUN6}
	}
	return []string{"172.19.0.1/30"}
}

// aiDNSTTL caps the TTL clients see for AI names, so after the core stops
// cached addresses run out within seconds (the service also flushes the
// Windows cache on stop); the core keeps its own cache.
const aiDNSTTL = 10

// aiGuardInbound is the loopback DNS listener (nil when off / no address).
func aiGuardInbound(opts Options) M {
	g := opts.AIGuard
	if !g.active() || g.DNSListen == "" {
		return nil
	}
	return M{"type": "direct", "tag": aiDNSInbound, "listen": g.DNSListen, "listen_port": 53}
}

// aiGuardHijack answers the listener's queries with our DNS (first rule).
func aiGuardHijack(opts Options) []M {
	if aiGuardInbound(opts) == nil {
		return nil
	}
	return []M{{"inbound": []string{aiDNSInbound}, "action": "hijack-dns"}}
}

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
	return []M{quic, emit(g.match(true), g.Outbound)}
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
