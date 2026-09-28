package core

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"proxysplit/internal/nodes"
)

// Claude Code 加速的本机入口：只听回环、排在所有规则前面（本进程会被 SelfProcess 送直连）、
// 代理策略「直连」时仍然直连；真实 sing-box check 必须通过。
func TestAccelInboundRoutesToClaudeLine(t *testing.T) {
	bin := singboxPath(t)
	geoDir, _ := filepath.Abs(filepath.Join("..", "..", "bin"))
	node, err := nodes.ParseLink(sampleLinks["vless-reality"])
	if err != nil {
		t.Fatal(err)
	}
	extra, _ := nodes.ParseLink(sampleLinks["hysteria2"])
	opts := Options{GeoDir: geoDir, Split: true, SplitWhitelist: true, RuleDir: t.TempDir(),
		ClashController: "127.0.0.1:19090", ClashSecret: "s", ClashMode: "rule", SelfProcess: "proxysplit.exe",
		SplitGroups: []SplitGroup{{Key: "k", Names: []string{"claude.exe"}, Mode: RouteGlobal, NodeTag: "node-x"}},
		ExtraNodes:  []ExtraNode{{Tag: "node-x", Node: extra}},
		AccelPort:   18766, AccelOutbound: "node-x"}
	if err := writeRuleSets(opts); err != nil {
		t.Fatal(err)
	}
	raw, err := BuildTUNConfig(node, "info", opts)
	if err != nil {
		t.Fatal(err)
	}
	var cfg struct {
		Inbounds []map[string]any `json:"inbounds"`
		Route    struct {
			Rules []map[string]any `json:"rules"`
		} `json:"route"`
	}
	json.Unmarshal(raw, &cfg)
	var in map[string]any
	for _, i := range cfg.Inbounds {
		if i["tag"] == "accel-in" {
			in = i
		}
	}
	if in == nil || in["listen"] != "127.0.0.1" || in["type"] != "mixed" {
		t.Fatalf("应有只听回环的 accel-in 入口：%v", cfg.Inbounds)
	}
	r2, r3 := cfg.Route.Rules[2], cfg.Route.Rules[3]
	if r2["clash_mode"] != "direct" || r2["outbound"] != "direct" || r3["outbound"] != "node-x" {
		t.Fatalf("加速入口规则应紧跟 sniff/dns，且直连模式优先：%v %v", r2, r3)
	}
	p := filepath.Join(t.TempDir(), "accel.json")
	os.WriteFile(p, raw, 0o600)
	if out, err := exec.Command(bin, "check", "-c", p).CombinedOutput(); err != nil {
		t.Fatalf("sing-box check 拒绝：%s", out)
	}
	opts.AccelPort = 0
	raw, _ = BuildTUNConfig(node, "info", opts)
	json.Unmarshal(raw, &cfg)
	for _, i := range cfg.Inbounds {
		if i["tag"] == "accel-in" {
			t.Fatal("功能关闭时不应有入口")
		}
	}
}
