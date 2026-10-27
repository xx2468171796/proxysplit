package core

import (
	"fmt"
	"strings"

	"proxysplit/internal/nodes"
)

// BuildTUNConfig generates a system-wide TUN config (v2rayN-style global/rule):
// a sing-box tun inbound (wintun) captures ALL system traffic and routes it per
// the given mode out through the node. No WinDivert engine is used in this mode.
func BuildTUNConfig(node *nodes.Node, logLevel string, opts Options) ([]byte, error) {
	t, err := buildTUNTree(node, logLevel, opts)
	if err != nil {
		return nil, err
	}
	return marshalConfig(t.root())
}

// tunTree is BuildTUNConfig before marshalling, split into the sections
// BuildProcessConfig rewrites (inbounds, route rules, route rule-sets).
type tunTree struct {
	Log          M
	DNS          M
	Inbounds     []M
	Outbounds    []M
	Route        M // route options other than rules / rule_set
	Rules        []M
	RuleSets     []M
	Experimental M // nil = none
}

// root assembles the sing-box config object.
func (t tunTree) root() M {
	route := M{"rules": t.Rules, "rule_set": t.RuleSets}
	for k, v := range t.Route {
		route[k] = v
	}
	cfg := M{
		"log":       t.Log,
		"dns":       t.DNS,
		"inbounds":  t.Inbounds,
		"outbounds": t.Outbounds,
		"route":     route,
	}
	if t.Experimental != nil {
		cfg["experimental"] = t.Experimental
	}
	return cfg
}

// buildTUNTree builds the TUN config sections (BuildProcessConfig rewrites them).
func buildTUNTree(node *nodes.Node, logLevel string, opts Options) (tunTree, error) {
	if node == nil {
		return tunTree{}, fmt.Errorf("nil node")
	}
	proxyObs, err := buildNodeOutbounds(node, "proxy", opts, true)
	if err != nil {
		return tunTree{}, err
	}
	if logLevel == "" {
		logLevel = "info"
	}
	clashExp := clashExperimental(opts)
	a4 := tunAddr4()
	rules, finalOut := tunRouteRules(node, opts, a4, clashExp != nil)
	dnsBlock := tunDNS(node, opts)
	outs, err := tunOutbounds(proxyObs, opts)
	if err != nil {
		return tunTree{}, err
	}
	t := tunTree{
		Log:       M{"level": logLevel, "timestamp": true},
		DNS:       dnsBlock,
		Inbounds:  tunInbounds(opts, a4),
		Outbounds: outs,
		Route: M{
			"final":                   finalOut,
			"auto_detect_interface":   true,
			"default_domain_resolver": M{"server": "dns-direct"},
		},
		Rules:    rules,
		RuleSets: tunRuleSets(opts),
	}
	holder := M{}
	if clashExp != nil {
		holder["experimental"] = clashExp
	}
	applyDNSCache(holder, dnsBlock, opts)
	t.Experimental, _ = holder["experimental"].(M)
	return t, nil
}

