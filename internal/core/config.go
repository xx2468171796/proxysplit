package core

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"

	"proxysplit/internal/nodes"
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

// Options tunes the generated core config.
type Options struct {
	// RemoteDNS enables domain sniffing + remote DNS: sing-box recovers the real
	// domain from the TLS ClientHello, overriding a possibly-poisoned local IP,
	// and passes the domain to the node for remote resolution (anti-pollution,
	// no DNS leak). Requires no DNS interception in our redirect model.
	RemoteDNS bool

	// RouteMode selects how in-tunnel traffic is split (see Route* constants).
	RouteMode string
	// RouteRules are the user rules used when RouteMode == RouteCustom.
	RouteRules []RouteRule
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
}

// SplitGroup is a set of processes routed the same way: Mode is "rule" (smart
// split) or "global" (everything through the node); NodeTag is the outbound tag
// ("proxy" = active node, or "node-<id>" for an ExtraNode).
type SplitGroup struct {
	Names   []string
	Mode    string
	NodeTag string
}

// ExtraNode is an additional node outbound (beyond the primary "proxy").
type ExtraNode struct {
	Tag  string
	Node *nodes.Node
}

// customRoutingRules turns the user's global custom rules into route entries
// (proxy → nodeTag, direct → direct, block → reject). Not inbound-scoped, so
// they apply to all proxied traffic. nil when there are none.
func customRoutingRules(opts Options, nodeTag string) []M {
	var out []M
	for _, r := range opts.CustomRules {
		m := ruleMatch(r)
		if m == nil {
			continue
		}
		switch r.Action {
		case "direct":
			m["outbound"] = "direct"
		case "block":
			m["action"] = "reject"
		default:
			m["outbound"] = nodeTag
		}
		out = append(out, m)
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
			ob, err := buildOutbound(ln.Node, tag)
			if err != nil {
				return nil, err
			}
			outbounds = append(outbounds, ob)
			nodeTag[ln.Node.ID] = tag
		}
	}
	outbounds = append(outbounds, M{"type": "direct", "tag": "direct"})
	if lan := lanInbound(opts); lan != nil {
		inbounds = append(inbounds, lan)
	}

	// Domain awareness (sniff + DNS + resolver) is needed for remote-DNS or any
	// domain-based routing.
	needDomain := opts.RemoteDNS || customNeedsDomain(opts)
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

	// clash_mode overrides (Direct/Global) — checked before the per-line rules.
	if exp := clashExperimental(opts); exp != nil {
		cfg["experimental"] = exp
		rules = append(rules, clashRules(nodeTag[lines[0].Node.ID])...)
	}
	// LAN-shared inbound routes through the active node.
	rules = append(rules, lanRules(opts, nodeTag[lines[0].Node.ID])...)
	// Global user custom rules — highest priority, before the geo/per-line rules.
	rules = append(rules, customRoutingRules(opts, nodeTag[lines[0].Node.ID])...)

	// Per-line, inbound-scoped routing rules.
	for _, ln := range lines {
		in := []string{"in-" + ln.Key}
		tag := nodeTag[ln.Node.ID]
		switch ln.RouteMode {
		case RouteBypassCN:
			rules = append(rules,
				M{"inbound": in, "rule_set": []string{"geosite-ads"}, "action": "reject"},
				M{"inbound": in, "rule_set": []string{"geosite-cn", "geoip-cn"}, "outbound": "direct"},
				M{"inbound": in, "outbound": tag},
			)
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

	route := M{"final": "direct"}
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
	ob, err := buildOutbound(node, "proxy")
	if err != nil {
		return nil, err
	}
	if logLevel == "" {
		logLevel = "info"
	}
	routeMode := opts.RouteMode
	routeRules := opts.RouteRules
	geoDir := opts.GeoDir

	// Base rules: sniff the domain, hijack DNS into sing-box, keep LAN direct.
	rules := []M{
		{"action": "sniff"},
		{"protocol": "dns", "action": "hijack-dns"},
		{"ip_is_private": true, "outbound": "direct"},
	}
	clashExp := clashExperimental(opts)
	geoNeeded := false
	finalOut := "proxy"
	// LAN-shared inbound (if any) routes through the node; global custom rules
	// apply in both modes (highest-priority user intent).
	rules = append(rules, lanRules(opts, "proxy")...)
	rules = append(rules, customRoutingRules(opts, "proxy")...)

	if opts.Split {
		// Application-split via sing-box's own process_name matcher (replaces the
		// WinDivert engine). Block/direct carve-outs come first in both modes.
		if len(opts.SplitBlock) > 0 {
			rules = append(rules, M{"process_name": opts.SplitBlock, "action": "reject"})
		}
		if len(opts.SplitDirect) > 0 {
			rules = append(rules, M{"process_name": opts.SplitDirect, "outbound": "direct"})
		}
		if opts.SplitWhitelist {
			// Whitelist: ONLY the rule/global apps are eligible; everything else
			// (incl. unlisted) falls through to route.final = direct. Each group
			// may target a different node (g.NodeTag) → per-app 不同节点.
			finalOut = "direct"
			// Top-bar 代理策略 (直连/全局) master override, scoped per group so 全局
			// still routes each app to ITS node.
			if clashExp != nil {
				for _, g := range opts.SplitGroups {
					if len(g.Names) == 0 {
						continue
					}
					rules = append(rules,
						M{"process_name": g.Names, "clash_mode": "direct", "outbound": "direct"},
						M{"process_name": g.Names, "clash_mode": "global", "outbound": g.NodeTag},
					)
				}
			}
			// Per-app-mode rules (apply in the default "rule" clash mode).
			for _, g := range opts.SplitGroups {
				if len(g.Names) == 0 {
					continue
				}
				if g.Mode == "global" {
					rules = append(rules, M{"process_name": g.Names, "outbound": g.NodeTag})
				} else {
					rules = append(rules,
						M{"process_name": g.Names, "rule_set": []string{"geosite-ads"}, "action": "reject"},
						M{"process_name": g.Names, "rule_set": []string{"geosite-cn", "geoip-cn"}, "outbound": "direct"},
						M{"process_name": g.Names, "outbound": g.NodeTag},
					)
					geoNeeded = true
				}
			}
		} else {
			// Blacklist: the whole machine uses the node (route.final = proxy)
			// EXCEPT the SplitDirect/SplitBlock apps handled above. Smart routing
			// (clash overrides + mainland bypass) applies globally.
			if clashExp != nil {
				rules = append(rules, clashRules("proxy")...)
			}
			rules = append(rules,
				M{"rule_set": []string{"geosite-ads"}, "action": "reject"},
				M{"rule_set": []string{"geosite-cn", "geoip-cn"}, "outbound": "direct"},
			)
			geoNeeded = true
		}
	} else {
		// System-wide TUN (whole machine): clash overrides apply globally.
		if clashExp != nil {
			rules = append(rules, clashRules("proxy")...)
		}
		switch routeMode {
		case RouteBypassCN:
			rules = append(rules,
				M{"rule_set": []string{"geosite-ads"}, "action": "reject"},
				M{"rule_set": []string{"geosite-cn", "geoip-cn"}, "outbound": "direct"},
			)
			geoNeeded = true
		case RouteCustom:
			for _, r := range routeRules {
				m := ruleMatch(r)
				if m == nil {
					continue
				}
				switch r.Action {
				case "direct":
					m["outbound"] = "direct"
				case "block":
					m["action"] = "reject"
				default:
					m["outbound"] = "proxy"
				}
				rules = append(rules, m)
			}
		}
	}

	route := M{
		"rules":                   rules,
		"final":                   finalOut,
		"auto_detect_interface":   true,
		"default_domain_resolver": M{"server": "dns-direct"},
	}
	// Always bundle the geo rule-sets: routing uses them when geoNeeded, and the
	// split-DNS below needs geosite-cn regardless.
	_ = geoNeeded
	route["rule_set"] = []M{
		{"type": "local", "tag": "geosite-cn", "format": "binary", "path": srsPath(geoDir, "geosite-cn.srs")},
		{"type": "local", "tag": "geoip-cn", "format": "binary", "path": srsPath(geoDir, "geoip-cn.srs")},
		{"type": "local", "tag": "geosite-ads", "format": "binary", "path": srsPath(geoDir, "geosite-category-ads-all.srs")},
	}

	// Split DNS: mainland domains resolve via China DNS (dns-direct, DIRECT — no
	// dependency on the node), foreign domains via dns-remote (through the node).
	// So a dead/slow node can NEVER break DNS for mainland sites (previously all
	// DNS went through the node → node down = nothing resolves = "全都打不开").
	dnsRules := []M{}
	if dr := clashDNSRules(opts); dr != nil {
		dnsRules = append(dnsRules, dr...)
	}
	dnsRules = append(dnsRules, M{"rule_set": []string{"geosite-cn"}, "server": "dns-direct"})
	dnsBlock := M{
		"servers": []M{
			// Foreign resolver through the node (anti-pollution) with a 2nd fallback.
			{"type": "udp", "tag": "dns-remote", "server": "8.8.8.8", "detour": "proxy"},
			// China resolver, DIRECT — reachable even when the node is down.
			{"type": "udp", "tag": "dns-direct", "server": "223.5.5.5"},
		},
		"rules": dnsRules,
		"final": "dns-remote",
	}
	tunInbounds := []M{
		{
			"type":         "tun",
			"tag":          "tun-in",
			"address":      []string{"172.19.0.1/30"},
			"mtu":          1500,
			"auto_route":   true,
			"strict_route": true,
			"stack":        "system",
		},
	}
	if lan := lanInbound(opts); lan != nil {
		tunInbounds = append(tunInbounds, lan)
	}
	outs := []M{ob, {"type": "direct", "tag": "direct"}}
	for _, en := range opts.ExtraNodes {
		if en.Node == nil {
			continue
		}
		eob, oerr := buildOutbound(en.Node, en.Tag)
		if oerr != nil {
			return nil, oerr
		}
		outs = append(outs, eob)
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
	return json.MarshalIndent(cfg, "", "  ")
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

// srsPath joins the geo dir and a rule-set file name (forward slashes so the JSON
// stays clean; sing-box accepts them on Windows).
func srsPath(dir, name string) string {
	if dir == "" {
		return name
	}
	return strings.ReplaceAll(filepath.Join(dir, name), "\\", "/")
}

// buildOutbound converts a Node into a sing-box outbound object.
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
	return M{
		"type":        "shadowsocks",
		"tag":         tag,
		"server":      n.Server,
		"server_port": n.Port,
		"method":      n.Method,
		"password":    n.Password,
	}
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
