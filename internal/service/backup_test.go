package service

import (
	"strings"
	"testing"
)

func TestFullBackupRoundTripPreservesUserData(t *testing.T) {
	source, err := New(t.TempDir(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if msg := source.AddManualNode("socks", "backup-node", "127.0.0.2", 1080, "u", "p"); msg != "" {
		t.Fatal(msg)
	}
	source.mu.Lock()
	source.cfg.Subs = []Sub{{ID: "sub-1", Name: "my subscription", URL: "https://example.invalid/sub", AutoUpdate: true, NodeCount: 1}}
	source.cfg.Settings.TunMode = true
	source.cfg.Settings.LanShare = true
	source.cfg.Rules = []AppRule{{Match: "Code.exe", Path: `C:\\Code.exe`, Line: LineRule, Enabled: true}}
	source.cfg.CustomRules = nil
	source.save()
	source.mu.Unlock()

	backup, err := source.ExportAll()
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	dest, err := New(dir, dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := dest.ImportAll(backup); err != nil {
		t.Fatalf("import: %v", err)
	}
	if got := dest.Nodes(); len(got) != 1 || got[0].Name != "backup-node" {
		t.Fatalf("nodes not restored: %+v", got)
	}
	if got := dest.GetSubs(); len(got) != 1 || got[0].URL != "https://example.invalid/sub" {
		t.Fatalf("subscriptions not restored: %+v", got)
	}
	if got := dest.GetSettings(); !got.TunMode || !got.LanShare {
		t.Fatalf("settings not restored: %+v", got)
	}
	if got := dest.GetAppRules(); len(got) != 1 || got[0].Match != "Code.exe" {
		t.Fatalf("rules not restored: %+v", got)
	}
	// Reopen verifies that ImportAll did not merely update in-memory state.
	reopened, err := New(dir, dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := reopened.Nodes(); len(got) != 1 || got[0].Name != "backup-node" {
		t.Fatalf("persisted backup not restored after reopen: %+v", got)
	}
}

func TestImportRejectsRuntimeConfigWithoutChangingCurrentData(t *testing.T) {
	dir := t.TempDir()
	s, err := New(dir, dir)
	if err != nil {
		t.Fatal(err)
	}
	if msg := s.AddManualNode("socks", "keep", "127.0.0.3", 1080, "", ""); msg != "" {
		t.Fatal(msg)
	}
	err = s.ImportAll(`{"outbounds":[],"inbounds":[]}`)
	if err == nil || !strings.Contains(err.Error(), "runtime config") {
		t.Fatalf("expected runtime-config rejection, got %v", err)
	}
	if got := s.Nodes(); len(got) != 1 || got[0].Name != "keep" {
		t.Fatalf("invalid import changed current nodes: %+v", got)
	}
}
