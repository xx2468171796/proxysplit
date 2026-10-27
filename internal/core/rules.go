package core

import (
	"encoding/json"
	"path/filepath"
	"strconv"
	"strings"
)

func accelRules(opts Options, clash bool) []M {
	if opts.AccelPort <= 0 {
		return nil
	}
	out := opts.AccelOutbound
	if out == "" {
		out = "direct"
	}
	var rules []M
	if clash {
		rules = append(rules, M{"inbound": []string{accelInbound}, "clash_mode": "direct", "outbound": "direct"})
	}
	return append(rules, M{"inbound": []string{accelInbound}, "outbound": out})
}

// processSet writes one app list. An empty list gets a placeholder name: an
// empty rule would match everything, and sing-box decides once at start whether
// to look up processes at all (from whether any rule-set has a process rule;
// SagerNet/sing-box#4341), so every list must carry a process rule from the start.
func processSet(names []string) []byte {
	exes, dirs := splitProcessNames(cleanList(names))
	if len(exes) == 0 && len(dirs) == 0 {
		exes = []string{noProcess}
	}
	var rules []M
	if len(exes) > 0 {
		rules = append(rules, M{"process_name": exes})
	}
	if len(dirs) > 0 { // separate rule: fields inside one rule are AND'ed
		rules = append(rules, M{"process_path_regex": dirs})
	}
	b, _ := json.Marshal(M{"version": 3, "rules": rules})
	return b
}

// splitProcessNames separates exe names from "dir:" entries (as path regexes).
func splitProcessNames(names []string) (exes, dirs []string) {
	for _, n := range names {
		if d, ok := strings.CutPrefix(n, DirPrefix); ok {
			dirs = append(dirs, DirRegex(d))
		} else {
			exes = append(exes, n)
		}
	}
	return exes, dirs
}

func ruleSetPath(dir, tag string) string {
	return filepath.ToSlash(filepath.Join(dir, tag+".json"))
}

// inSet narrows match to the processes of the given rule-sets. A logical AND is
// used because a rule's own rule_set list is OR'ed with other rule-sets.
func inSet(tags []string, match M) M {
	if len(match) == 0 {
		return M{"rule_set": tags}
	}
	return M{"type": "logical", "mode": "and", "rules": []M{{"rule_set": tags}, match}}
}

// emit sets the rule's target: "reject" blocks, anything else is an outbound tag.
func emit(m M, out string) M {
	if out == "reject" {
		m["action"] = "reject"
	} else {
		m["outbound"] = out
	}
	return m
}

// actionTarget maps a user rule action (proxy/direct/block) to an emit target.
func actionTarget(action, nodeTag string) string {
	switch action {
	case "direct":
		return "direct"
	case "block":
		return "reject"
	}
	return nodeTag
}

// customRoutingRules turns the user's global custom rules into route entries
// (proxy → nodeTag, direct → direct, block → reject). nil when there are none.
//
// ruleModeOnly adds clash_mode=rule to every entry: the UI promises custom rules
// apply only when 代理策略 is 「规则」, so 直连 (pause) and 全局 must win over them.
// In app-split a proxy entry first sends each listed app's traffic through that
// app's own node. In whitelist mode that is all it does — a custom rule must
// never pull an unlisted or removed app into the tunnel; in blacklist mode an
// unscoped entry follows for the unlisted apps. direct/block entries stay
// unscoped — they only take traffic out.
func customRoutingRules(opts Options, nodeTag string, ruleModeOnly bool, groupTags []string) []M {
	var out []M
	for _, r := range opts.CustomRules {
		m := ruleMatch(r)
		if m == nil {
			continue
		}
		if ruleModeOnly {
			m["clash_mode"] = "rule"
		}
		target := actionTarget(r.Action, nodeTag)
		if target == nodeTag && opts.Split {
			for i, g := range opts.SplitGroups {
				out = append(out, emit(inSet(groupTags[i:i+1], cloneMatch(m)), g.NodeTag))
			}
			if opts.SplitWhitelist {
				continue
			}
		}
		out = append(out, emit(m, target))
	}
	return out
}

// customNeedsDomain reports whether any custom rule matches on a domain (needs sniff).
func customNeedsDomain(opts Options) bool {
	for _, r := range opts.CustomRules {
		if r.Type == "domain" || r.Type == "suffix" || r.Type == "keyword" {
			return true
		}
	}
	return false
}

func selectedRuleSets(opts Options) RuleSetOptions {
	if opts.RuleSets == nil {
		return RuleSetOptions{GeoSiteCN: true, GeoIPCN: true, Ads: true}
	}
	return *opts.RuleSets
}

