package core

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"proxysplit/internal/nodes"
)

// An "自动选择" node becomes a urltest group over its members ("proxy/m<i>"),
// members keep their 前置代理 detour, and sing-box accepts the config.
func TestURLTestGroupConfig(t *testing.T) {
	a, _ := nodes.ParseLink(sampleLinks["vless-reality"])
	b, _ := nodes.ParseLink(sampleLinks["trojan"])
	chained := &nodes.Node{ID: "s1", Name: "socks", Type: "socks", Server: "198.51.100.7", Port: 8022, ViaNode: a}
	auto := &nodes.Node{ID: "auto", Name: "自动选择（最快）", Type: nodes.TypeURLTest, Members: []*nodes.Node{a, b, chained}}
	cfg, err := BuildConfig(auto, 17890, "error", Options{})
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Outbounds []map[string]any `json:"outbounds"`
	}
	_ = json.Unmarshal(cfg, &doc)
	tags := map[string]map[string]any{}
	for _, ob := range doc.Outbounds {
		tags[ob["tag"].(string)] = ob
	}
	g := tags["node-auto"]
	if g == nil || g["type"] != "urltest" || len(g["outbounds"].([]any)) != 3 {
		t.Fatalf("group = %v", g)
	}
	if tags["node-auto/m0"] == nil || tags["node-auto/m1"] == nil || tags["node-auto/m2"]["detour"] != "node-auto/m2~via" || tags["node-auto/m2~via"] == nil {
		t.Fatalf("members missing: %v", tags)
	}
	bin := singboxPath(t)
	if _, err := os.Stat(bin); err != nil {
		t.Skip("no bundled core")
	}
	p := filepath.Join(t.TempDir(), "auto.json")
	_ = os.WriteFile(p, cfg, 0o600)
	if out, err := exec.Command(bin, "check", "-c", p).CombinedOutput(); err != nil {
		t.Fatalf("sing-box rejected urltest group: %s", out)
	}
}

func TestURLTestGroupNeedsMembers(t *testing.T) {
	off, _ := nodes.ParseLink(sampleLinks["trojan"])
	off.Official = true
	auto := &nodes.Node{ID: "auto", Type: nodes.TypeURLTest, Members: []*nodes.Node{off}}
	if _, err := BuildConfig(auto, 17890, "error", Options{}); !errors.Is(err, errNoAutoMembers) {
		t.Fatalf("err = %v", err)
	}
}
