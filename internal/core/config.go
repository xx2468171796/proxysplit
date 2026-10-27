package core

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"proxysplit/internal/nodes"
	"proxysplit/internal/xray"
)

// M is a convenience alias for building JSON objects.
type M = map[string]interface{}

// Routing modes.
const (
	RouteGlobal   = "global"    // everything through the node
	RouteBypassCN = "bypass_cn" // China domains/IPs direct, ads blocked, rest proxied
	RouteCustom   = "custom"    // user-defined domain/IP rules, rest proxied
)

// RouteRule is one user-defined routing rule (custom mode).
type RouteRule struct {
	Type   string `json:"type"`   // domain | suffix | keyword | ip
	Value  string `json:"value"`  // e.g. "google.com", "cn", "10.0.0.0/8"
	Action string `json:"action"` // proxy | direct | block
}

// RuleSetOptions controls which bundled rule sets participate in smart
// routing. A nil *RuleSetOptions keeps the historical behaviour (all enabled),
// so older callers and configs remain fully backward compatible.
type RuleSetOptions struct {
	GeoSiteCN bool `json:"geositeCN"`
	GeoIPCN   bool `json:"geoipCN"`
	Ads       bool `json:"ads"`
}

// Options tunes the generated core config.
type Options struct {
	// RemoteDNS enables domain sniffing + remote DNS: sing-box recovers the real
	// domain from the TLS ClientHello, overriding a possibly-poisoned local IP,
	// and passes the domain to the node for remote resolution (anti-pollution,
	// no DNS leak). Requires no DNS interception in our redirect model.
	RemoteDNS bool

	// NoHostIPv6: the machine has no IPv6 uplink. DNS answers are then IPv4
	// only — otherwise, with the TUN carrying an IPv6 address (AI 劫持), apps
	// pick an AAAA address, the core cannot dial it, and apps without a
	// fallback (curl, Git, games) fail while browsers quietly retry IPv4.
	NoHostIPv6 bool

	// RealityHybrid: the bundled core carries relayops patch 0005, so POWER云
	// VLESS + Reality outbounds keep the X25519MLKEM768 key share (ClientHello
	// like real Chrome). Never applied to third-party nodes (compat mode).
	RealityHybrid bool

	// ServerIPs: node server domain → pre-resolved IP (internal/noderesolve).
	// Outbounds dial the IP and keep the domain as SNI / Host (PinNode).
	ServerIPs map[string]string

	// RouteMode selects how in-tunnel traffic is split (see Route* constants).
	RouteMode string
	// RouteRules are the user rules used when RouteMode == RouteCustom.
	RouteRules []RouteRule
	// RuleSets optionally disables individual bundled smart-routing rule sets.
	// nil means all enabled for backward compatibility.
	RuleSets *RuleSetOptions
	// GeoDir is the directory holding the bundled *.srs rule-sets (bypass_cn).
	GeoDir string

	// ClashController (host:port) + ClashSecret enable sing-box's clash_api so the
	// runtime mode (Rule/Global/Direct) can be switched without a restart.
	ClashController string
	ClashSecret     string
	// ClashMode is the initial mode baked into the config (rule|global|direct) so
	// the core BOOTS in the right mode — no async post-start apply window.
	ClashMode string

	// LanShare adds a dedicated inbound listening on 0.0.0.0 so other devices on
	// the LAN can use this machine as their proxy. LanPort/LanType/LanUser/LanPass
	// configure that inbound (fixed port, protocol, and optional auth).
	LanShare bool
	LanPort  int    // fixed LAN port (0 => 7890)
	LanType  string // mixed | socks | http
	LanUser  string // auth username (empty = no auth)
	LanPass  string // auth password

	// CustomRules are global user routing rules (highest priority, applied in
	// "rule" clash mode before the geo-based bypass-CN rules).
	CustomRules []RouteRule

	// DirectDomains always bypass the tunnel, ahead of every other rule
	// (including 全局 mode and user rules). This keeps our own commercial API
	// reachable: the backend is hosted domestically, so tunnelling its traffic
	// through an overseas node would make login / lease renewal slow or fail.
	DirectDomains []string

	// Split selects per-app (application-split) routing on the TUN inbound using
	// sing-box's own process_name matcher instead of the WinDivert engine. Only
	// the listed processes are eligible for the proxy; every other process goes
	// direct (route.final = direct). This is the robust replacement for the
	// hand-rolled WinDivert redirect.
	Split bool
	// SplitWhitelist true => only SplitProxy apps use the node, everything else
	// is direct (route.final = direct). false (blacklist) => the whole machine
	// uses the node EXCEPT SplitDirect/SplitBlock apps (route.final = proxy).
	SplitWhitelist bool
	// Per-app split routing. SplitGroups carries the rule/global apps grouped by
	// (mode, node) so different apps can use different nodes; SplitDirect/Block
	// are node-independent. ExtraNodes are outbounds for nodes OTHER than the
	// primary (active) node, referenced by SplitGroups[i].NodeTag.
	SplitGroups []SplitGroup
	SplitDirect []string
	SplitBlock  []string
	ExtraNodes  []ExtraNode
	// SplitScoped are per-app rules narrowed to specific targets (domain/IP/port):
	// only that process's traffic to those targets follows the rule; the rest of
	// the process falls through to the default. Evaluated before the broad
	// process_name groups.
	SplitScoped []ScopedRule
	// SplitDefault is the line for unlisted apps in blacklist mode (默认全走代理);
	// nil = 规则 through the primary node. Its Names are unused.
	SplitDefault *SplitGroup
	// RuleDir holds the per-app process rule-set files of an app-split config
	// (see SplitRuleSets). The core reloads them on change.
	RuleDir string

	// ProxyPrivate lets LAN/private addresses into the tunnel (内网直连 off).
	ProxyPrivate bool
	// SelfProcess is our own executable name, kept out of the tunnel (代理程序
	//自身不走代理). Empty = not excluded.
	SelfProcess string
	// PortProcessPath is the core binary the 端口代理 processes run from: their
	// already-routed traffic must leave the TUN untouched (no second hop).
	PortProcessPath string
	// XrayPorts maps xray.Key(node) → the Xray sidecar SOCKS endpoint for nodes
	// sing-box cannot carry (see xray.go); XrayPath is xray.exe, kept out of
	// the TUN like PortProcessPath. Both empty = no sidecar.
	XrayPorts map[string]xray.Endpoint
	XrayPath  string
	// BlockQUIC rejects QUIC (UDP 443) headed for the tunnel so browsers fall back
	// to TCP, where the domain can always be sniffed and routed.
	BlockQUIC bool

	// AccelPort > 0 adds a loopback-only mixed inbound (accel-in) used solely by
	// the built-in Claude Code accelerator (internal/accel). Its connections go
	// to AccelOutbound — the line Claude Code itself uses — ahead of every other
	// rule (the accelerator runs inside our own process, which SelfProcess would
	// otherwise send direct). 代理策略 直连 still wins so a paused core stays paused.
	AccelPort     int
	AccelOutbound string

	// AIGuard pins AI services to our own line for AI-site customers (see
	// aiguard.go); nil = off.
	AIGuard *AIGuard
	// AIProxy is the loopback AI-line proxy for other programs (nil = none).
	AIProxy *AIProxy

	// Process selects 仅接管选中程序 (BuildProcessConfig): mixed inbounds per app
	// group fed by internal/capture instead of the TUN. nil = TUN.
	Process *ProcessCapture
}

