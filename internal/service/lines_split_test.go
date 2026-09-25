package service

import (
	"testing"

	"proxysplit/internal/core"
	"proxysplit/internal/nodes"
)

const testLink = "vless://11111111-2222-3333-4444-555555555555@example.com:443?encryption=none&security=reality&sni=www.microsoft.com&fp=chrome&pbk=jNXHt1yRo0vDuchQlIP6Z0ZvjT3KtzVI-T4E7RoLJS0&sid=0123abcd&type=tcp&flow=xtls-rprx-vision#N"

func splitOpts(t *testing.T, s *Service, node *nodes.Node, whitelist bool) core.Options {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	opts := core.Options{Split: true, SplitWhitelist: whitelist, RuleDir: "rules", ClashController: "127.0.0.1:1"}
	s.splitOptionsLocked(&opts, node)
	return opts
}

// A custom line whose exit is 「直连」 can be saved, and apps on it go direct
// (they must not silently use the active node).
func TestCustomLineWithDirectExit(t *testing.T) {
	dir := t.TempDir()
	s, err := New(dir, dir)
	if err != nil {
		t.Fatal(err)
	}
	node, err := nodes.ParseLink(testLink)
	if err != nil {
		t.Fatal(err)
	}
	line := Line{ID: "cn-only", Name: "只放国内", Node: LineDirect, Routing: Routing{Mode: core.RouteCustom,
		Rules: []core.RouteRule{{Type: "suffix", Value: "ads.example", Action: "block"}}}}
	if msg := s.SetLines([]Line{line}); msg != "" {
		t.Fatalf("saving a 直连 custom line failed: %s", msg)
	}
	if msg := s.SetAppRules([]AppRule{{Match: "chrome.exe", Line: "cn-only", Enabled: true}}); msg != "" {
		t.Fatalf("assigning the line failed: %s", msg)
	}
	for _, whitelist := range []bool{true, false} {
		opts := splitOpts(t, s, node, whitelist)
		found := false
		for _, g := range opts.SplitGroups {
			for _, n := range g.Names {
				if n == "chrome.exe" {
					found = true
					if g.NodeTag != "direct" || g.Mode != core.RouteCustom {
						t.Errorf("whitelist=%v: chrome.exe group = %s/%s, want direct/custom", whitelist, g.NodeTag, g.Mode)
					}
				}
			}
		}
		if !found {
			t.Errorf("whitelist=%v: chrome.exe not in any group", whitelist)
		}
		if _, err := core.BuildTUNConfig(node, "info", opts); err != nil {
			t.Fatalf("config with a 直连 custom line: %v", err)
		}
	}
}

// The default line routes unlisted apps in 默认全走代理 only.
func TestDefaultLineOnlyInBlacklist(t *testing.T) {
	dir := t.TempDir()
	s, err := New(dir, dir)
	if err != nil {
		t.Fatal(err)
	}
	s.AddNodes(testLink)
	node := s.selectedNode()
	if node == nil {
		t.Fatal("no node")
	}
	if msg := s.SetDefaultLine(LineBlock); msg == "" {
		t.Fatal("拦截 as the default line must be refused")
	}
	if msg := s.SetDefaultLine(LineGlobal); msg != "" {
		t.Fatal(msg)
	}
	if d := splitOpts(t, s, node, false).SplitDefault; d == nil || d.Mode != core.RouteGlobal || d.NodeTag != "proxy" {
		t.Fatalf("blacklist default = %+v, want global via proxy", d)
	}
	if d := splitOpts(t, s, node, true).SplitDefault; d != nil {
		t.Fatalf("whitelist must ignore the default line, got %+v", d)
	}
	if msg := s.SetDefaultLine(LineDirect); msg != "" {
		t.Fatal(msg)
	}
	if d := splitOpts(t, s, node, false).SplitDefault; d == nil || d.NodeTag != "direct" {
		t.Fatalf("blacklist default = %+v, want direct", d)
	}
	if msg := s.SetDefaultLine(LineRule); msg != "" {
		t.Fatal(msg)
	}
	if d := splitOpts(t, s, node, false).SplitDefault; d != nil {
		t.Fatalf("规则 is the built-in default, want nil, got %+v", d)
	}
}
