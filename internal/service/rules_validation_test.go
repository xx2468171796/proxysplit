package service

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"proxysplit/internal/core"
	"proxysplit/internal/nodes"
)

func TestRuleSetTogglePersists(t *testing.T) {
	dir := t.TempDir()
	s, err := New(dir, dir)
	if err != nil {
		t.Fatal(err)
	}
	sets := s.GetRuleSets()
	if len(sets) != len(ruleSetFiles) {
		t.Fatalf("got %d rule sets, want %d", len(sets), len(ruleSetFiles))
	}
	for _, set := range sets {
		if !set.Enabled {
			t.Fatalf("legacy/default config should enable %s", set.Name)
		}
	}
	if msg := s.SetRuleSetEnabled("geoip-cn.srs", false); msg != "" {
		t.Fatal(msg)
	}
	if msg := s.SetRuleSetEnabled("unknown.srs", false); msg == "" {
		t.Fatal("unknown rule set was accepted")
	}

	reopened, err := New(dir, dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, set := range reopened.GetRuleSets() {
		if set.Name == "geoip-cn.srs" && set.Enabled {
			t.Fatal("disabled rule set did not persist")
		}
	}
}

func TestRuleUpdatesAreValidatedAtomically(t *testing.T) {
	dir := t.TempDir()
	s, err := New(dir, dir)
	if err != nil {
		t.Fatal(err)
	}
	if msg := s.AddManualNode("socks", "测试节点", "127.0.0.1", 1080, "", ""); msg != "" {
		t.Fatal(msg)
	}
	nodes := s.Nodes()
	if len(nodes) != 1 {
		t.Fatalf("manual node missing: %+v", nodes)
	}
	line := Line{
		ID:   "work-line",
		Name: "工作线路",
		Node: nodes[0].ID,
		Routing: Routing{Mode: core.RouteCustom, Rules: []core.RouteRule{
			{Type: "suffix", Value: "*.Example.COM", Action: "DIRECT"},
			{Type: "ip", Value: "10.0.0.7/24", Action: "proxy"},
		}},
	}
	if msg := s.SetLines([]Line{line}); msg != "" {
		t.Fatal(msg)
	}
	stored := s.GetLines()
	custom := lineByID(stored, line.ID)
	if custom == nil || len(custom.Routing.Rules) != 2 || custom.Routing.Rules[0].Value != "example.com" || custom.Routing.Rules[1].Value != "10.0.0.0/24" {
		t.Fatalf("custom line rules were not normalized: %+v", custom)
	}

	valid := []AppRule{{Match: "Code.exe", Path: `C:\Apps\Code.exe`, Line: line.ID, Node: "stale-app-override", Enabled: true}}
	if msg := s.SetAppRules(valid); msg != "" {
		t.Fatal(msg)
	}
	if got := s.GetAppRules(); len(got) != 1 || got[0].Node != "" {
		t.Fatalf("custom-line node override was not cleared: %+v", got)
	}
	invalid := []AppRule{{Match: "Chrome.exe", Line: "missing-line", Enabled: true}}
	if msg := s.SetAppRules(invalid); msg == "" {
		t.Fatal("dangling line reference was accepted")
	}
	if got := s.GetAppRules(); len(got) != 1 || got[0].Match != "Code.exe" {
		t.Fatalf("invalid atomic update replaced good rules: %+v", got)
	}

	if msg := s.SetLines(nil); msg != "" {
		t.Fatal(msg)
	}
	got := s.GetAppRules()
	if len(got) != 1 || got[0].Line != LineRule {
		t.Fatalf("deleted line left a dangling app mapping: %+v", got)
	}
}

func TestLoadHealsDanglingNodeReferences(t *testing.T) {
	dir := t.TempDir()
	cfg := Config{
		Nodes:      []*nodes.Node{{ID: "node-live", Name: "live", Type: "socks", Server: "127.0.0.1", Port: 1080}},
		SelectedID: "node-gone",
		Rules: []AppRule{{
			Match: "chrome.exe", Path: `C:\Chrome\chrome.exe`, Line: LineRule, Node: "node-gone", Enabled: true,
		}},
		Lines: []Line{{
			ID: "custom", Name: "custom", Node: "node-gone", Routing: Routing{Mode: core.RouteGlobal},
		}},
		RuleMode:    "whitelist",
		DefaultLine: LineRule,
		Settings:    defaultSettings(),
	}
	raw, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "config.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := New(dir, dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := s.Status().SelectedID; got != "node-live" {
		t.Fatalf("selected node was not healed: %q", got)
	}
	if got := s.GetAppRules(); len(got) != 1 || got[0].Node != "" {
		t.Fatalf("stale app override was not healed: %+v", got)
	}
	if line := lineByID(s.GetLines(), "custom"); line == nil || line.Node != "active" {
		t.Fatalf("stale custom line was not healed: %+v", line)
	}
}

