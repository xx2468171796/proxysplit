package service

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"proxysplit/internal/core"
	"proxysplit/internal/engine"
	"proxysplit/internal/nodes"
)

// TestConfigSurvivesCoreStart is the regression test for the data-loss bug: the
// core used to write its sing-box config to config.json, clobbering the app's
// nodes/rules. Here we add a node, start the core (which writes its config),
// then confirm config.json is untouched and a reopened Service still has the node.
func TestConfigSurvivesCoreStart(t *testing.T) {
	bin, _ := filepath.Abs(filepath.Join("..", "..", "bin"))
	if _, err := os.Stat(filepath.Join(bin, "sing-box.exe")); err != nil {
		t.Skip("sing-box.exe not present")
	}
	dataDir := t.TempDir()

	s1, err := New(bin, dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if msg := s1.AddManualNode("socks", "N", "1.2.3.4", 1080, "", ""); msg != "" {
		t.Fatalf("add node: %s", msg)
	}
	s1.SetAppRules([]AppRule{{Match: "x.exe", Path: "x.exe", Line: LineGlobal, Enabled: true}})
	node := s1.Nodes()[0]

	// Start the core the way the running app does — it writes its own config.
	port, _ := core.FreePort()
	if err := s1.core.StartLines([]core.LineConfig{{Key: "L", InboundPort: port, Node: node, RouteMode: core.RouteGlobal}}, "info", core.Options{GeoDir: bin}); err != nil {
		t.Fatalf("core start: %v", err)
	}
	time.Sleep(400 * time.Millisecond)
	s1.core.Stop()

	// config.json must STILL be the app config, not the core's sing-box config.
	cfg, _ := os.ReadFile(filepath.Join(dataDir, "config.json"))
	if isCoreConfig(cfg) {
		t.Fatal("REGRESSION: core clobbered config.json with its sing-box config")
	}
	if _, err := os.Stat(filepath.Join(dataDir, "sing-box.json")); err != nil {
		t.Fatal("core did not write sing-box.json")
	}

	// Reopen: node + rule must survive.
	s2, err := New(bin, dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(s2.Nodes()) != 1 || len(s2.GetAppRules()) != 1 {
		t.Fatalf("data lost after core start: nodes=%d rules=%d", len(s2.Nodes()), len(s2.GetAppRules()))
	}
	t.Log("config survives core start — no clobber")
}

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

func TestLoadDropsPrototypePlaceholderNodes(t *testing.T) {
	dir := t.TempDir()
	seed := `{
  "nodes": [
    {"id":"preview-jp","name":"JP | Tokyo - 01","type":"vless","server":"jp01.example.net","port":443},
    {"id":"real","name":"我的节点","type":"socks","server":"10.20.30.40","port":1080}
  ],
  "selectedId":"preview-jp"
}`
	if err := os.WriteFile(filepath.Join(dir, "config.json"), []byte(seed), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := New(dir, dir)
	if err != nil {
		t.Fatal(err)
	}
	got := s.Nodes()
	if len(got) != 1 || got[0].ID != "real" {
		t.Fatalf("placeholder node leaked into runtime config: %+v", got)
	}
	if s.cfg.SelectedID != "real" {
		t.Fatalf("selected node not repaired after placeholder removal: %q", s.cfg.SelectedID)
	}
	// The cleanup must be persistent, otherwise the fake node would return on
	// every restart after a user upgraded from a prototype build.
	s2, err := New(dir, dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := s2.Nodes(); len(got) != 1 || got[0].ID != "real" {
		t.Fatalf("placeholder node returned after reopen: %+v", got)
	}
}

func TestLoadFallsBackWhenMainConfigHasWrongFieldTypes(t *testing.T) {
	dir := t.TempDir()
	backup := Config{LogLevel: "debug", Nodes: []*nodes.Node{{ID: "kept", Name: "Kept", Type: "socks5", Server: "127.0.0.1", Port: 1080}}, SelectedID: "kept"}
	raw, err := json.Marshal(backup)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "config.json.bak"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	// Syntactically valid JSON used to be partially decoded and then persisted,
	// even though the nodes field has an incompatible type.
	if err := os.WriteFile(filepath.Join(dir, "config.json"), []byte(`{"logLevel":"info","nodes":"not-an-array"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := New(t.TempDir(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := s.Nodes(); len(got) != 1 || got[0].ID != "kept" {
		t.Fatalf("backup not restored: %+v", got)
	}
}