// tunRouteRules returns the route rules and route.final.
//
// Rule order is the contract (first match wins):
//  1. housekeeping — sniff, DNS hijack, our own API, LAN addresses, ourselves;
//  2. per-app 拦截 / 直连 (whole app, or only for some targets) — explicit
//     user choices that hold in every 代理策略;
//  3. 代理策略 直连 — nothing else is proxied (LAN share included);
//  4. LAN share clients, QUIC blocking, per-app node for some targets;
//  5. 代理策略 全局 — everything else through the node (listed apps via their node);
//  6. 代理策略 规则 — custom rules, per-app lines, then final.
//
// Per-app process lists live in hot-reloaded rule-set files (SplitRuleSets),
// so adding/removing apps between existing lists needs no core restart.
// The Xray sidecar goes direct ahead of hijack-dns (its own DNS lookups
// must not be pulled into dns-remote, which runs through Xray itself).
func tunRouteRules(node *nodes.Node, opts Options, a4 string, clashOn bool) ([]M, string) {
	groupTags := splitGroupTags(opts)
	rules := tunBlockRules(opts, a4, clashOn)
	// AI 强制走线路: ahead of the Claude Code accelerator (its fallback dials
	// api.anthropic.com), ourselves (the AI environment check probes through
	// it) and every app list / 代理策略; kept out of restrictEgress below.
	aiAt := len(rules)
	aiRules := append(append(exitProbeRules(opts), aiProxyRules(opts)...), aiGuardRules(opts)...)
	rules = append(rules, aiRules...)
	direct, scopedProxy := tunDirectRules(opts, clashOn)
	rules = append(rules, direct...)
	rules = append(rules, tunNodeRules(opts, groupTags, clashOn, scopedProxy)...)
	policy, finalOut := tunPolicyRules(opts, groupTags, clashOn)
	rules = append(rules, policy...)

	restricted := restrictedTags{}
	restricted.add("proxy", node)
	for _, en := range opts.ExtraNodes {
		restricted.add(en.Tag, en.Node)
	}
	pre, _ := restrictEgress(rules[:aiAt:aiAt], "", restricted)
	post, finalOut := restrictEgress(rules[aiAt+len(aiRules):], finalOut, restricted)
	return append(append(pre, aiRules...), post...), finalOut
}

// tunBlockRules: housekeeping ahead of the AI rules and per-app 拦截.
func tunBlockRules(opts Options, a4 string, clashOn bool) []M {
	rules := append(tunPreSniffRules(a4), M{"action": "sniff"})
	rules = append(rules, xrayRules(opts)...)
	// Port 53 OR sniffed DNS: a query sniff could not classify still gets our
	// answer instead of leaving for the ISP resolver (v2rayN #9325).
	rules = append(rules, M{"type": "logical", "mode": "or", "rules": []M{{"port": 53}, {"protocol": "dns"}}, "action": "hijack-dns"})
	if !opts.AIGuard.active() {
		rules = append(rules, accelRules(opts, clashOn)...)
	}
	if opts.Split {
		// 拦截 cuts the app off completely — LAN, our own API, everything — so it
		// comes before the always-direct housekeeping rules.
		rules = append(rules, M{"rule_set": []string{appSetBlock}, "action": "reject"})
		for _, sc := range opts.SplitScoped {
			if sc.Outbound == "reject" || sc.Outbound == "block" {
				rules = append(rules, scopedRuleEntries(sc, false)...)
			}
		}
	}
	return rules
}

// tunDirectRules: always-direct housekeeping, per-app 直连 and 代理策略 直连.
// It also returns the per-target app rules that go through a node (step 4).
func tunDirectRules(opts Options, clashOn bool) ([]M, []ScopedRule) {
	var rules []M
	if opts.AIGuard.active() {
		rules = append(rules, accelRules(opts, clashOn)...)
	}
	rules = append(rules, directDomainRules(opts)...)
	if !opts.ProxyPrivate {
		rules = append(rules, M{"ip_is_private": true, "outbound": "direct"})
	}
	if self := strings.TrimSpace(opts.SelfProcess); self != "" {
		rules = append(rules, M{"process_name": []string{self}, "outbound": "direct"})
	}
	if opts.PortProcessPath != "" {
		rules = append(rules, M{"process_path": []string{opts.PortProcessPath}, "outbound": "direct"})
	}
	var scopedProxy []ScopedRule
	if opts.Split {
		rules = append(rules, M{"rule_set": []string{appSetDirect}, "outbound": "direct"})
		for _, sc := range opts.SplitScoped {
			switch {
			case sc.Outbound == "direct":
				rules = append(rules, scopedRuleEntries(sc, false)...)
			case !scopedTakesOut(sc):
				scopedProxy = append(scopedProxy, sc)
			}
		}
	}
	// Public IPv6 stops here: after LAN / private, ourselves and the direct
	// app list (those may use IPv6 directly), before anything node-bound.
	rules = append(rules, tunIPv6Rules()...)
	if clashOn {
		rules = append(rules, M{"clash_mode": "direct", "outbound": "direct"})
	}
	return rules, scopedProxy
}

