package core

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"proxysplit/internal/capture"
	"proxysplit/internal/nodes"
)

func processOpts(t *testing.T, whitelist bool) Options {
	geoDir, _ := filepath.Abs(filepath.Join("..", "..", "bin"))
	opts := Options{
		GeoDir: geoDir, Split: true, SplitWhitelist: whitelist, BlockQUIC: true,
		ClashController: "127.0.0.1:19095", SelfProcess: "proxysplit.exe", PortProcessPath: `C:\x\sing-box.exe`,
		SplitGroups: []SplitGroup{
			{Key: "rule|proxy|bypass_cn", Names: []string{"chrome.exe", "dir:D:\\Games"}, Mode: RouteBypassCN, NodeTag: "proxy"},
			{Key: "global|proxy|global", Names: []string{"telegram.exe"}, Mode: RouteGlobal, NodeTag: "proxy"},
		},
		SplitDirect: []string{"直播伴侣.exe", "code.exe"},
		SplitBlock:  []string{"bad.exe"},
		SplitScoped: []ScopedRule{{Name: "code.exe", Domains: []string{"github.com"}, Outbound: "proxy"}},
	}
	ports := map[string]int{}
	for i, tag := range ProcessInbounds(opts) {
		ports[tag] = 30000 + i
	}
	opts.Process = &ProcessCapture{Ports: ports}
	return opts
}

func TestProcessConfigReplacesTUNAndProcessRules(t *testing.T) {
	node, err := nodes.ParseLink(sampleLinks["vless-reality"])
	if err != nil {
		t.Fatal(err)
	}
	for _, whitelist := range []bool{true, false} {
		opts := processOpts(t, whitelist)
		cfg, err := BuildProcessConfig(node, "info", opts)
		if err != nil {
			t.Fatal(err)
		}
		s := string(cfg)
		for _, banned := range []string{`"tun"`, "process_name", "process_path", "\"" + appSetDirect, "\"" + appSetBlock, "\"apps-g-"} {
			if strings.Contains(s, banned) {
				t.Errorf("whitelist=%v: process config still contains %s", whitelist, banned)
			}
		}
		var doc struct {
			Inbounds []map[string]any `json:"inbounds"`
		}
		_ = json.Unmarshal(cfg, &doc)
		mixed := 0
		for _, in := range doc.Inbounds {
			if in["type"] == "mixed" && in["listen"] == "127.0.0.1" {
				mixed++
			}
		}
		// 2 groups + 1 per-target app (+ default line in 默认全走代理)
		want := 3
		if !whitelist {
			want = 4
		}
		if mixed != want || len(ProcessInbounds(opts)) != want {
			t.Errorf("whitelist=%v: %d mixed inbounds, want %d", whitelist, mixed, want)
		}
		code := processScopedInbound("code.exe")
		if !strings.Contains(s, code) || !strings.Contains(s, processGroupInbound(splitGroupTags(opts)[0])) {
			t.Errorf("rules must reference the group / per-target inbounds")
		}
		if bin, err := filepath.Abs(filepath.Join("..", "..", "bin", "sing-box.exe")); err == nil {
			if _, err := os.Stat(bin); err == nil {
				p := filepath.Join(t.TempDir(), "proc.json")
				_ = os.WriteFile(p, cfg, 0o600)
				if out, err := exec.Command(bin, "check", "-c", p).CombinedOutput(); err != nil {
					t.Fatalf("sing-box check rejected process config:\n%s\n%s", out, cfg)
				}
			}
		}
	}
}

func TestProcessRewriteKeepsRuleOrder(t *testing.T) {
	opts := processOpts(t, true)
	rw := newProcessRewrite(opts)
	if _, ok := rw.rule(M{"rule_set": []string{appSetBlock}, "action": "reject"}); ok {
		t.Error("拦截 rule-set rule must be dropped (blocked apps never reach the core)")
	}
	if _, ok := rw.rule(M{"process_name": []string{"proxysplit.exe"}, "outbound": "direct"}); ok {
		t.Error("self rule must be dropped (we are never captured)")
	}
	r, ok := rw.rule(M{"rule_set": []string{appSetDirect}, "outbound": "direct"})
	if !ok || r["inbound"].([]string)[0] != processScopedInbound("code.exe") {
		t.Errorf("direct rule must cover the per-target app inbound: %v", r)
	}
	tag := splitGroupTags(opts)[0]
	logical := inSet([]string{tag}, M{"network": []string{"udp"}})
	r, ok = rw.rule(emit(logical, "reject"))
	if !ok || !strings.Contains(mustJSON(r), processGroupInbound(tag)) || strings.Contains(mustJSON(r), "rule_set") {
		t.Errorf("logical group rule not rewritten: %v", r)
	}
	if r, ok := rw.rule(M{"rule_set": []string{"geosite-cn"}, "outbound": "direct"}); !ok || r["inbound"] != nil {
		t.Error("geo rules must be untouched")
	}
}

func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }

func TestProcessRoutes(t *testing.T) {
	opts := processOpts(t, true)
	r := ProcessRoutes(opts)
	ports := opts.Process.Ports
	group := ports[processGroupInbound(splitGroupTags(opts)[0])]
	cases := map[string]capture.Verdict{
		`C:\bad.exe`:       {Action: capture.Drop},
		`C:\chrome.exe`:    {Action: capture.Proxy, Port: group},
		`D:\Games\x\a.exe`: {Action: capture.Proxy, Port: group},
		`C:\code.exe`:      {Action: capture.Proxy, Port: ports[processScopedInbound("code.exe")]},
		`C:\直播伴侣.exe`:      {},
		`C:\unlisted.exe`:  {},
	}
	for path, want := range cases {
		if got := r.Decide(path); got != want {
			t.Errorf("%s: got %+v want %+v", path, got, want)
		}
	}
	black := processOpts(t, false)
	if got := ProcessRoutes(black).Decide(`C:\unlisted.exe`); got.Action != capture.Proxy || got.Port != black.Process.Ports[processDefaultInbound] {
		t.Errorf("默认全走代理: unlisted must use the default inbound, got %+v", got)
	}
}
