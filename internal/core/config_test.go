package core

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"proxysplit/internal/nodes"
)

// sampleLinks are structurally-valid share links (fake credentials) covering the
// four supported protocols and the common transport/security combinations.
var sampleLinks = map[string]string{
	"vless-reality": "vless://11111111-2222-3333-4444-555555555555@example.com:443?encryption=none&security=reality&sni=www.microsoft.com&fp=chrome&pbk=jNXHt1yRo0vDuchQlIP6Z0ZvjT3KtzVI-T4E7RoLJS0&sid=0123abcd&type=tcp&flow=xtls-rprx-vision#Reality-Node",
	"vless-ws-tls":  "vless://11111111-2222-3333-4444-555555555555@example.com:443?encryption=none&security=tls&sni=cdn.example.com&type=ws&path=%2Fpath&host=cdn.example.com#VLESS-WS",
	"vmess-ws":      "vmess://eyJ2IjoiMiIsInBzIjoiVk1lc3MtV1MiLCJhZGQiOiJleGFtcGxlLmNvbSIsInBvcnQiOiI0NDMiLCJpZCI6IjExMTExMTExLTIyMjItMzMzMy00NDQ0LTU1NTU1NTU1NTU1NSIsImFpZCI6IjAiLCJzY3kiOiJhdXRvIiwibmV0Ijoid3MiLCJob3N0IjoiY2RuLmV4YW1wbGUuY29tIiwicGF0aCI6Ii9wYXRoIiwidGxzIjoidGxzIiwic25pIjoiY2RuLmV4YW1wbGUuY29tIn0=",
	"trojan":        "trojan://password123@example.com:443?sni=example.com&type=tcp#Trojan-Node",
	"ss":            "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQxMjM=@example.com:8388#SS-Node",
	"socks":         "socks://dXNlcjpwYXNz@example.com:1080#Socks-Node",
	"http":          "http://user:pass@example.com:8080#HTTP-Node",
	"hysteria2":     "hysteria2://password123@example.com:443?sni=example.com&insecure=1#Hy2-Node",
	"tuic":          "tuic://11111111-2222-3333-4444-555555555555:password@example.com:443?sni=example.com&congestion_control=bbr&alpn=h3#TUIC-Node",
	"anytls":        "anytls://password123@example.com:443?sni=example.com&insecure=1#AnyTLS-Node",
}

