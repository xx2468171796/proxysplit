package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func newResetSvc(t *testing.T) (*Service, string) {
	t.Helper()
	dir := t.TempDir()
	s, err := New(t.TempDir(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if msg := s.AddManualNode("socks", "keep-me", "127.0.0.2", 1080, "u", "p"); msg != "" {
		t.Fatal(msg)
	}
	s.mu.Lock()
	s.cfg.Subs = []Sub{{ID: "sub-1", Name: "s", URL: "https://example.invalid/sub"}}
	s.cfg.Rules = []AppRule{{Match: "Code.exe", Line: LineRule, Enabled: true}}
	s.cfg.Settings.LanShare = true
	s.cfg.Nodes[0].Core = "sing-box"
	s.cfg.APIToken = "tok"
	s.save()
	s.mu.Unlock()
	return s, dir
}

func result(t *testing.T, rep ResetReport, id string) ResetResult {
	t.Helper()
	for _, r := range rep.Results {
		if r.ID == id {
			return r
		}
	}
	t.Fatalf("no result for %s: %+v", id, rep)
	return ResetResult{}
}

func TestResetAllSettingsKeepsNodesAndAIState(t *testing.T) {
	s, dir := newResetSvc(t)
	hijack := filepath.Join(dir, "ai-hijack")
	if err := os.WriteFile(hijack, []byte("on\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	rep := s.RunReset(context.Background(), []string{"all-settings"}, "")
	if r := result(t, rep, "all-settings"); !r.OK {
		t.Fatalf("failed: %+v", r)
	}
	if len(s.Nodes()) != 1 || len(s.GetSubs()) != 1 || len(s.GetAppRules()) != 0 || s.GetSettings().LanShare {
		t.Fatalf("unexpected state after reset")
	}
	if s.APIToken() != "tok" {
		t.Fatal("API token must survive")
	}
	if b, _ := os.ReadFile(hijack); string(b) != "on\n" {
		t.Fatal("AI hijack switch must never be touched")
	}
	if rep.Backup == "" || s.LastResetBackup() != rep.Backup {
		t.Fatalf("backup not recorded: %q", rep.Backup)
	}
	if _, err := s.UndoReset(); err != nil {
		t.Fatal(err)
	}
	if len(s.GetAppRules()) != 1 || !s.GetSettings().LanShare {
		t.Fatal("undo did not restore the config")
	}
}

func TestFactoryNeedsConfirmAndKeepsIdentity(t *testing.T) {
	s, dir := newResetSvc(t)
	hijack := filepath.Join(dir, "ai-hijack")
	_ = os.WriteFile(hijack, []byte("on\n"), 0o644)
	if r := result(t, s.RunReset(context.Background(), []string{"factory"}, "随便"), "factory"); r.OK {
		t.Fatal("factory must require the confirm text")
	}
	if len(s.Nodes()) != 1 {
		t.Fatal("refused factory reset changed data")
	}
	if r := result(t, s.RunReset(context.Background(), []string{"factory"}, FactoryConfirmText), "factory"); !r.OK {
		t.Fatalf("factory: %+v", r)
	}
	if len(s.Nodes()) != 0 || len(s.GetSubs()) != 0 || s.APIToken() != "tok" {
		t.Fatal("factory reset state wrong")
	}
	if b, _ := os.ReadFile(hijack); string(b) != "on\n" {
		t.Fatal("AI hijack switch must never be touched")
	}
}

func TestResetNodeCoresAndBackupsPruned(t *testing.T) {
	s, _ := newResetSvc(t)
	for i := 0; i < resetBackupKeep+2; i++ {
		s.RunReset(context.Background(), []string{"app-rules"}, "")
	}
	if n := len(s.resetBackups()); n != resetBackupKeep {
		t.Fatalf("kept %d backups", n)
	}
	if r := result(t, s.RunReset(context.Background(), []string{"node-cores"}, ""), "node-cores"); !r.OK || s.Nodes()[0].Core != "" {
		t.Fatalf("node cores: %+v", r)
	}
}

func TestRegistryAndReservedItems(t *testing.T) {
	s, _ := newResetSvc(t)
	avail := func(id string) bool {
		for _, it := range s.ResetItems() {
			if it.ID == id {
				return it.Available
			}
		}
		t.Fatalf("missing %s", id)
		return false
	}
	// New registers the node-resolve cache and DNS prewarm resetters.
	if !avail(ResetNodeResolveCache) || !avail(ResetDNSPrewarm) {
		t.Fatal("cache resetters must be registered by New")
	}
	if r := result(t, s.RunReset(context.Background(), []string{ResetDNSPrewarm}, ""), ResetDNSPrewarm); !r.OK {
		t.Fatalf("dns-prewarm reset: %+v", r)
	}
	called := false
	RegisterResetter(ResetNodeResolveCache, func(context.Context) error { called = true; return nil })
	RegisterResetter("x-test", func(context.Context) error { return errors.New("boom") })
	defer s.registerCacheResetters() // put the real one back
	defer RegisterResetter("x-test", nil)
	rep := s.RunReset(context.Background(), []string{ResetNodeResolveCache, "x-test"}, "")
	if !called || !avail(ResetNodeResolveCache) || rep.OK != 1 || rep.Failed != 1 {
		t.Fatalf("registry: %+v", rep)
	}
}
