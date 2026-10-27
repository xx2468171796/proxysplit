package core

import (
	"fmt"
)

// multiTree is the multi-line sing-box config split into its top-level sections.
type multiTree struct {
	log          M
	inbounds     []M
	outbounds    []M
	dns          M // nil when no domain awareness is needed
	experimental M // nil when the clash API is off
	route        M
}

// root assembles the tree into the JSON document sing-box reads.
func (t multiTree) root() M {
	cfg := M{"log": t.log, "inbounds": t.inbounds, "outbounds": t.outbounds}
	if t.dns != nil {
		cfg["dns"] = t.dns
	}
	if t.experimental != nil {
		cfg["experimental"] = t.experimental
	}
	cfg["route"] = t.route
	return cfg
}

// BuildMultiConfig generates a sing-box config with one inbound per line. Each
// line's inbound is routed (per its mode) out through its node; outbounds are
// de-duplicated across lines that share a node. Connections are tagged by the
// inbound they arrive on, so per-line policy is expressed as inbound-scoped route
// rules.
func BuildMultiConfig(lines []LineConfig, logLevel string, opts Options) ([]byte, error) {
	t, err := buildMultiTree(lines, logLevel, opts)
	if err != nil {
		return nil, err
	}
	return marshalConfig(t.root())
}

// buildMultiTree builds every section in order.
func buildMultiTree(lines []LineConfig, logLevel string, opts Options) (multiTree, error) {
	if len(lines) == 0 {
		return multiTree{}, fmt.Errorf("no lines")
	}
	if logLevel == "" {
		logLevel = "info"
	}
	inbounds, outbounds, nodeTag, restricted, err := multiInOutbounds(lines, opts)
	if err != nil {
		return multiTree{}, err
	}
	needDomain, geoNeeded := multiNeedsDomain(lines, opts, restricted)
	primaryTag := nodeTag[lines[0].Node.ID]
	t := multiTree{
		log:          M{"level": logLevel, "timestamp": true},
		inbounds:     inbounds,
		outbounds:    outbounds,
		experimental: clashExperimental(opts),
	}
	var rules []M
	if needDomain {
		t.dns = multiDNS(opts, primaryTag)
		rules = append(rules, M{"action": "sniff"}) // must be first
	}
	rules = append(rules, multiGlobalRules(opts, primaryTag, t.experimental != nil)...)
	rules = append(rules, multiLineRules(lines, opts, nodeTag)...)
	t.route = multiRoute(rules, opts, restricted, needDomain, geoNeeded)
	return t, nil
}

// multiInOutbounds builds the per-line inbounds and de-duplicated node
// outbounds. Per-line inbounds are loopback-only (WinDivert-redirected local
// apps, no auth). LAN sharing gets its own dedicated, optionally-authenticated
// inbound.
func multiInOutbounds(lines []LineConfig, opts Options) ([]M, []M, map[string]string, restrictedTags, error) {
	var inbounds, outbounds []M
	nodeTag := map[string]string{} // node.ID -> outbound tag
	restricted := restrictedTags{}
	for _, ln := range lines {
		if ln.Node == nil {
			return nil, nil, nil, nil, fmt.Errorf("line %q has no node", ln.Key)
		}
		inbounds = append(inbounds, M{
			"type":        "mixed",
			"tag":         "in-" + ln.Key,
			"listen":      "127.0.0.1",
			"listen_port": ln.InboundPort,
		})
		if _, ok := nodeTag[ln.Node.ID]; !ok {
			tag := "node-" + ln.Node.ID
			obs, err := buildNodeOutbounds(ln.Node, tag, opts, true)
			if err != nil {
				return nil, nil, nil, nil, err
			}
			outbounds = append(outbounds, obs...)
			nodeTag[ln.Node.ID] = tag
			restricted.add(tag, ln.Node)
		}
	}
	outbounds = append(outbounds, M{"type": "direct", "tag": "direct"})
	if lan := lanInbound(opts); lan != nil {
		inbounds = append(inbounds, lan)
	}
	return inbounds, outbounds, nodeTag, restricted, nil
}