func singboxPath(t *testing.T) string {
	p, err := filepath.Abs(filepath.Join("..", "..", "bin", "sing-box.exe"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(p); err != nil {
		t.Skipf("sing-box binary not found at %s", p)
	}
	return p
}

func TestManualNode(t *testing.T) {
	bin := singboxPath(t)
	dir := t.TempDir()
	for _, tp := range []string{"socks", "http"} {
		n, err := nodes.Manual(tp, "Test", "1.2.3.4", 1080, "user", "pass")
		if err != nil {
			t.Fatal(err)
		}
		cfg, err := BuildConfig(n, 17890, "info", Options{})
		if err != nil {
			t.Fatal(err)
		}
		p := filepath.Join(dir, tp+".json")
		os.WriteFile(p, cfg, 0o600)
		if out, err := exec.Command(bin, "check", "-c", p).CombinedOutput(); err != nil {
			t.Fatalf("manual %s rejected: %s", tp, out)
		}
		t.Logf("manual %s -> OK", tp)
	}
}

func TestTUNConfig(t *testing.T) {
	bin := singboxPath(t)
	dir := t.TempDir()
	geoDir, _ := filepath.Abs(filepath.Join("..", "..", "bin"))
	node, err := nodes.ParseLink(sampleLinks["vless-reality"])
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{RouteGlobal, RouteBypassCN} {
		cfg, err := BuildTUNConfig(node, "info", Options{RouteMode: mode, GeoDir: geoDir})
		if err != nil {
			t.Fatalf("build %s: %v", mode, err)
		}
		path := filepath.Join(dir, "tun-"+mode+".json")
		os.WriteFile(path, cfg, 0o600)
		if out, err := exec.Command(bin, "check", "-c", path).CombinedOutput(); err != nil {
			t.Fatalf("sing-box check rejected TUN %s:\n%s\n%s", mode, out, cfg)
		}
		t.Logf("TUN %s -> OK", mode)
	}
}

// TestSplitScopedConfig verifies that per-app target-scoped rules (process +
// domain/IP/port) emit valid sing-box route rules across all four action kinds
// and the clash 直连 override path.
func TestSplitScopedConfig(t *testing.T) {
	bin := singboxPath(t)
	dir := t.TempDir()
	geoDir, _ := filepath.Abs(filepath.Join("..", "..", "bin"))
	node, err := nodes.ParseLink(sampleLinks["vless-reality"])
	if err != nil {
		t.Fatal(err)
	}
	opts := Options{
		GeoDir:          geoDir,
		Split:           true,
		SplitWhitelist:  true,
		ClashController: "127.0.0.1:19090", // enables the clash_mode 直连 override branch
		SplitScoped: []ScopedRule{
			{Name: "chrome.exe", Domains: []string{"google.com", "openai.com"}, Ports: []string{"443"}, Outbound: "proxy"},
			{Name: "code.exe", IPs: []string{"1.1.1.1/32", "10.0.0.0/8"}, Outbound: "direct"},
			{Name: "ads.exe", Domains: []string{"doubleclick.net"}, Outbound: "reject"},
			{Name: "game.exe", Ports: []string{"8000-9000"}, Outbound: "proxy"},
		},
	}
	writeSplitSets(t, &opts)
	cfg, err := BuildTUNConfig(node, "info", opts)
	if err != nil {
		t.Fatalf("build scoped: %v", err)
	}
	path := filepath.Join(dir, "tun-scoped.json")
	os.WriteFile(path, cfg, 0o600)
	if out, err := exec.Command(bin, "check", "-c", path).CombinedOutput(); err != nil {
		t.Fatalf("sing-box check rejected scoped config:\n%s\n%s", out, cfg)
	}
	for _, want := range []string{"domain_suffix", "ip_cidr", "port_range", "process_name"} {
		if !strings.Contains(string(cfg), want) {
			t.Errorf("scoped config missing %q", want)
		}
	}
	t.Logf("scoped TUN -> OK")
}

func TestMultiLine(t *testing.T) {
	bin := singboxPath(t)
	dir := t.TempDir()
	geoDir, _ := filepath.Abs(filepath.Join("..", "..", "bin"))

	jp, err := nodes.ParseLink(sampleLinks["vless-reality"])
	if err != nil {
		t.Fatal(err)
	}
	us, err := nodes.ParseLink(sampleLinks["trojan"])
	if err != nil {
		t.Fatal(err)
	}
	// Two apps -> two nodes with different policies, plus a shared-node line.
	lines := []LineConfig{
		{Key: "L1", InboundPort: 21001, Node: jp, RouteMode: RouteBypassCN},
		{Key: "L2", InboundPort: 21002, Node: us, RouteMode: RouteGlobal},
		{Key: "L3", InboundPort: 21003, Node: jp, RouteMode: RouteCustom, RouteRules: []RouteRule{
			{Type: "suffix", Value: "openai.com", Action: "proxy"},
			{Type: "suffix", Value: "cn", Action: "direct"},
		}},
	}
	cfg, err := BuildMultiConfig(lines, "info", Options{RemoteDNS: true, GeoDir: geoDir})
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	path := filepath.Join(dir, "multi.json")
	if err := os.WriteFile(path, cfg, 0o600); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command(bin, "check", "-c", path).CombinedOutput(); err != nil {
		t.Fatalf("sing-box check rejected multi-line config:\n%s\n%s", out, cfg)
	}
	t.Log("multi-line (3 inbounds, 2 nodes, 3 policies) -> OK")
}

func TestClashConfig(t *testing.T) {
	bin := singboxPath(t)
	dir := t.TempDir()
	geoDir, _ := filepath.Abs(filepath.Join("..", "..", "bin"))
	node, err := nodes.ParseLink(sampleLinks["vless-reality"])
	if err != nil {
		t.Fatal(err)
	}
	opts := Options{RemoteDNS: true, GeoDir: geoDir, ClashController: "127.0.0.1:19090", ClashSecret: "deadbeef", ClashMode: "global",
		CustomRules: []RouteRule{
			{Type: "suffix", Value: "github.com", Action: "proxy"},
			{Type: "domain", Value: "ipinfo.io", Action: "direct"},
			{Type: "keyword", Value: "doubleclick", Action: "block"},
			{Type: "ip", Value: "1.1.1.1/32", Action: "direct"},
		}}

	// Multi-line config with clash_api enabled.
	multi := []LineConfig{{Key: "L1", InboundPort: 21001, Node: node, RouteMode: RouteBypassCN}}
	cfg, err := BuildMultiConfig(multi, "info", opts)
	if err != nil {
		t.Fatalf("build multi: %v", err)
	}
	path := filepath.Join(dir, "clash-multi.json")
	os.WriteFile(path, cfg, 0o600)
	if out, err := exec.Command(bin, "check", "-c", path).CombinedOutput(); err != nil {
		t.Fatalf("clash multi rejected:\n%s\n%s", out, cfg)
	}
	t.Log("clash multi-line -> OK")

	// TUN config with clash_api enabled.
	tunOpts := opts
	tunOpts.RouteMode = RouteBypassCN
	tcfg, err := BuildTUNConfig(node, "info", tunOpts)
	if err != nil {
		t.Fatalf("build tun: %v", err)
	}
	tpath := filepath.Join(dir, "clash-tun.json")
	os.WriteFile(tpath, tcfg, 0o600)
	if out, err := exec.Command(bin, "check", "-c", tpath).CombinedOutput(); err != nil {
		t.Fatalf("clash tun rejected:\n%s\n%s", out, tcfg)
	}
	t.Log("clash TUN -> OK")
}

func TestCustomRulesPriority(t *testing.T) {
	bin := singboxPath(t)
	dir := t.TempDir()
	geoDir, _ := filepath.Abs(filepath.Join("..", "..", "bin"))
	node, err := nodes.ParseLink(sampleLinks["vless-reality"])
	if err != nil {
		t.Fatal(err)
	}
	opts := Options{RemoteDNS: true, GeoDir: geoDir, ClashController: "127.0.0.1:19091", ClashSecret: "x", ClashMode: "rule",
		CustomRules: []RouteRule{{Type: "domain", Value: "custom-test.example", Action: "direct"}}}
	lines := []LineConfig{{Key: "L1", InboundPort: 21001, Node: node, RouteMode: RouteBypassCN}}
	cfg, err := BuildMultiConfig(lines, "info", opts)
	if err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(dir, "custom.json")
	os.WriteFile(p, cfg, 0o600)
	if out, err := exec.Command(bin, "check", "-c", p).CombinedOutput(); err != nil {
		t.Fatalf("sing-box rejected custom-rule config:\n%s\n%s", out, cfg)
	}
	// The custom domain rule must sit BEFORE the geo (geosite-cn) rule in route.rules.
	var m map[string]interface{}
	if err := json.Unmarshal(cfg, &m); err != nil {
		t.Fatal(err)
	}
	rules := m["route"].(map[string]interface{})["rules"].([]interface{})
	customIdx, geoIdx := -1, -1
	for i, r := range rules {
		rm := r.(map[string]interface{})
		if d, ok := rm["domain"].([]interface{}); ok {
			for _, v := range d {
				if v == "custom-test.example" {
					customIdx = i
				}
			}
		}
		if rs, ok := rm["rule_set"].([]interface{}); ok {
			for _, v := range rs {
				if v == "geosite-cn" {
					geoIdx = i
				}
			}
		}
	}
	if customIdx < 0 {
		t.Fatal("custom rule missing from generated config")
	}
	if geoIdx >= 0 && customIdx > geoIdx {
		t.Fatalf("custom rule (idx %d) is AFTER geo rule (idx %d) — wrong priority", customIdx, geoIdx)
	}
	t.Logf("custom rule present at idx %d, before geo rule at idx %d — priority OK", customIdx, geoIdx)
}

func routeRulesFromConfig(t *testing.T, cfg []byte) []interface{} {
	t.Helper()
	var decoded map[string]interface{}
	if err := json.Unmarshal(cfg, &decoded); err != nil {
		t.Fatal(err)
	}
	return decoded["route"].(map[string]interface{})["rules"].([]interface{})
}

func TestRuleSetSelectionAffectsGeneratedRules(t *testing.T) {
	node, err := nodes.ParseLink(sampleLinks["vless-reality"])
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := BuildTUNConfig(node, "info", Options{
		RouteMode: RouteBypassCN,
		RuleSets:  &RuleSetOptions{GeoSiteCN: true, GeoIPCN: false, Ads: false},
	})
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, raw := range routeRulesFromConfig(t, cfg) {
		rule := raw.(map[string]interface{})
		if sets, ok := rule["rule_set"].([]interface{}); ok {
			for _, set := range sets {
				seen[set.(string)] = true
			}
		}
	}
	if !seen["geosite-cn"] || seen["geoip-cn"] || seen["geosite-ads"] {
		t.Fatalf("rule-set switches not reflected in route rules: %+v", seen)
	}
}

func TestSplitCustomGroupRulesAreProcessScoped(t *testing.T) {
	node, err := nodes.ParseLink(sampleLinks["vless-reality"])
	if err != nil {
		t.Fatal(err)
	}
	opts := Options{
		Split:          true,
		SplitWhitelist: true,
		SplitGroups: []SplitGroup{{
			Key:     "line-a|proxy|custom",
			Names:   []string{"CustomApp.exe"},
			Mode:    RouteCustom,
			NodeTag: "proxy",
			Rules: []RouteRule{
				{Type: "suffix", Value: "example.cn", Action: "direct"},
				{Type: "keyword", Value: "tracker", Action: "block"},
			},
		}},
	}
	cfg, err := BuildTUNConfig(node, "info", opts)
	if err != nil {
		t.Fatal(err)
	}
	tag := splitGroupTags(opts)[0]
	if !strings.Contains(string(SplitRuleSets(opts)[tag]), "CustomApp.exe") {
		t.Fatalf("group rule-set %s does not list the app", tag)
	}
	// Every custom-line rule must be ANDed with the group's process rule-set.
	inGroup := func(rule map[string]interface{}) (map[string]interface{}, bool) {
		parts, _ := rule["rules"].([]interface{})
		if rule["type"] != "logical" || len(parts) != 2 {
			return nil, false
		}
		sets, _ := parts[0].(map[string]interface{})["rule_set"].([]interface{})
		return parts[1].(map[string]interface{}), len(sets) == 1 && sets[0] == tag
	}
	direct, block, catchAll := false, false, false
	for _, raw := range routeRulesFromConfig(t, cfg) {
		rule := raw.(map[string]interface{})
		if sets, ok := rule["rule_set"].([]interface{}); ok && len(sets) == 1 && sets[0] == tag && rule["outbound"] == "proxy" {
			catchAll = true
		}
		match, ok := inGroup(rule)
		if !ok {
			continue
		}
		if s, _ := match["domain_suffix"].([]interface{}); len(s) == 1 && s[0] == "example.cn" && rule["outbound"] == "direct" {
			direct = true
		}
		if k, _ := match["domain_keyword"].([]interface{}); len(k) == 1 && k[0] == "tracker" && rule["action"] == "reject" {
			block = true
		}
	}
	if !direct || !block || !catchAll {
		t.Fatalf("custom split group incomplete: direct=%v block=%v catchAll=%v\n%s", direct, block, catchAll, cfg)
	}
}

// writeSplitSets points opts at a temp RuleDir and writes the per-app rule-sets
// the app-split config reads, so `sing-box check` can open them.
func writeSplitSets(t *testing.T, opts *Options) {
	t.Helper()
	opts.RuleDir = t.TempDir()
	for tag, data := range SplitRuleSets(*opts) {
		if err := os.WriteFile(filepath.Join(opts.RuleDir, tag+".json"), data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

// TestSplitKeepsOwnAPIDirectFirst: the own-API direct rule exists in the app-split
// TUN config (not just the legacy multi-line one) ahead of every routing rule,
// and the config with its rule-sets passes sing-box check.
func TestSplitKeepsOwnAPIDirectFirst(t *testing.T) {
	bin := singboxPath(t)
	geoDir, _ := filepath.Abs(filepath.Join("..", "..", "bin"))
	node, err := nodes.ParseLink(sampleLinks["vless-reality"])
	if err != nil {
		t.Fatal(err)
	}
	opts := Options{
		GeoDir: geoDir, ClashController: "127.0.0.1:19092", DirectDomains: []string{"proxysplit.example.cn"},
		Split: true, SplitWhitelist: true, BlockQUIC: true, SelfProcess: "proxysplit.exe",
		SplitGroups: []SplitGroup{{Key: "rule|proxy|bypass_cn", Names: []string{"chrome.exe"}, Mode: RouteBypassCN, NodeTag: "proxy"}},
		CustomRules: []RouteRule{{Type: "suffix", Value: "github.com", Action: "proxy"}},
	}
	writeSplitSets(t, &opts)
	cfg, err := BuildTUNConfig(node, "info", opts)
	if err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(t.TempDir(), "split.json")
	os.WriteFile(p, cfg, 0o600)
	if out, err := exec.Command(bin, "check", "-c", p).CombinedOutput(); err != nil {
		t.Fatalf("sing-box rejected the config:\n%s\n%s", out, cfg)
	}
	for i, raw := range routeRulesFromConfig(t, cfg) {
		rule := raw.(map[string]interface{})
		if d, ok := rule["domain"].([]interface{}); ok && len(d) == 1 && d[0] == "proxysplit.example.cn" && rule["outbound"] == "direct" {
			if i > 3 { // only sniff, DNS hijack and the 拦截 list may precede it
				t.Fatalf("own-API direct rule at idx %d, want right after sniff/DNS/拦截", i)
			}
			return
		}
	}
	t.Fatalf("own-API direct rule missing:\n%s", cfg)
}

func TestLanShareConfig(t *testing.T) {
	bin := singboxPath(t)
	dir := t.TempDir()
	geoDir, _ := filepath.Abs(filepath.Join("..", "..", "bin"))
	node, err := nodes.ParseLink(sampleLinks["vless-reality"])
	if err != nil {
		t.Fatal(err)
	}
	for _, typ := range []string{"mixed", "socks", "http"} {
		for _, auth := range []bool{false, true} {
			opts := Options{RemoteDNS: true, GeoDir: geoDir, LanShare: true, LanPort: 7890, LanType: typ}
			if auth {
				opts.LanUser, opts.LanPass = "lanuser", "lanpass"
			}
			// multi-line (app-split) path
			lines := []LineConfig{{Key: "L1", InboundPort: 21001, Node: node, RouteMode: RouteBypassCN}}
			cfg, err := BuildMultiConfig(lines, "info", opts)
			if err != nil {
				t.Fatalf("build multi %s auth=%v: %v", typ, auth, err)
			}
			p := filepath.Join(dir, "lan-multi-"+typ+".json")
			os.WriteFile(p, cfg, 0o600)
			if out, err := exec.Command(bin, "check", "-c", p).CombinedOutput(); err != nil {
				t.Fatalf("LAN multi %s auth=%v rejected:\n%s\n%s", typ, auth, out, cfg)
			}
			// TUN path
			topts := opts
			topts.RouteMode = RouteBypassCN
			tcfg, err := BuildTUNConfig(node, "info", topts)
			if err != nil {
				t.Fatalf("build tun %s: %v", typ, err)
			}
			tp := filepath.Join(dir, "lan-tun-"+typ+".json")
			os.WriteFile(tp, tcfg, 0o600)
			if out, err := exec.Command(bin, "check", "-c", tp).CombinedOutput(); err != nil {
				t.Fatalf("LAN tun %s auth=%v rejected:\n%s\n%s", typ, auth, out, tcfg)
			}
		}
	}
	t.Log("LAN inbound (mixed/socks/http, ±auth, multi+TUN) -> OK")
}

func TestRoutingModes(t *testing.T) {
	bin := singboxPath(t)
	dir := t.TempDir()
	geoDir, _ := filepath.Abs(filepath.Join("..", "..", "bin"))

	node, err := nodes.ParseLink(sampleLinks["vless-reality"])
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name string
		opts Options
	}{
		{"global", Options{RemoteDNS: true, RouteMode: RouteGlobal, GeoDir: geoDir}},
		{"bypass_cn", Options{RemoteDNS: true, RouteMode: RouteBypassCN, GeoDir: geoDir}},
		{"custom", Options{RemoteDNS: true, RouteMode: RouteCustom, GeoDir: geoDir, RouteRules: []RouteRule{
			{Type: "suffix", Value: "openai.com", Action: "proxy"},
			{Type: "suffix", Value: "cn", Action: "direct"},
			{Type: "keyword", Value: "doubleclick", Action: "block"},
			{Type: "ip", Value: "192.168.0.0/16", Action: "direct"},
		}}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			cfg, err := BuildConfig(node, 17890, "info", c.opts)
			if err != nil {
				t.Fatalf("build: %v", err)
			}
			path := filepath.Join(dir, c.name+".json")
			if err := os.WriteFile(path, cfg, 0o600); err != nil {
				t.Fatal(err)
			}
			if out, err := exec.Command(bin, "check", "-c", path).CombinedOutput(); err != nil {
				t.Fatalf("sing-box check rejected %s:\n%s\n%s", c.name, out, cfg)
			}
			t.Logf("%s -> OK", c.name)
		})
	}
}

func TestParseAndCheck(t *testing.T) {
	bin := singboxPath(t)
	dir := t.TempDir()

	for name, link := range sampleLinks {
		t.Run(name, func(t *testing.T) {
			node, err := nodes.ParseLink(link)
			if err != nil {
				t.Fatalf("parse: %v", err)
			}
			cfg, err := BuildConfig(node, 17890, "info", Options{RemoteDNS: true})
			if err != nil {
				t.Fatalf("build: %v", err)
			}
			path := filepath.Join(dir, name+".json")
			if err := os.WriteFile(path, cfg, 0o600); err != nil {
				t.Fatal(err)
			}
			out, err := exec.Command(bin, "check", "-c", path).CombinedOutput()
			if err != nil {
				t.Fatalf("sing-box check rejected %s config:\n%s\n--- config ---\n%s", name, out, cfg)
			}
			t.Logf("%s (%s) -> OK", name, node.Type)
		})
	}
}

// The commercial API is hosted domestically: its traffic must leave the tunnel
// before any other rule, including 全局 mode, or login/lease renewal would be
// routed through an overseas node.
func TestDirectDomainsBypassTunnelFirst(t *testing.T) {
	bin := singboxPath(t)
	node, err := nodes.Manual("socks", "Test", "1.2.3.4", 1080, "", "")
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := BuildConfig(node, 17890, "info", Options{
		RouteMode:     RouteGlobal,
		DirectDomains: []string{"proxysplit.example.cn"},
		ClashMode:     "global",
	})
	if err != nil {
		t.Fatal(err)
	}
	var parsed struct {
		Route struct {
			Rules []map[string]any `json:"rules"`
		} `json:"route"`
	}
	if err := json.Unmarshal(cfg, &parsed); err != nil {
		t.Fatal(err)
	}
	idx := -1
	for i, r := range parsed.Route.Rules {
		if out, _ := r["outbound"].(string); out == "direct" {
			if d, ok := r["domain"].([]any); ok && len(d) == 1 && d[0] == "proxysplit.example.cn" {
				idx = i
				break
			}
		}
	}
	if idx < 0 {
		t.Fatalf("API direct rule missing: %s", cfg)
	}
	// Only the mandatory sniff action may precede it.
	for i := 0; i < idx; i++ {
		if _, isSniff := parsed.Route.Rules[i]["action"]; !isSniff {
			t.Fatalf("rule %d precedes the API direct rule: %v", i, parsed.Route.Rules[i])
		}
	}
	p := filepath.Join(t.TempDir(), "direct.json")
	os.WriteFile(p, cfg, 0o600)
	if out, err := exec.Command(bin, "check", "-c", p).CombinedOutput(); err != nil {
		t.Fatalf("sing-box rejected the config: %s", out)
	}
}

// QUIC is blocked only for traffic that would enter the tunnel: 全局 lines and
// 代理策略 全局 block all of it, smart lines only outside the mainland sets, and
// 直连-exit lines / unlisted apps in 只代理列出的 not at all.
func TestQUICBlockedOnlyTowardsTunnel(t *testing.T) {
	bin := singboxPath(t)
	geoDir, _ := filepath.Abs(filepath.Join("..", "..", "bin"))
	node, _ := nodes.ParseLink(sampleLinks["vless-reality"])
	for _, whitelist := range []bool{true, false} {
		opts := Options{GeoDir: geoDir, ClashController: "127.0.0.1:19093", Split: true, SplitWhitelist: whitelist, BlockQUIC: true,
			SplitGroups: []SplitGroup{
				{Key: "rule|proxy|bypass_cn", Names: []string{"chrome.exe"}, Mode: RouteBypassCN, NodeTag: "proxy"},
				{Key: "global|proxy|global", Names: []string{"game.exe"}, Mode: RouteGlobal, NodeTag: "proxy"},
				{Key: "cn|direct|custom", Names: []string{"cn.exe"}, Mode: RouteCustom, NodeTag: "direct"},
			}}
		writeSplitSets(t, &opts)
		cfg, err := BuildTUNConfig(node, "info", opts)
		if err != nil {
			t.Fatal(err)
		}
		p := filepath.Join(t.TempDir(), "q.json")
		os.WriteFile(p, cfg, 0o600)
		if out, err := exec.Command(bin, "check", "-c", p).CombinedOutput(); err != nil {
			t.Fatalf("sing-box rejected the config:\n%s", out)
		}
		tags := splitGroupTags(opts)
		var quic []string
		for _, raw := range routeRulesFromConfig(t, cfg) {
			b, _ := json.Marshal(raw)
			if s := string(b); strings.Contains(s, `"port":[443]`) && strings.Contains(s, `"reject"`) {
				quic = append(quic, s)
			}
		}
		has := func(sub ...string) bool {
			for _, q := range quic {
				ok := true
				for _, x := range sub {
					ok = ok && strings.Contains(q, x)
				}
				if ok {
					return true
				}
			}
			return false
		}
		if !has(tags[0], `"invert":true`) {
			t.Errorf("whitelist=%v: smart line must block QUIC only outside the mainland: %v", whitelist, quic)
		}
		if !has(tags[1]) || has(tags[1], `"invert":true`) {
			t.Errorf("whitelist=%v: 全局 line must block all QUIC: %v", whitelist, quic)
		}
		if has(tags[2]) {
			t.Errorf("whitelist=%v: a 直连-exit line must keep QUIC: %v", whitelist, quic)
		}
		if !has(`"clash_mode":"global"`) {
			t.Errorf("whitelist=%v: 代理策略 全局 must block QUIC: %v", whitelist, quic)
		}
		unscoped := false
		for _, q := range quic {
			if !strings.Contains(q, "rule_set\":[\"apps-") && !strings.Contains(q, "clash_mode") && !strings.Contains(q, "apps-g-") {
				unscoped = true
			}
		}
		if whitelist == unscoped {
			t.Errorf("whitelist=%v: unlisted traffic QUIC rule present=%v: %v", whitelist, unscoped, quic)
		}
	}
}

// relayops patch 0005: a full config with a POWER云 Reality outbound carrying
// relayops_hybrid must pass `sing-box check` on the bundled core (relayops.9+).
func TestRealityHybridAcceptedByBundledCore(t *testing.T) {
	bin := singboxPath(t)
	out, err := exec.Command(bin, "version").Output()
	if err != nil || !strings.Contains(string(out), "relayops_reality_hybrid") {
		t.Skip("bundled core has no relayops_reality_hybrid tag")
	}
	n := &nodes.Node{ID: "pv", Name: "POWER云", Type: "vless", Official: true, EntryTag: "A", Outbounds: []json.RawMessage{
		json.RawMessage(`{"tag":"A","type":"vless","server":"203.0.113.9","server_port":443,"uuid":"11111111-2222-4333-8444-555555555555","tls":{"enabled":true,"server_name":"twpro.example.com","utls":{"enabled":true,"fingerprint":"chrome"},"reality":{"enabled":true,"public_key":"ZlkFXvRB7hoekcZZuBoNYi4hjUJk_XiaQE_F5DrYWio","short_id":"5aa8be0990d5ece8"}},"multiplex":{"enabled":true,"protocol":"h2mux","padding":true}}`)}}
	cfg, err := BuildConfig(n, 17890, "info", Options{RealityHybrid: true})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(cfg), `"relayops_hybrid"`) {
		t.Fatalf("hybrid field missing: %s", cfg)
	}
	p := filepath.Join(t.TempDir(), "hybrid.json")
	os.WriteFile(p, cfg, 0o600)
	if out, err := exec.Command(bin, "check", "-c", p).CombinedOutput(); err != nil {
		t.Fatalf("bundled core rejected relayops_hybrid: %s", out)
	}
}

func TestProcessSetDirEntries(t *testing.T) {
	var got struct {
		Rules []map[string][]string `json:"rules"`
	}
	if err := json.Unmarshal(processSet([]string{"chrome.exe", `dir:C:\Program Files\ldplayer9box\`}), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Rules) != 2 || got.Rules[0]["process_name"][0] != "chrome.exe" {
		t.Fatalf("rules = %+v", got.Rules)
	}
	re := regexp.MustCompile(got.Rules[1]["process_path_regex"][0])
	if !re.MatchString(`C:\PROGRAM FILES\ldplayer9box\VBoxNetNAT.exe`) || re.MatchString(`C:\Program Files\ldplayer9boxX\a.exe`) {
		t.Fatalf("regex %s", re)
	}
}
