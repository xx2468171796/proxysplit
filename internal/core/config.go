package core

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
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
	// DNS are the user's DNS settings (DNS 设置, v2rayN SimpleDNSItem); the
	// zero value keeps the built-in resolvers.
	DNS DNSOptions
	// TunMTU overrides the TUN MTU (0 = 1500); StrictRouteOff turns sing-box
	// strict_route off for the rare VM / VPN software it breaks.
	TunMTU         int
	StrictRouteOff bool

	// RealityHybrid: the bundled core carries relayops patch 0005, so POWER云
	// VLESS + Reality outbounds keep the X25519MLKEM768 key share (ClientHello
	// like real Chrome). Never applied to third-party nodes (compat mode).
	RealityHybrid bool

	// ServerIPs: node server domain → pre-resolved IP (internal/noderesolve).
	// Outbounds dial the IP and keep the domain as SNI / Host (PinNode).
	ServerIPs map[string]string
	// DNSOptimistic / DNSCacheFile: serve-stale DNS cache and the persistent
	// cache file (TUN configs; never while the AI guard is active, dnscache.go).
	DNSOptimistic bool
	DNSCacheFile  string

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
	// ExitProbe is the AI page's loopback probe into the selected node (nil = none).
	ExitProbe *AIProxy

	// Process selects 仅接管选中程序 (BuildProcessConfig): mixed inbounds per app
	// group fed by internal/capture instead of the TUN. nil = TUN.
	Process *ProcessCapture
}

// AIGuardActive reports whether the AI lock is on (it needs the TUN).
func (o Options) AIGuardActive() bool { return o.AIGuard.active() }

const accelInbound = "accel-in"

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

// DirPrefix marks a process-list entry that means "every program under this
// folder" (an application identified by its install directory, internal/appid)
// instead of one exe name.
const DirPrefix = "dir:"

// DirRegex matches every process whose path lies under dir, case-insensitively.
func DirRegex(dir string) string {
	dir = strings.TrimRight(strings.ReplaceAll(strings.TrimSpace(dir), "/", `\`), `\`)
	return `(?i)^` + regexp.QuoteMeta(dir) + `\\`
}

// ExtraNode is an additional node outbound (beyond the primary "proxy").
type ExtraNode struct {
	Tag  string
	Node *nodes.Node
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