// AIGuardActive reports whether the AI lock is on (it needs the TUN).
func (o Options) AIGuardActive() bool { return o.AIGuard.active() }

const accelInbound = "accel-in"

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

// ScopedRule is one app-rule narrowed to specific destinations. Only the named
// process's traffic to the given domains/IPs/ports uses Outbound ("proxy" /
// "node-<id>" node tag, "direct", or "reject"); its other traffic is unaffected.
type ScopedRule struct {
	Name     string
	Domains  []string // domain_suffix
	IPs      []string // ip_cidr
	Ports    []string // port numbers or "a-b" ranges
	Outbound string
}

// SplitGroup is a set of processes routed the same way: Mode is "rule" (smart
// split) or "global" (everything through the node); NodeTag is the outbound tag
// ("proxy" = active node, or "node-<id>" for an ExtraNode).
type SplitGroup struct {
	// Key identifies the group across restarts (line/node/mode); it names the
	// group's rule-set file, so an unchanged Key means the config is unchanged.
	Key     string
	Names   []string
	Mode    string
	NodeTag string
	Rules   []RouteRule // used when Mode == RouteCustom
}

// Hot-reloadable per-app process rule-sets (app-split only).
const (
	appSetBlock  = "apps-block"
	appSetDirect = "apps-direct"
	// noProcess never matches a real program: a rule-set with an empty process
	// list would otherwise be a rule without conditions, i.e. match everything.
	noProcess = "proxysplit-none.invalid"
)