// tunNodeRules: LAN share, QUIC blocking, per-target app nodes, 代理策略 全局.
func tunNodeRules(opts Options, groupTags []string, clashOn bool, scopedProxy []ScopedRule) []M {
	rules := lanRules(opts, "proxy")
	if opts.BlockQUIC {
		rules = append(rules, quicRules(opts, groupTags, clashOn)...)
	}
	for _, sc := range scopedProxy {
		rules = append(rules, scopedRuleEntries(sc, false)...)
	}
	if clashOn {
		for i, g := range opts.SplitGroups {
			if opts.Split {
				rules = append(rules, emit(inSet(groupTags[i:i+1], M{"clash_mode": "global"}), g.NodeTag))
			}
		}
		rules = append(rules, M{"clash_mode": "global", "outbound": "proxy"})
	}
	return rules
}

// tunPolicyRules: 代理策略 规则 — custom rules, per-app lines; returns route.final.
func tunPolicyRules(opts Options, groupTags []string, clashOn bool) ([]M, string) {
	rules := customRoutingRules(opts, "proxy", clashOn, groupTags)
	if !opts.Split {
		// 整机全局: app rules do not apply; the whole machine follows RouteMode.
		switch opts.RouteMode {
		case RouteBypassCN:
			rules = append(rules, bypassRules(opts, nil)...)
		case RouteCustom:
			for _, r := range opts.RouteRules {
				if m := ruleMatch(r); m != nil {
					rules = append(rules, emit(m, actionTarget(r.Action, "proxy")))
				}
			}
		}
		return rules, "proxy"
	}
	rules = append(rules, tunSplitGroupRules(opts, groupTags)...)
	if opts.SplitWhitelist {
		return rules, "direct" // 只代理列出的: everything unlisted goes direct
	}
	// 默认全走代理: unlisted apps follow the default line (规则 unless set).
	d := opts.SplitDefault
	if d == nil {
		d = &SplitGroup{Mode: RouteBypassCN, NodeTag: "proxy"}
	}
	switch d.Mode {
	case RouteGlobal:
	case RouteCustom:
		for _, r := range d.Rules {
			if m := ruleMatch(r); m != nil {
				rules = append(rules, emit(m, actionTarget(r.Action, d.NodeTag)))
			}
		}
	default:
		rules = append(rules, bypassRules(opts, nil)...)
	}
	return rules, d.NodeTag
}

// tunSplitGroupRules: listed apps follow their own line in both split modes:
// 全局 = all via its node, 规则 = mainland direct / ads blocked / rest via its
// node, custom line = its rules then its node.
func tunSplitGroupRules(opts Options, groupTags []string) []M {
	var rules []M
	for i, g := range opts.SplitGroups {
		set := groupTags[i : i+1]
		switch g.Mode {
		case RouteGlobal:
		case RouteCustom:
			for _, r := range g.Rules {
				m := ruleMatch(r)
				if m == nil {
					continue
				}
				rules = append(rules, emit(inSet(set, m), actionTarget(r.Action, g.NodeTag)))
			}
		default:
			for _, t := range bypassTargets(opts) {
				rules = append(rules, emit(inSet(set, t.match), t.out))
			}
		}
		rules = append(rules, emit(M{"rule_set": set}, g.NodeTag))
	}
	return rules
}

// tunRuleSets: the geo rule-sets are always bundled (the split-DNS needs
// geosite-cn regardless of the routing mode), plus the per-app process sets.
func tunRuleSets(opts Options) []M {
	sets := []M{
		{"type": "local", "tag": "geosite-cn", "format": "binary", "path": srsPath(opts.GeoDir, "geosite-cn.srs")},
		{"type": "local", "tag": "geoip-cn", "format": "binary", "path": srsPath(opts.GeoDir, "geoip-cn.srs")},
		{"type": "local", "tag": "geosite-ads", "format": "binary", "path": srsPath(opts.GeoDir, "geosite-category-ads-all.srs")},
	}
	if opts.Split {
		for _, tag := range append([]string{appSetBlock, appSetDirect}, splitGroupTags(opts)...) {
			sets = append(sets, M{"type": "local", "tag": tag, "format": "source", "path": ruleSetPath(opts.RuleDir, tag)})
		}
	}
	return sets
}