// directDomainRules forces Options.DirectDomains (and their subdomains) out of
// the tunnel. Returns nil when nothing is configured.
func directDomainRules(opts Options) []M {
	names := make([]string, 0, len(opts.DirectDomains))
	for _, d := range opts.DirectDomains {
		if d = strings.TrimSpace(strings.ToLower(d)); d != "" {
			names = append(names, d)
		}
	}
	if len(names) == 0 {
		return nil
	}
	return []M{{"domain": names, "domain_suffix": names, "outbound": "direct"}}
}

// bypassRules builds the optional ads/CN smart-routing entries and applies the
// supplied scope (for example inbound or process_name) to every entry.
func bypassRules(opts Options, scope M) []M {
	var out []M
	for _, t := range bypassTargets(opts) {
		for k, v := range scope {
			t.match[k] = v
		}
		out = append(out, emit(t.match, t.out))
	}
	return out
}

type bypassTarget struct {
	match M
	out   string
}

// bypassTargets lists the enabled smart-routing entries (ads → reject, mainland
// → direct) as match/target pairs.
func bypassTargets(opts Options) []bypassTarget {
	selected := selectedRuleSets(opts)
	var out []bypassTarget
	if selected.Ads {
		out = append(out, bypassTarget{M{"rule_set": []string{"geosite-ads"}}, "reject"})
	}
	var cn []string
	if selected.GeoSiteCN {
		cn = append(cn, "geosite-cn")
	}
	if selected.GeoIPCN {
		cn = append(cn, "geoip-cn")
	}
	if len(cn) > 0 {
		out = append(out, bypassTarget{M{"rule_set": cn}, "direct"})
	}
	return out
}

// lanInbound builds the dedicated LAN-shared inbound (fixed port, chosen
// protocol, optional user/pass auth) listening on all interfaces. nil when LAN
// sharing is off.
func lanInbound(opts Options) M {
	if !opts.LanShare {
		return nil
	}
	port := opts.LanPort
	if port == 0 {
		port = 7890
	}
	typ := opts.LanType
	if typ != "socks" && typ != "http" {
		typ = "mixed"
	}
	in := M{"type": typ, "tag": "in-lan", "listen": "0.0.0.0", "listen_port": port}
	if opts.LanUser != "" {
		in["users"] = []M{{"username": opts.LanUser, "password": opts.LanPass}}
	}
	return in
}

// lanRules routes the LAN inbound through the given node tag (everything via the
// active node; the clash mode still overlays 全局/直连). nil when LAN off.
func lanRules(opts Options, nodeTag string) []M {
	if !opts.LanShare {
		return nil
	}
	return []M{{"inbound": []string{"in-lan"}, "outbound": nodeTag}}
}

// clashRules returns the clash_mode override rules (Direct => everything direct,
// Global => everything through nodeTag). "rule" mode matches nothing here and
// falls through to the normal rules.
func clashRules(nodeTag string) []M {
	return []M{
		{"clash_mode": "direct", "outbound": "direct"},
		{"clash_mode": "global", "outbound": nodeTag},
	}
}

// clashExperimental returns the experimental.clash_api block, or nil.
func clashExperimental(opts Options) M {
	if opts.ClashController == "" {
		return nil
	}
	api := M{"external_controller": opts.ClashController}
	if opts.ClashSecret != "" {
		api["secret"] = opts.ClashSecret
	}
	// Boot directly in the selected mode. "rule" is sing-box's own default, so we
	// only override for global/direct (avoids the "rule"/"Rule" casing question).
	if opts.ClashMode == "global" || opts.ClashMode == "direct" {
		api["default_mode"] = opts.ClashMode
	}
	return M{"clash_api": api}
}

// clashDNSRules returns DNS rules that make "direct" clash mode resolve locally
// (not through the node) so 直连 is a real escape hatch when the node is dead.
// Empty when clash is disabled.
func clashDNSRules(opts Options) []M {
	if opts.ClashController == "" {
		return nil
	}
	return []M{{"clash_mode": "direct", "server": "dns-direct"}}
}

// ruleMatch builds a sing-box route match object from a custom rule (without the
// action/outbound, which the caller adds). Returns nil for unknown types.
func ruleMatch(r RouteRule) M {
	v := strings.TrimSpace(r.Value)
	if v == "" {
		return nil
	}
	switch r.Type {
	case "domain":
		return M{"domain": []string{v}}
	case "suffix":
		return M{"domain_suffix": []string{v}}
	case "keyword":
		return M{"domain_keyword": []string{v}}
	case "ip":
		return M{"ip_cidr": []string{v}}
	}
	return nil
}