// splitGroupTags names each SplitGroup's rule-set (same index as SplitGroups).
func splitGroupTags(opts Options) []string {
	if !opts.Split {
		return nil
	}
	tags := make([]string, len(opts.SplitGroups))
	for i, g := range opts.SplitGroups {
		key := g.Key
		if key == "" {
			key = fmt.Sprintf("%s|%s|%d", g.Mode, g.NodeTag, i)
		}
		sum := sha1.Sum([]byte(key))
		tags[i] = "apps-g-" + hex.EncodeToString(sum[:5])
	}
	return tags
}

// SplitRuleSets returns the per-app process rule-set files (tag → JSON) that an
// app-split config from BuildTUNConfig reads from opts.RuleDir. Changing only
// these files re-routes apps live: the core reloads them without a restart.
func SplitRuleSets(opts Options) map[string][]byte {
	if !opts.Split {
		return nil
	}
	out := map[string][]byte{
		appSetBlock:  processSet(opts.SplitBlock),
		appSetDirect: processSet(opts.SplitDirect),
	}
	for i, tag := range splitGroupTags(opts) {
		out[tag] = processSet(opts.SplitGroups[i].Names)
	}
	return out
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

// DirPrefix marks a process-list entry that means "every program under this
// folder" (an application identified by its install directory, internal/appid)
// instead of one exe name.
const DirPrefix = "dir:"

// DirRegex matches every process whose path lies under dir, case-insensitively.
func DirRegex(dir string) string {
	dir = strings.TrimRight(strings.ReplaceAll(strings.TrimSpace(dir), "/", `\`), `\`)
	return `(?i)^` + regexp.QuoteMeta(dir) + `\\`
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

// ExtraNode is an additional node outbound (beyond the primary "proxy").
type ExtraNode struct {
	Tag  string
	Node *nodes.Node
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

// LineConfig describes one routing "line": a dedicated sing-box inbound bound to
// a node with an in-line routing policy. The WinDivert engine forwards each
// matched app to its line's inbound port, so different apps can use different
// nodes/policies simultaneously.
type LineConfig struct {
	Key         string      // engine upstream key; inbound tag is "in-<Key>"
	InboundPort int         // loopback port for this line's inbound
	Node        *nodes.Node // resolved node this line exits through
	RouteMode   string      // global | bypass_cn | custom
	RouteRules  []RouteRule // used when RouteMode == custom
}

// BuildConfig produces a single-line config (back-compat wrapper).
func BuildConfig(node *nodes.Node, inboundPort int, logLevel string, opts Options) ([]byte, error) {
	return BuildMultiConfig([]LineConfig{{
		Key:         "proxy",
		InboundPort: inboundPort,
		Node:        node,
		RouteMode:   opts.RouteMode,
		RouteRules:  opts.RouteRules,
	}}, logLevel, opts)
}

// BuildMultiConfig generates a sing-box config with one inbound per line. Each
// line's inbound is routed (per its mode) out through its node; outbounds are
// de-duplicated across lines that share a node. Connections are tagged by the
// inbound they arrive on, so per-line policy is expressed as inbound-scoped route
// rules.
func BuildMultiConfig(lines []LineConfig, logLevel string, opts Options) ([]byte, error) {
	if len(lines) == 0 {
		return nil, fmt.Errorf("no lines")
	}
	if logLevel == "" {
		logLevel = "info"
	}

	// Inbounds + de-duplicated node outbounds. Per-line inbounds are loopback-only
	// (WinDivert-redirected local apps, no auth). LAN sharing gets its own
	// dedicated, optionally-authenticated inbound added below.
	var inbounds []M
	var outbounds []M
	nodeTag := map[string]string{} // node.ID -> outbound tag
	restricted := restrictedTags{}
	for _, ln := range lines {
		if ln.Node == nil {
			return nil, fmt.Errorf("line %q has no node", ln.Key)
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
				return nil, err
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

	// Domain awareness (sniff + DNS + resolver) is needed for remote-DNS or any
	// domain-based routing.
	// 仅 AI lines route by the allowlist, which needs the sniffed domain.
	needDomain := opts.RemoteDNS || customNeedsDomain(opts) || len(restricted) > 0
	geoNeeded := false
	for _, ln := range lines {
		if ln.RouteMode == RouteBypassCN {
			needDomain, geoNeeded = true, true
		}
		if ln.RouteMode == RouteCustom {
			needDomain = true
		}
	}

	cfg := M{
		"log":       M{"level": logLevel, "timestamp": true},
		"inbounds":  inbounds,
		"outbounds": outbounds,
	}

	var rules []M
	if needDomain {
		dns := M{
			"servers": []M{
				// dns-remote resolves through the first line's node; dns-direct
				// bootstraps node hostnames locally (no detour = default direct path).
				{"type": "https", "tag": "dns-remote", "server": "1.1.1.1", "detour": nodeTag[lines[0].Node.ID]},
				{"type": "https", "tag": "dns-direct", "server": "223.5.5.5"},
			},
			"final": "dns-remote",
		}
		if dr := clashDNSRules(opts); dr != nil {
			dns["rules"] = dr
		}
		cfg["dns"] = dns
		rules = append(rules, M{"action": "sniff"}) // must be first
	}

	// Our own API must never be tunnelled (domestic backend): put it ahead of the
	// clash_mode overrides so even 全局 mode keeps it direct.
	if r := directDomainRules(opts); r != nil {
		rules = append(rules, r...)
	}
	// clash_mode overrides (Direct/Global) — checked before the per-line rules.
	if exp := clashExperimental(opts); exp != nil {
		cfg["experimental"] = exp
		rules = append(rules, clashRules(nodeTag[lines[0].Node.ID])...)
	}
	// LAN-shared inbound routes through the active node.
	rules = append(rules, lanRules(opts, nodeTag[lines[0].Node.ID])...)
	// Global user custom rules — highest priority, before the geo/per-line rules.
	// The clash overrides above already precede them, so no clash_mode needed.
	rules = append(rules, customRoutingRules(opts, nodeTag[lines[0].Node.ID], false, nil)...)

	// Per-line, inbound-scoped routing rules.
	for _, ln := range lines {
		in := []string{"in-" + ln.Key}
		tag := nodeTag[ln.Node.ID]
		switch ln.RouteMode {
		case RouteBypassCN:
			rules = append(rules, bypassRules(opts, M{"inbound": in})...)
			rules = append(rules, M{"inbound": in, "outbound": tag})
		case RouteCustom:
			for _, r := range ln.RouteRules {
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
			rules = append(rules, M{"inbound": in, "outbound": tag}) // catch-all
		default: // global
			rules = append(rules, M{"inbound": in, "outbound": tag})
		}
	}

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
	cfg["route"] = route
	return json.MarshalIndent(cfg, "", "  ")
}

// BuildTUNConfig generates a system-wide TUN config (v2rayN-style global/rule):
// a sing-box tun inbound (wintun) captures ALL system traffic and routes it per
// the given mode out through the node. No WinDivert engine is used in this mode.
func BuildTUNConfig(node *nodes.Node, logLevel string, opts Options) ([]byte, error) {
	cfg, err := buildTUNTree(node, logLevel, opts)
	if err != nil {
		return nil, err
	}
	return json.MarshalIndent(cfg, "", "  ")
}

// buildTUNTree is BuildTUNConfig before marshalling (BuildProcessConfig rewrites it).
func buildTUNTree(node *nodes.Node, logLevel string, opts Options) (M, error) {
	if node == nil {
		return nil, fmt.Errorf("nil node")
	}
	proxyObs, err := buildNodeOutbounds(node, "proxy", opts, true)
	if err != nil {
		return nil, err
	}
	if logLevel == "" {
		logLevel = "info"
	}
	routeMode := opts.RouteMode
	routeRules := opts.RouteRules
	geoDir := opts.GeoDir
	clashExp := clashExperimental(opts)
	groupTags := splitGroupTags(opts)

	// Rule order is the contract (first match wins):
	//  1. housekeeping — sniff, DNS hijack, our own API, LAN addresses, ourselves;
	//  2. per-app 拦截 / 直连 (whole app, or only for some targets) — explicit
	//     user choices that hold in every 代理策略;
	//  3. 代理策略 直连 — nothing else is proxied (LAN share included);
	//  4. LAN share clients, QUIC blocking, per-app node for some targets;
	//  5. 代理策略 全局 — everything else through the node (listed apps via their node);
	//  6. 代理策略 规则 — custom rules, per-app lines, then final.
	// Per-app process lists live in hot-reloaded rule-set files (SplitRuleSets),
	// so adding/removing apps between existing lists needs no core restart.
	// The Xray sidecar goes direct ahead of hijack-dns (its own DNS lookups
	// must not be pulled into dns-remote, which runs through Xray itself).
	rules := append([]M{{"action": "sniff"}}, xrayRules(opts)...)
	rules = append(rules, M{"protocol": "dns", "action": "hijack-dns"})
	guarded := opts.AIGuard.active()
	if !guarded {
		rules = append(rules, accelRules(opts, clashExp != nil)...)
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
	// AI 强制走线路: ahead of the Claude Code accelerator (its fallback dials
	// api.anthropic.com), ourselves (the AI environment check probes through
	// it) and every app list / 代理策略; kept out of restrictEgress below.
	aiAt := len(rules)
	aiRules := append(aiProxyRules(opts), aiGuardRules(opts)...)
	rules = append(rules, aiRules...)
	if guarded {
		rules = append(rules, accelRules(opts, clashExp != nil)...)
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
	if clashExp != nil {
		rules = append(rules, M{"clash_mode": "direct", "outbound": "direct"})
	}
	rules = append(rules, lanRules(opts, "proxy")...)
	if opts.BlockQUIC {
		rules = append(rules, quicRules(opts, groupTags, clashExp != nil)...)
	}
	for _, sc := range scopedProxy {
		rules = append(rules, scopedRuleEntries(sc, false)...)
	}
	if clashExp != nil {
		for i, g := range opts.SplitGroups {
			if opts.Split {
				rules = append(rules, emit(inSet(groupTags[i:i+1], M{"clash_mode": "global"}), g.NodeTag))
			}
		}
		rules = append(rules, M{"clash_mode": "global", "outbound": "proxy"})
	}

	finalOut := "proxy"
	custom := customRoutingRules(opts, "proxy", clashExp != nil, groupTags)
	if opts.Split {
		rules = append(rules, custom...)
		// Listed apps follow their own line in both split modes: 全局 = all via
		// its node, 规则 = mainland direct / ads blocked / rest via its node, custom
		// line = its rules then its node.
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
		if opts.SplitWhitelist {
			finalOut = "direct" // 只代理列出的: everything unlisted goes direct
		} else {
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
			finalOut = d.NodeTag
		}
	} else {
		// 整机全局: app rules do not apply; the whole machine follows routeMode.
		rules = append(rules, custom...)
		switch routeMode {
		case RouteBypassCN:
			rules = append(rules, bypassRules(opts, nil)...)
		case RouteCustom:
			for _, r := range routeRules {
				if m := ruleMatch(r); m != nil {
					rules = append(rules, emit(m, actionTarget(r.Action, "proxy")))
				}
			}
		}
	}

	restricted := restrictedTags{}
	restricted.add("proxy", node)
	for _, en := range opts.ExtraNodes {
		restricted.add(en.Tag, en.Node)
	}
	pre, _ := restrictEgress(rules[:aiAt:aiAt], "", restricted)
	post, finalOut := restrictEgress(rules[aiAt+len(aiRules):], finalOut, restricted)
	rules = append(append(pre, aiRules...), post...)

	route := M{
		"rules":                   rules,
		"final":                   finalOut,
		"auto_detect_interface":   true,
		"default_domain_resolver": M{"server": "dns-direct"},
	}
	// The geo rule-sets are always bundled: the split-DNS below needs geosite-cn
	// regardless of the routing mode.
	route["rule_set"] = []M{
		{"type": "local", "tag": "geosite-cn", "format": "binary", "path": srsPath(geoDir, "geosite-cn.srs")},
		{"type": "local", "tag": "geoip-cn", "format": "binary", "path": srsPath(geoDir, "geoip-cn.srs")},
		{"type": "local", "tag": "geosite-ads", "format": "binary", "path": srsPath(geoDir, "geosite-category-ads-all.srs")},
	}
	if opts.Split {
		for _, tag := range append([]string{appSetBlock, appSetDirect}, groupTags...) {
			route["rule_set"] = append(route["rule_set"].([]M), M{"type": "local", "tag": tag, "format": "source", "path": ruleSetPath(opts.RuleDir, tag)})
		}
	}

	// Split DNS: mainland domains resolve via China DNS (dns-direct, DIRECT — no
	// dependency on the node), foreign domains via dns-remote (through the node).
	// So a dead/slow node can NEVER break DNS for mainland sites (previously all
	// DNS went through the node → node down = nothing resolves = "全都打不开").
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
	dnsServers := []M{
		// Foreign resolver through the node (anti-pollution) with a 2nd fallback.
		remoteDNSServer(node, "proxy"),
		// China resolver, DIRECT — reachable even when the node is down.
		{"type": "udp", "tag": "dns-direct", "server": "223.5.5.5"},
	}
	if aiDNSSrv != nil {
		dnsServers = append(dnsServers, aiDNSSrv)
	}
	dnsBlock := M{
		"servers": dnsServers,
		"rules":   dnsRules,
		"final":   dnsFinal,
	}
	if opts.NoHostIPv6 {
		dnsBlock["strategy"] = "ipv4_only"
	}
	tunInbounds := []M{
		{
			"type":         "tun",
			"tag":          "tun-in",
			"address":      tunAddresses(opts),
			"mtu":          1500,
			"auto_route":   true,
			"strict_route": true,
			"stack":        "system",
		},
	}
	if lan := lanInbound(opts); lan != nil {
		tunInbounds = append(tunInbounds, lan)
	}
	if opts.AccelPort > 0 {
		tunInbounds = append(tunInbounds, M{"type": "mixed", "tag": accelInbound, "listen": "127.0.0.1", "listen_port": opts.AccelPort})
	}
	if in := aiProxyInboundFor(opts); in != nil {
		tunInbounds = append(tunInbounds, in)
	}
	outs := append(proxyObs[:1:1], M{"type": "direct", "tag": "direct"})
	outs = append(outs, proxyObs[1:]...)
	for _, en := range opts.ExtraNodes {
		if en.Node == nil {
			continue
		}
		eobs, oerr := buildNodeOutbounds(en.Node, en.Tag, opts, false)
		if oerr != nil {
			return nil, oerr
		}
		outs = append(outs, eobs...)
	}
	cfg := M{
		"log":       M{"level": logLevel, "timestamp": true},
		"dns":       dnsBlock,
		"inbounds":  tunInbounds,
		"outbounds": outs,
		"route":     route,
	}
	if clashExp != nil {
		cfg["experimental"] = clashExp
	}
	return cfg, nil
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

// withRealityHybrid sets `tls.reality.relayops_hybrid` on a VLESS + Reality
// outbound (relayops patch 0005). Callers only pass POWER云 signed outbounds
// and only when the bundled core has coreupdate.RealityHybridTag.
func withRealityHybrid(m M) {
	if m["type"] != "vless" {
		return
	}
	tls, _ := m["tls"].(map[string]interface{})
	reality, _ := tls["reality"].(map[string]interface{})
	if reality == nil || reality["enabled"] != true {
		return
	}
	reality["relayops_hybrid"] = true
}

// buildOutbound converts a Node into a sing-box outbound object.
// buildOutbounds returns the outbound(s) for a node: the first one carries tag
// (what routes point at); raw-backed nodes may add helper outbounds (urltest
// members, detours) whose tags are prefixed with tag.
func buildOutbounds(n *nodes.Node, tag string, realityHybrid bool) ([]M, error) {
	if n.HasRaw() {
		return buildRawOutbounds(n, tag, realityHybrid && n.Official)
	}
	ob, err := buildOutbound(n, tag)
	if err != nil {
		return nil, err
	}
	// Compat: Clash smux / brutal-opts → sing-box multiplex (only when the
	// subscription asked for it; never added on our own).
	// VLESS vision flow cannot be multiplexed (sing-box rejects the config).
	if len(n.Multiplex) > 0 && n.Flow == "" {
		switch n.Type {
		case "vless", "vmess", "trojan", "shadowsocks":
			ob["multiplex"] = n.Multiplex
		}
	}
	return []M{ob}, nil
}

// buildRawOutbounds emits the node's verbatim sing-box outbounds. Only tags are
// rewritten: the entry outbound becomes tag, every other outbound becomes
// "tag/<original>", and references (group members, selector default, detour)
// are renamed to match. All other parameters are passed through untouched,
// except that third-party outbounds lose fields that only work on the
// author's machine (nodes.NeutraliseForeign).
func buildRawOutbounds(n *nodes.Node, tag string, realityHybrid bool) ([]M, error) {
	entry := n.EntryTag
	decoded := make([]M, 0, len(n.Outbounds))
	rename := map[string]string{}
	for i, raw := range n.Outbounds {
		m, err := nodes.DecodeOutbound(raw)
		if err != nil {
			return nil, fmt.Errorf("node %q: bad outbound: %w", n.Name, err)
		}
		orig, _ := m["tag"].(string)
		if entry == "" && i == 0 {
			entry = orig
		}
		if !n.Official {
			// Someone else's sing-box config: drop references to their DNS
			// servers, files and network setup, or the core would not start.
			// (POWER云 profiles are signed and passed through untouched.)
			nodes.NeutraliseForeign(m, localFileExists)
		}
		if realityHybrid {
			withRealityHybrid(m)
		}
		decoded = append(decoded, M(m))
		if orig != "" {
			rename[orig] = tag + "/" + orig
		}
	}
	if _, ok := rename[entry]; !ok {
		return nil, fmt.Errorf("node %q: entry outbound %q missing", n.Name, entry)
	}
	rename[entry] = tag
	var badRef string
	ref := func(v string) string {
		if r, ok := rename[v]; ok {
			return r
		}
		// Only "direct" exists in every generated config; any other outside
		// reference would silently bind to one of our own outbounds (e.g.
		// another node's tag), so it is rejected.
		if v != "direct" && badRef == "" {
			badRef = v
		}
		return v
	}
	out := make([]M, 0, len(decoded))
	var entryOb M
	for _, m := range decoded {
		orig, _ := m["tag"].(string)
		m["tag"] = ref(orig)
		if list, ok := m["outbounds"].([]any); ok {
			renamed := make([]any, len(list))
			for i, v := range list {
				if sv, ok := v.(string); ok {
					renamed[i] = ref(sv)
				} else {
					renamed[i] = v
				}
			}
			m["outbounds"] = renamed
		}
		for _, k := range []string{"default", "detour"} {
			if sv, ok := m[k].(string); ok && sv != "" {
				m[k] = ref(sv)
			}
		}
		if orig == entry {
			entryOb = m
		} else {
			out = append(out, m)
		}
	}
	if badRef != "" {
		return nil, fmt.Errorf("node %q: outbound references unknown tag %q", n.Name, badRef)
	}
	return append([]M{entryOb}, out...), nil
}

// localFileExists reports whether a file referenced by an imported outbound
// is present on this machine.
func localFileExists(path string) bool {
	st, err := os.Stat(path)
	return err == nil && !st.IsDir()
}

func buildOutbound(n *nodes.Node, tag string) (M, error) {
	if n == nil {
		return nil, fmt.Errorf("nil node")
	}
	switch n.Type {
	case "vless":
		return buildVLESS(n, tag), nil
	case "vmess":
		return buildVMess(n, tag), nil
	case "trojan":
		return buildTrojan(n, tag), nil
	case "shadowsocks":
		return buildShadowsocks(n, tag), nil
	case "socks":
		return buildSocks(n, tag), nil
	case "http":
		return buildHTTP(n, tag), nil
	case "hysteria2":
		return buildHysteria2(n, tag), nil
	case "tuic":
		return buildTUIC(n, tag), nil
	case "anytls":
		return buildAnyTLS(n, tag), nil
	default:
		return nil, fmt.Errorf("unsupported node type %q", n.Type)
	}
}

func buildSocks(n *nodes.Node, tag string) M {
	o := M{"type": "socks", "tag": tag, "server": n.Server, "server_port": n.Port, "version": "5"}
	if n.Username != "" {
		o["username"] = n.Username
	}
	if n.Password != "" {
		o["password"] = n.Password
	}
	return o
}

func buildHTTP(n *nodes.Node, tag string) M {
	o := M{"type": "http", "tag": tag, "server": n.Server, "server_port": n.Port}
	if n.Username != "" {
		o["username"] = n.Username
	}
	if n.Password != "" {
		o["password"] = n.Password
	}
	if n.Security == "tls" {
		o["tls"] = M{"enabled": true, "server_name": firstNonEmpty(n.SNI, n.Server), "insecure": n.Insecure}
	}
	return o
}

func buildHysteria2(n *nodes.Node, tag string) M {
	tls := M{"enabled": true, "server_name": firstNonEmpty(n.SNI, n.Server), "insecure": n.Insecure}
	if len(n.ALPN) > 0 {
		tls["alpn"] = n.ALPN
	}
	return M{"type": "hysteria2", "tag": tag, "server": n.Server, "server_port": n.Port, "password": n.Password, "tls": tls}
}

func buildAnyTLS(n *nodes.Node, tag string) M {
	tls := M{"enabled": true, "server_name": firstNonEmpty(n.SNI, n.Server), "insecure": n.Insecure}
	if len(n.ALPN) > 0 {
		tls["alpn"] = n.ALPN
	}
	return M{"type": "anytls", "tag": tag, "server": n.Server, "server_port": n.Port, "password": n.Password, "tls": tls}
}

func buildTUIC(n *nodes.Node, tag string) M {
	tls := M{"enabled": true, "server_name": firstNonEmpty(n.SNI, n.Server), "insecure": n.Insecure}
	if len(n.ALPN) > 0 {
		tls["alpn"] = n.ALPN
	}
	return M{
		"type": "tuic", "tag": tag, "server": n.Server, "server_port": n.Port,
		"uuid": n.UUID, "password": n.Password, "congestion_control": firstNonEmpty(n.CC, "bbr"), "tls": tls,
	}
}

func buildVLESS(n *nodes.Node, tag string) M {
	o := M{
		"type":        "vless",
		"tag":         tag,
		"server":      n.Server,
		"server_port": n.Port,
		"uuid":        n.UUID,
	}
	if n.Flow != "" {
		o["flow"] = n.Flow
	}
	if tls := buildTLS(n); tls != nil {
		o["tls"] = tls
	}
	if tr := buildTransport(n); tr != nil {
		o["transport"] = tr
	}
	return o
}

func buildVMess(n *nodes.Node, tag string) M {
	o := M{
		"type":        "vmess",
		"tag":         tag,
		"server":      n.Server,
		"server_port": n.Port,
		"uuid":        n.UUID,
		"alter_id":    n.AlterID,
		"security":    firstNonEmpty(n.Cipher, "auto"),
	}
	if tls := buildTLS(n); tls != nil {
		o["tls"] = tls
	}
	if tr := buildTransport(n); tr != nil {
		o["transport"] = tr
	}
	return o
}

func buildTrojan(n *nodes.Node, tag string) M {
	o := M{
		"type":        "trojan",
		"tag":         tag,
		"server":      n.Server,
		"server_port": n.Port,
		"password":    n.Password,
	}
	// trojan is TLS by default
	if tls := buildTLS(n); tls != nil {
		o["tls"] = tls
	} else {
		o["tls"] = M{"enabled": true, "server_name": firstNonEmpty(n.SNI, n.Server), "insecure": n.Insecure}
	}
	if tr := buildTransport(n); tr != nil {
		o["transport"] = tr
	}
	return o
}

func buildShadowsocks(n *nodes.Node, tag string) M {
	o := M{
		"type":        "shadowsocks",
		"tag":         tag,
		"server":      n.Server,
		"server_port": n.Port,
		"method":      n.Method,
		"password":    n.Password,
	}
	if n.Plugin != "" {
		o["plugin"] = n.Plugin
		if n.PluginOpts != "" {
			o["plugin_opts"] = n.PluginOpts
		}
	}
	return o
}

// buildTLS returns a sing-box tls block, or nil when the node uses no TLS.
func buildTLS(n *nodes.Node) M {
	switch n.Security {
	case "tls", "reality", "xtls":
	default:
		return nil
	}
	tls := M{
		"enabled":     true,
		"server_name": firstNonEmpty(n.SNI, n.Host, n.Server),
		"insecure":    n.Insecure,
	}
	if len(n.ALPN) > 0 {
		tls["alpn"] = n.ALPN
	}
	if n.Fingerprint != "" {
		tls["utls"] = M{"enabled": true, "fingerprint": n.Fingerprint}
	}
	if n.Security == "reality" && n.PublicKey != "" {
		tls["reality"] = M{
			"enabled":    true,
			"public_key": n.PublicKey,
			"short_id":   n.ShortID,
		}
		// Reality mandates a real uTLS fingerprint.
		if n.Fingerprint == "" {
			tls["utls"] = M{"enabled": true, "fingerprint": "chrome"}
		}
	}
	return tls
}

// buildTransport returns a sing-box transport block for ws/grpc/http, or nil for
// plain TCP.
func buildTransport(n *nodes.Node) M {
	switch n.Network {
	case "ws", "websocket":
		t := M{"type": "ws"}
		if n.Path != "" {
			t["path"] = n.Path
		}
		if n.Host != "" {
			t["headers"] = M{"Host": n.Host}
		}
		return t
	case "grpc":
		return M{"type": "grpc", "service_name": n.Path}
	case "http", "h2":
		t := M{"type": "http"}
		if n.Path != "" {
			t["path"] = n.Path
		}
		if n.Host != "" {
			t["host"] = []string{n.Host}
		}
		return t
	default:
		return nil
	}
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// remoteDNSServer is the foreign resolver reached through the node. SOCKS5 and
// HTTP proxies often cannot relay UDP (HTTP never can; many sold SOCKS5 IPs
// skip UDP ASSOCIATE), so plain UDP DNS through them fails and every foreign
// site looks dead while v2rayN (system proxy, remote hostname) still works.
// Those nodes get DNS over TCP instead.
func remoteDNSServer(n *nodes.Node, detour string) M {
	typ := "udp"
	if n != nil && (n.Type == "socks" || n.Type == "http") {
		typ = "tcp"
	}
	return M{"type": typ, "tag": "dns-remote", "server": "8.8.8.8", "detour": detour}
}