func TestReconcileSubscriptionNodesPreservesLogicalIdentity(t *testing.T) {
	old := []*nodes.Node{
		{ID: "old-exact", Name: "JP-1", Type: "vmess", Server: "old.example", Port: 443, UUID: "u1", Latency: 88, Speed: 3.2},
		{ID: "old-moved", Name: "JP-2", Type: "vmess", Server: "old.example", Port: 444, UUID: "u2", Latency: 99, Speed: 4.2},
	}
	fresh := []*nodes.Node{
		{ID: "fresh-exact", Name: "JP-1", Type: "vmess", Server: "old.example", Port: 443, UUID: "u1"},
		{ID: "fresh-moved", Name: "JP-2", Type: "vmess", Server: "new.example", Port: 8443, UUID: "u2"},
	}
	reconcileSubscriptionNodes(old, fresh)
	if fresh[0].ID != "old-exact" || fresh[0].Latency != 88 || fresh[0].Speed != 3.2 {
		t.Fatalf("exact endpoint identity/measurements not preserved: %+v", fresh[0])
	}
	if fresh[1].ID != "old-moved" {
		t.Fatalf("logical node identity not preserved: %+v", fresh[1])
	}
	if fresh[1].Latency != 0 || fresh[1].Speed != 0 {
		t.Fatalf("changed endpoint retained stale measurements: %+v", fresh[1])
	}
}

