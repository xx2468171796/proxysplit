package service

import (
	"testing"

	"proxysplit/internal/engine"
)

// TestPersistenceRoundTrip proves the 傻瓜化 flow survives a restart: add a node
// (auto-selected as active) + an app rule, then reopen a fresh Service pointed at
// the same data dir and confirm everything is still there.
func TestPersistenceRoundTrip(t *testing.T) {
	dir := t.TempDir()

	s1, err := New(dir, dir)
	if err != nil {
		t.Fatal(err)
	}
	// Step 1: add a node.
	if msg := s1.AddManualNode("socks", "测试节点", "1.2.3.4", 1080, "user", "pass"); msg != "" {
		t.Fatalf("add node: %s", msg)
	}
	// Adding the first node must auto-select it as active.
	if s1.cfg.SelectedID == "" {
		t.Fatal("first node was not auto-selected as active")
	}
	// Step 2: add an app rule (走代理).
	s1.SetAppRules([]AppRule{{Match: "Code.exe", Path: `C:\x\Code.exe`, Line: LineRule, Enabled: true}})

	// Step 3: simulate closing + reopening the app.
	s2, err := New(dir, dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := len(s2.Nodes()); got != 1 {
		t.Fatalf("nodes not persisted: got %d want 1", got)
	}
	if s2.cfg.SelectedID == "" {
		t.Fatal("active-node selection not persisted")
	}
	rules := s2.GetAppRules()
	if len(rules) != 1 || rules[0].Match != "Code.exe" || rules[0].Line != LineRule {
		t.Fatalf("app rule not persisted: %+v", rules)
	}
	if s2.cfg.RuleMode != engine.ModeBlacklist {
		t.Fatalf("rule mode default not persisted: %q", s2.cfg.RuleMode)
	}
	t.Log("restart round-trip OK: node + auto-selection + rule + mode all persisted")
}
