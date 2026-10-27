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

// A socks node reached through a vless front node: the entry outbound dials
// via "<tag>~via", the front outbound exists, and sing-box accepts it.
func TestChainedNodeDetour(t *testing.T) {
	front, err := nodes.ParseLink(sampleLinks["vless-reality"])
	if err != nil {
		t.Fatal(err)
	}
	n := &nodes.Node{ID: "s1", Name: "客户 socks", Type: "socks", Server: "198.51.100.7", Port: 8022, Username: "u", Password: "p", Via: front.ID, ViaNode: front}
	cfg, err := BuildConfig(n, 17890, "error", Options{})
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Outbounds []map[string]any `json:"outbounds"`
	}
	_ = json.Unmarshal(cfg, &doc)
	var entry, via map[string]any
	for _, ob := range doc.Outbounds {
		if ob["type"] == "socks" {
			entry = ob
		}
		if tag, _ := ob["tag"].(string); strings.HasSuffix(tag, "~via") {
			via = ob
		}
	}
	if entry == nil || via == nil || entry["detour"] != via["tag"] || via["type"] != "vless" {
		t.Fatalf("entry=%v via=%v", entry, via)
	}
	bin := singboxPath(t)
	p := filepath.Join(t.TempDir(), "chain.json")
	_ = os.WriteFile(p, cfg, 0o600)
	if out, err := exec.Command(bin, "check", "-c", p).CombinedOutput(); err != nil {
		t.Fatalf("sing-box rejected chain: %s", out)
	}
}

func TestChainRejectsOfficialFront(t *testing.T) {
	front, _ := nodes.ParseLink(sampleLinks["vless-reality"])
	front.Official = true
	n := &nodes.Node{ID: "s1", Name: "x", Type: "socks", Server: "198.51.100.7", Port: 8022, ViaNode: front}
	if _, err := BuildConfig(n, 17890, "error", Options{}); err == nil {
		t.Fatal("official line must not be a front node")
	}
}