func TestCustomRuleValidationRejectsMalformedPayload(t *testing.T) {
	s, err := New(t.TempDir(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if msg := s.SetCustomRules([]core.RouteRule{{Type: "suffix", Value: "*.OpenAI.COM", Action: "proxy"}}); msg != "" {
		t.Fatal(msg)
	}
	if msg := s.SetCustomRules([]core.RouteRule{{Type: "ip", Value: "999.1.1.1", Action: "direct"}}); msg == "" {
		t.Fatal("malformed IP rule was accepted")
	}
	got := s.GetCustomRules()
	if len(got) != 1 || got[0].Value != "openai.com" {
		t.Fatalf("invalid update replaced last known-good rule: %+v", got)
	}
}

func TestVersionedRuleBundlePreviewAndAtomicImport(t *testing.T) {
	source, err := New(t.TempDir(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	line := Line{ID: "portable", Name: "便携线路", Node: "active", Routing: Routing{Mode: core.RouteGlobal}}
	if msg := source.SetLines([]Line{line}); msg != "" {
		t.Fatal(msg)
	}
	if msg := source.SetAppRules([]AppRule{{Match: "Portable.exe", Line: line.ID, Enabled: true}}); msg != "" {
		t.Fatal(msg)
	}
	if msg := source.SetCustomRules([]core.RouteRule{{Type: "suffix", Value: "example.com", Action: "direct"}}); msg != "" {
		t.Fatal(msg)
	}
	bundle, err := source.ExportAppRules()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(bundle, `"schemaVersion": 2`) || !strings.Contains(bundle, `"customRules"`) {
		t.Fatalf("versioned complete bundle missing fields:\n%s", bundle)
	}

	dest, err := New(t.TempDir(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	preview, err := dest.PreviewAppRulesImport(bundle)
	if err != nil {
		t.Fatal(err)
	}
	if preview.RuleCount != 1 || preview.LineAdded != 1 || preview.CustomRules != 1 {
		t.Fatalf("unexpected import preview: %+v", preview)
	}
	if len(dest.GetAppRules()) != 0 || lineByID(dest.GetLines(), line.ID) != nil {
		t.Fatal("preview mutated destination state")
	}
	if err := dest.ImportAppRules(bundle); err != nil {
		t.Fatal(err)
	}
	if got := dest.GetAppRules(); len(got) != 1 || got[0].Match != "Portable.exe" {
		t.Fatalf("app rules not imported: %+v", got)
	}
	if got := dest.GetCustomRules(); len(got) != 1 || got[0].Value != "example.com" {
		t.Fatalf("custom rules not imported: %+v", got)
	}

	bad := `{"schemaVersion":2,"rules":[{"match":"Broken.exe","line":"missing","enabled":true}]}`
	if err := dest.ImportAppRules(bad); err == nil {
		t.Fatal("invalid bundle was accepted")
	}
	if got := dest.GetAppRules(); len(got) != 1 || got[0].Match != "Portable.exe" {
		t.Fatalf("failed import polluted destination: %+v", got)
	}
}

// Audit fix: official POWER云 nodes keep their ID across the panel reordering
// or adding nodes (the tags carry the list position), matched by OfficialKey;
// nodes saved by an older build (no key) are matched once by endpoint.
func TestReconcileOfficialNodesByStableKey(t *testing.T) {
	off := func(id, name, server, key string) *nodes.Node {
		n := &nodes.Node{ID: id, Name: name, Type: "vless", Server: server, Port: 443, Official: true, AccountID: "acc"}
		if key != "" {
			n.OfficialKey = "acc/" + key
		}
		return n
	}
	// Upgrade: old nodes have tag-based IDs and no key; same endpoints → IDs kept.
	old := []*nodes.Node{off("pv-tw-old", "节点 1 · 台湾", "tw", ""), off("pv-us-old", "节点 2 · 美国", "us", "")}
	old[0].Latency = 60
	fresh := []*nodes.Node{off("pv-tw-key", "节点 1 · 台湾", "tw", "relay:tw"), off("pv-us-key", "节点 2 · 美国", "us", "landing:us")}
	reconcileSubscriptionNodes(old, fresh)
	if fresh[0].ID != "pv-tw-old" || fresh[1].ID != "pv-us-old" || fresh[0].Latency != 60 {
		t.Fatalf("upgrade lost identity: %+v %+v", fresh[0], fresh[1])
	}
	// Then the panel puts a new node first: all tags shift, IDs follow the key.
	old = fresh
	fresh = []*nodes.Node{
		off("pv-jp-key", "节点 1 · 日本", "jp", "relay:jp"),
		off("pv-tw-key", "节点 2 · 台湾", "tw", "relay:tw"),
		off("pv-us-key", "节点 3 · 美国", "us", "landing:us"),
	}
	reconcileSubscriptionNodes(old, fresh)
	if fresh[0].ID != "pv-jp-key" || fresh[1].ID != "pv-tw-old" || fresh[2].ID != "pv-us-old" {
		t.Fatalf("reorder moved identities: %s %s %s", fresh[0].ID, fresh[1].ID, fresh[2].ID)
	}
	if fresh[1].Latency != 60 {
		t.Fatal("same server: measurements should stay")
	}
	// A keyed node never takes over another key's old node, even with the same name.
	old = []*nodes.Node{off("pv-a", "节点 1 · 台湾", "tw", "relay:tw")}
	fresh = []*nodes.Node{off("pv-b", "节点 1 · 台湾", "tw2", "relay:other")}
	reconcileSubscriptionNodes(old, fresh)
	if fresh[0].ID != "pv-b" {
		t.Fatalf("different key matched by name: %s", fresh[0].ID)
	}
}
