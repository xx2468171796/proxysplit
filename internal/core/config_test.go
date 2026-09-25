package core

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
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
	cfg, err := BuildTUNConfig(node, "info", Options{
		Split:          true,
		SplitWhitelist: true,
		SplitGroups: []SplitGroup{{
			Names:   []string{"CustomApp.exe"},
			Mode:    RouteCustom,
			NodeTag: "proxy",
			Rules: []RouteRule{
				{Type: "suffix", Value: "example.cn", Action: "direct"},
				{Type: "keyword", Value: "tracker", Action: "block"},
			},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	direct, block, catchAll := false, false, false
	for _, raw := range routeRulesFromConfig(t, cfg) {
		rule := raw.(map[string]interface{})
		processes, ok := rule["process_name"].([]interface{})
		if !ok || len(processes) != 1 || processes[0] != "CustomApp.exe" {
			continue
		}
		if suffixes, ok := rule["domain_suffix"].([]interface{}); ok && len(suffixes) == 1 && suffixes[0] == "example.cn" && rule["outbound"] == "direct" {
			direct = true
		}
		if keywords, ok := rule["domain_keyword"].([]interface{}); ok && len(keywords) == 1 && keywords[0] == "tracker" && rule["action"] == "reject" {
			block = true
		}
		if len(rule) == 2 && rule["outbound"] == "proxy" {
			catchAll = true
		}
	}
	if !direct || !block || !catchAll {
		t.Fatalf("custom split group incomplete: direct=%v block=%v catchAll=%v\n%s", direct, block, catchAll, cfg)
	}
}

// TestCustomRulesStayInsideWhitelist: a global custom 代理 rule must not pull an
// unlisted/removed app into the tunnel, must follow each app's own node, must yield
// to explicit per-app 直连 and to the 直连/全局 代理策略, and the own-API direct rule
// must exist in TUN mode too.
func TestCustomRulesStayInsideWhitelist(t *testing.T) {
	bin := singboxPath(t)
	geoDir, _ := filepath.Abs(filepath.Join("..", "..", "bin"))
	node, err := nodes.ParseLink(sampleLinks["vless-reality"])
	if err != nil {
		t.Fatal(err)
	}
	extra, err := nodes.ParseLink(sampleLinks["trojan"])
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := BuildTUNConfig(node, "info", Options{
		GeoDir:          geoDir,
		ClashController: "127.0.0.1:19092",
		DirectDomains:   []string{"proxysplit.example.cn"},
		Split:           true,
		SplitWhitelist:  true,
		SplitGroups: []SplitGroup{
			{Names: []string{"chrome.exe"}, Mode: RouteGlobal, NodeTag: "proxy"},
			{Names: []string{"game.exe"}, Mode: RouteBypassCN, NodeTag: "node-x"},
		},
		SplitDirect: []string{"code.exe"},
		ExtraNodes:  []ExtraNode{{Tag: "node-x", Node: extra}},
		CustomRules: []RouteRule{
			{Type: "suffix", Value: "github.com", Action: "proxy"},
			{Type: "suffix", Value: "example.cn", Action: "direct"},
			{Type: "keyword", Value: "doubleclick", Action: "block"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(t.TempDir(), "custom-whitelist.json")
	os.WriteFile(p, cfg, 0o600)
	if out, err := exec.Command(bin, "check", "-c", p).CombinedOutput(); err != nil {
		t.Fatalf("sing-box rejected the config:\n%s\n%s", out, cfg)
	}

	apiIdx, codeDirectIdx, firstCustomIdx := -1, -1, -1
	github := map[string]string{} // process -> outbound
	for i, raw := range routeRulesFromConfig(t, cfg) {
		rule := raw.(map[string]interface{})
		if d, ok := rule["domain"].([]interface{}); ok && len(d) == 1 && d[0] == "proxysplit.example.cn" && rule["outbound"] == "direct" {
			apiIdx = i
		}
		procs, _ := rule["process_name"].([]interface{})
		if len(procs) == 1 && procs[0] == "code.exe" && rule["outbound"] == "direct" && len(rule) == 2 {
			codeDirectIdx = i
		}
		isCustom := false
		if s, ok := rule["domain_suffix"].([]interface{}); ok && len(s) == 1 && (s[0] == "github.com" || s[0] == "example.cn") {
			isCustom = true
		}
		if k, ok := rule["domain_keyword"].([]interface{}); ok && len(k) == 1 && k[0] == "doubleclick" {
			isCustom = true
		}
		if !isCustom {
			continue
		}
		if firstCustomIdx < 0 {
			firstCustomIdx = i
		}
		if rule["clash_mode"] != "rule" {
			t.Errorf("custom rule not limited to 规则 mode: %v", rule)
		}
		if s, _ := rule["domain_suffix"].([]interface{}); len(s) == 1 && s[0] == "github.com" {
			if len(procs) != 1 {
				t.Fatalf("custom proxy rule not scoped to one listed app group: %v", rule)
			}
			github[procs[0].(string)] = rule["outbound"].(string)
		}
	}
	if apiIdx < 0 || apiIdx > 3 {
		t.Fatalf("own-API direct rule missing or not near the top (idx %d):\n%s", apiIdx, cfg)
	}
	if codeDirectIdx < 0 || firstCustomIdx < 0 || codeDirectIdx > firstCustomIdx {
		t.Fatalf("per-app 直连 (idx %d) must precede custom rules (idx %d)", codeDirectIdx, firstCustomIdx)
	}
	if len(github) != 2 || github["chrome.exe"] != "proxy" || github["game.exe"] != "node-x" {
		t.Fatalf("custom proxy rule should reach exactly the listed apps via their own node, got %v", github)
	}
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