// quicRules blocks QUIC (UDP 443) only for traffic headed into the tunnel, so
// the browser falls back to TCP there, while mainland sites and direct apps keep
// QUIC. Tunnel-bound = in 全局 (代理策略, or an app / default line on 全局), or
// not mainland for apps (and, in 默认全走代理, unlisted traffic) on smart lines.
// Direct / blocked apps are routed before these rules and never reach them.
func quicRules(opts Options, groupTags []string, clash bool) []M {
	quic := func() M { return M{"network": []string{"udp"}, "port": []int{443}} }
	var cn []string
	for _, t := range bypassTargets(opts) {
		if t.out == "direct" {
			cn = t.match["rule_set"].([]string)
		}
	}
	// notMainland narrows m to destinations outside the mainland rule-sets.
	notMainland := func(m M) M {
		if len(cn) == 0 {
			return m
		}
		return M{"type": "logical", "mode": "and", "rules": []M{m, {"rule_set": cn, "invert": true}}}
	}
	var out []M
	if clash {
		g := quic()
		g["clash_mode"] = "global"
		out = append(out, emit(g, "reject"))
	}
	if !opts.Split {
		// 整机全局: the whole machine follows the smart split.
		return append(out, emit(notMainland(quic()), "reject"))
	}
	for i, g := range opts.SplitGroups {
		if g.NodeTag == "direct" {
			continue // a custom line whose exit is 直连
		}
		m := inSet(groupTags[i:i+1], quic())
		if g.Mode != RouteGlobal {
			m = notMainland(m)
		}
		out = append(out, emit(m, "reject"))
	}
	if !opts.SplitWhitelist {
		d := opts.SplitDefault
		switch {
		case d != nil && d.NodeTag == "direct":
		case d != nil && d.Mode == RouteGlobal:
			out = append(out, emit(quic(), "reject"))
		default:
			out = append(out, emit(notMainland(quic()), "reject"))
		}
	}
	return out
}

// scopedTakesOut: the scoped rule sends its targets direct or blocks them.
func scopedTakesOut(sc ScopedRule) bool {
	switch sc.Outbound {
	case "direct", "reject", "block":
		return true
	}
	return false
}

// scopedRuleEntries turns one ScopedRule into sing-box route rules. Domains and
// IPs become separate rules (a connection matches a domain OR an IP, never both
// as an AND); ports narrow each. When clashDirect is set an extra clash_mode
// "direct" override is prepended so the top-bar 直连 (panic) still wins over the
// scoped rule.
func scopedRuleEntries(sc ScopedRule, clashDirect bool) []M {
	name := strings.TrimSpace(sc.Name)
	if name == "" {
		return nil
	}
	ports, ranges := splitPorts(sc.Ports)
	var bases []M
	addBase := func(cond M) {
		if d, ok := strings.CutPrefix(name, DirPrefix); ok {
			cond["process_path_regex"] = []string{DirRegex(d)}
		} else {
			cond["process_name"] = []string{name}
		}
		if len(ports) > 0 {
			cond["port"] = ports
		}
		if len(ranges) > 0 {
			cond["port_range"] = ranges
		}
		bases = append(bases, cond)
	}
	if d := cleanList(sc.Domains); len(d) > 0 {
		addBase(M{"domain_suffix": d})
	}
	if ip := cleanList(sc.IPs); len(ip) > 0 {
		addBase(M{"ip_cidr": ip})
	}
	if len(bases) == 0 && (len(ports) > 0 || len(ranges) > 0) {
		addBase(M{}) // port-only scope
	}
	if len(bases) == 0 {
		return nil
	}
	out := make([]M, 0, len(bases)*2)
	for _, base := range bases {
		if clashDirect {
			d := cloneMatch(base)
			d["clash_mode"] = "direct"
			d["outbound"] = "direct"
			out = append(out, d)
		}
		act := cloneMatch(base)
		if sc.Outbound == "reject" || sc.Outbound == "block" {
			act["action"] = "reject"
		} else {
			act["outbound"] = sc.Outbound
		}
		out = append(out, act)
	}
	return out
}

func cloneMatch(m M) M {
	c := make(M, len(m)+2)
	for k, v := range m {
		c[k] = v
	}
	return c
}

func cleanList(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}

// splitPorts separates single ports ("443" -> int list) from ranges
// ("8000-9000" / "8000:9000" -> "8000:9000" for sing-box port_range).
func splitPorts(in []string) (nums []int, ranges []string) {
	for _, p := range in {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if i := strings.IndexAny(p, "-:"); i > 0 && i < len(p)-1 {
			a := strings.TrimSpace(p[:i])
			b := strings.TrimSpace(p[i+1:])
			if _, ea := strconv.Atoi(a); ea == nil {
				if _, eb := strconv.Atoi(b); eb == nil {
					ranges = append(ranges, a+":"+b)
					continue
				}
			}
			continue
		}
		if n, err := strconv.Atoi(p); err == nil && n > 0 && n < 65536 {
			nums = append(nums, n)
		}
	}
	return
}

// srsPath joins the geo dir and a rule-set file name (forward slashes so the JSON
// stays clean; sing-box accepts them on Windows).
func srsPath(dir, name string) string {
	if dir == "" {
		return name
	}
	return strings.ReplaceAll(filepath.Join(dir, name), "\\", "/")
}