// tunDNS builds the split-DNS block: mainland domains resolve via China DNS
// (dns-direct, DIRECT — no dependency on the node), foreign domains via
// dns-remote (through the node). So a dead/slow node can NEVER break DNS for
// mainland sites (previously all DNS went through the node → node down =
// nothing resolves = "全都打不开").
func tunDNS(node *nodes.Node, opts Options) M {
	// Xray's own lookups first: always the direct China resolver.
	dnsRules := xrayDNSRules(opts)
	// AI names next: through the line in every clash mode, IPv4 only.
	aiDNSRules, aiDNSSrv := aiGuardDNS(opts)
	dnsRules = append(dnsRules, aiDNSRules...)
	if dr := clashDNSRules(opts); dr != nil {
		dnsRules = append(dnsRules, dr...)
	}
	dnsRules = append(dnsRules, M{"rule_set": []string{"geosite-cn"}, "server": "dns-direct"})
	// 远程解析域名 off: every lookup goes to the China resolver directly.
	dnsFinal := "dns-direct"
	if opts.RemoteDNS {
		dnsFinal = "dns-remote"
	}
	remote := remoteDNSServer(node, "proxy")
	if opts.DNS.Remote != "" {
		remote["server"] = opts.DNS.Remote
	}
	dnsServers := []M{
		// Foreign resolver through the node (anti-pollution) with a 2nd fallback.
		remote,
		// China resolver, DIRECT — reachable even when the node is down.
		{"type": "udp", "tag": "dns-direct", "server": opts.DNS.directServer()},
	}
	if aiDNSSrv != nil {
		dnsServers = append(dnsServers, aiDNSSrv)
	}
	pre, hostsSrv := opts.DNS.userRules()
	dnsRules = append(pre, dnsRules...)
	if hostsSrv != nil {
		dnsServers = append(dnsServers, hostsSrv)
	}
	return M{
		"servers": dnsServers,
		"rules":   dnsRules,
		"final":   dnsFinal,
		// IPv4-only answers, always (see tunIPv6Rules): most nodes have no IPv6
		// egress, and an app handed an AAAA address keeps retrying IPv6 through
		// the TUN instead of falling back (ippure.com on a dual-stack PC, 2026-10-28).
		"strategy": "ipv4_only",
	}
}

// tunInbounds: the TUN itself plus the optional loopback / LAN inbounds.
func tunInbounds(opts Options, a4 string) []M {
	ins := []M{{
		"type":         "tun",
		"tag":          "tun-in",
		"address":      tunAddresses(a4),
		"mtu":          tunMTU(opts),
		"auto_route":   true,
		"strict_route": !opts.StrictRouteOff,
		"stack":        "system",
	}}
	if lan := lanInbound(opts); lan != nil {
		ins = append(ins, lan)
	}
	if opts.AccelPort > 0 {
		ins = append(ins, M{"type": "mixed", "tag": accelInbound, "listen": "127.0.0.1", "listen_port": opts.AccelPort})
	}
	if in := aiProxyInboundFor(opts); in != nil {
		ins = append(ins, in)
	}
	if in := exitProbeInboundFor(opts); in != nil {
		ins = append(ins, in)
	}
	return ins
}

// tunOutbounds: the primary node's entry outbound, direct, the rest of the
// primary node's outbounds, then every ExtraNode.
func tunOutbounds(proxyObs []M, opts Options) ([]M, error) {
	outs := append(proxyObs[:1:1], M{"type": "direct", "tag": "direct"})
	outs = append(outs, proxyObs[1:]...)
	for _, en := range opts.ExtraNodes {
		if en.Node == nil {
			continue
		}
		eobs, err := buildNodeOutbounds(en.Node, en.Tag, opts, false)
		if err != nil {
			return nil, err
		}
		outs = append(outs, eobs...)
	}
	return outs, nil
}