// multiNeedsDomain reports whether domain awareness (sniff + DNS + resolver) is
// needed — remote DNS or any domain-based routing; 仅 AI lines route by the
// allowlist, which needs the sniffed domain — and whether geo rule-sets are.
func multiNeedsDomain(lines []LineConfig, opts Options, restricted restrictedTags) (needDomain, geoNeeded bool) {
	needDomain = opts.RemoteDNS || customNeedsDomain(opts) || len(restricted) > 0
	for _, ln := range lines {
		if ln.RouteMode == RouteBypassCN {
			needDomain, geoNeeded = true, true
		}
		if ln.RouteMode == RouteCustom {
			needDomain = true
		}
	}
	return needDomain, geoNeeded
}

// multiDNS: dns-remote resolves through the first line's node; dns-direct
// bootstraps node hostnames locally (no detour = default direct path).
func multiDNS(opts Options, primaryTag string) M {
	dns := M{
		"servers": []M{
			{"type": "https", "tag": "dns-remote", "server": "1.1.1.1", "detour": primaryTag},
			{"type": "https", "tag": "dns-direct", "server": "223.5.5.5"},
		},
		"final": "dns-remote",
	}
	if dr := clashDNSRules(opts); dr != nil {
		dns["rules"] = dr
	}
	return dns
}

// multiGlobalRules are the rules that precede the per-line ones.
func multiGlobalRules(opts Options, primaryTag string, clashOn bool) []M {
	var rules []M
	// Our own API must never be tunnelled (domestic backend): put it ahead of the
	// clash_mode overrides so even 全局 mode keeps it direct.
	if r := directDomainRules(opts); r != nil {
		rules = append(rules, r...)
	}
	// clash_mode overrides (Direct/Global) — checked before the per-line rules.
	if clashOn {
		rules = append(rules, clashRules(primaryTag)...)
	}
	// LAN-shared inbound routes through the active node.
	rules = append(rules, lanRules(opts, primaryTag)...)
	// Global user custom rules — highest priority, before the geo/per-line rules.
	// The clash overrides above already precede them, so no clash_mode needed.
	return append(rules, customRoutingRules(opts, primaryTag, false, nil)...)
}

// multiLineRules are the per-line, inbound-scoped routing rules; every mode
// ends with a catch-all to the line's node.
func multiLineRules(lines []LineConfig, opts Options, nodeTag map[string]string) []M {
	var rules []M
	for _, ln := range lines {
		in := []string{"in-" + ln.Key}
		tag := nodeTag[ln.Node.ID]
		switch ln.RouteMode {
		case RouteBypassCN:
			rules = append(rules, bypassRules(opts, M{"inbound": in})...)
		case RouteCustom:
			rules = append(rules, multiCustomRules(ln.RouteRules, in, tag)...)
		}
		rules = append(rules, M{"inbound": in, "outbound": tag})
	}
	return rules
}

// multiCustomRules scopes one line's custom rules to its inbound.
func multiCustomRules(rr []RouteRule, in []string, tag string) []M {
	var rules []M
	for _, r := range rr {
		m := ruleMatch(r)
		if m == nil {
			continue
		}
		m["inbound"] = in
		switch r.Action {
		case "direct":
			m["outbound"] = "direct"
		case "block":
			m["action"] = "reject"
		default:
			m["outbound"] = tag
		}
		rules = append(rules, m)
	}
	return rules
}

// multiRoute applies egress restriction and assembles the route section.
func multiRoute(rules []M, opts Options, restricted restrictedTags, needDomain, geoNeeded bool) M {
	rules, final := restrictEgress(rules, "direct", restricted)
	route := M{"final": final}
	if len(rules) > 0 {
		route["rules"] = rules
	}
	if geoNeeded {
		route["rule_set"] = []M{
			{"type": "local", "tag": "geosite-cn", "format": "binary", "path": srsPath(opts.GeoDir, "geosite-cn.srs")},
			{"type": "local", "tag": "geoip-cn", "format": "binary", "path": srsPath(opts.GeoDir, "geoip-cn.srs")},
			{"type": "local", "tag": "geosite-ads", "format": "binary", "path": srsPath(opts.GeoDir, "geosite-category-ads-all.srs")},
		}
	}
	if needDomain {
		route["default_domain_resolver"] = M{"server": "dns-direct"}
	}
	return route
}
