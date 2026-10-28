package service

import (
	"testing"

	"proxysplit/internal/core"
	"proxysplit/internal/nodes"
)

// buildSplit returns the app-split core config and rule-sets the service would
// generate for the given app rules.
func buildSplit(t *testing.T, s *Service, node *nodes.Node, rules []AppRule) (string, map[string][]byte, splitSummary) {
	t.Helper()
	s.mu.Lock()
	s.cfg.Rules = rules
	opts := core.Options{Split: true, SplitWhitelist: true, RuleDir: "rules", ClashController: "127.0.0.1:1"}
	sum := s.splitOptionsLocked(&opts, node)
	s.mu.Unlock()
	cfg, err := core.BuildTUNConfig(node, "info", opts)
	if err != nil {
		t.Fatal(err)
	}
	return string(cfg), core.SplitRuleSets(opts), sum
}

// Adding, removing, disabling or moving an app between 规则 / 全局 / 直连 / 拦截
// on the active node must leave the core config byte-identical, so the change is
// applied by rewriting rule-set files only (no restart).
func TestAppListChangesKeepConfigStructure(t *testing.T) {
	dir := t.TempDir()
	s, err := New(dir, dir)
	if err != nil {
		t.Fatal(err)
	}
	node, err := nodes.ParseLink("vless://11111111-2222-3333-4444-555555555555@example.com:443?encryption=none&security=reality&sni=www.microsoft.com&fp=chrome&pbk=jNXHt1yRo0vDuchQlIP6Z0ZvjT3KtzVI-T4E7RoLJS0&sid=0123abcd&type=tcp&flow=xtls-rprx-vision#N")
	if err != nil {
		t.Fatal(err)
	}
	chrome := AppRule{Match: "chrome.exe", Line: LineRule, Enabled: true} // bare names: same on every OS
	variants := [][]AppRule{
		nil,
		{chrome},
		{{Match: chrome.Match, Line: LineGlobal, Enabled: true}},
		{{Match: chrome.Match, Line: LineDirect, Enabled: true}},
		{{Match: chrome.Match, Line: LineBlock, Enabled: true}},
		{{Match: chrome.Match, Line: LineRule, Enabled: false}},
		{chrome, {Match: "Code.exe", Line: LineGlobal, Enabled: true}},
	}
	base, _, _ := buildSplit(t, s, node, variants[0])
	seen := map[string]bool{}
	for i, rules := range variants {
		cfg, sets, sum := buildSplit(t, s, node, rules)
		if cfg != base {
			t.Fatalf("variant %d changed the core config; app list changes would need a restart", i)
		}
		seen[string(sets["apps-direct"])+string(sets["apps-block"])+sum.targets["chrome.exe"]] = true
	}
	if len(seen) < 5 {
		t.Fatalf("rule-sets / targets did not change between variants (%d distinct)", len(seen))
	}
	_, _, before := buildSplit(t, s, node, variants[1])
	_, _, after := buildSplit(t, s, node, variants[3])
	if ch := changedApps(before.targets, after.targets); !ch["chrome.exe"] || len(ch) != 1 {
		t.Fatalf("changedApps = %v, want only chrome.exe", ch)
	}
}
