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
	if len(s.Nodes()) != 0 || len(s.GetSubs()) != 0 {
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

// Factory reset means starting over: an AI tool that was given the old control
// token must not keep its access, and undoing the reset must not hand it back.
func TestFactoryResetRotatesControlToken(t *testing.T) {
	s, _ := newResetSvc(t)
	if r := result(t, s.RunReset(context.Background(), []string{"factory"}, FactoryConfirmText), "factory"); !r.OK {
		t.Fatalf("factory: %+v", r)
	}
	rotated := s.APIToken()
	if rotated == "tok" || len(rotated) < 32 {
		t.Fatalf("control token was not rotated: %q", rotated)
	}
	if _, err := s.UndoReset(); err != nil {
		t.Fatal(err)
	}
	if len(s.Nodes()) != 1 {
		t.Fatal("undo did not restore the configuration")
	}
	if s.APIToken() != rotated {
		t.Fatal("undo brought the old control token back")
	}
}

// No reset item may delete the device identity (device.dat: losing it costs
// the user a device slot) or the control-API endpoint file of the running app.
// Items that touch the OS (system proxy, DNS flush, stray processes) and the
// host-registered ones are not run here: none of them works on files in the
// data dir (log-spool: telemetry.TestPurgeWithRecorderOff).
func TestResetsKeepDeviceIdentityAndControlEndpoint(t *testing.T) {
	s, dir := newResetSvc(t)
	keep := []string{"device.dat", "control-api.json"}
	for _, name := range keep {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("keep"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	ids := []string{"core-dns-cache", ResetNodeResolveCache, ResetDNSPrewarm, "node-cores", "routing", "app-rules", "all-settings", "factory"}
	rep := s.RunReset(context.Background(), ids, FactoryConfirmText)
	if rep.Failed != 0 || rep.OK != len(ids) {
		t.Fatalf("resets failed: %+v", rep)
	}
	if _, err := s.UndoReset(); err != nil {
		t.Fatal(err)
	}
	for _, name := range keep {
		if b, err := os.ReadFile(filepath.Join(dir, name)); err != nil || string(b) != "keep" {
			t.Fatalf("%s was deleted or changed by a reset: %v", name, err)
		}
	}
}

// A reset backup holds whatever the app had stored — including a port still
// pinned to a node that was deleted before the reset. Undo must restore it.
func TestUndoResetRestoresAPortPinnedToADeletedNode(t *testing.T) {
	s, _ := newResetSvc(t)
	s.mu.Lock()
	s.cfg.ProxyPorts = []ProxyPort{{ID: "p1", Name: "port", Port: 20011, Protocol: "mixed", Mode: "rule", Node: "deleted-node"}}
	s.save()
	s.mu.Unlock()
	if r := result(t, s.RunReset(context.Background(), []string{"app-rules"}, ""), "app-rules"); !r.OK {
		t.Fatalf("reset: %+v", r)
	}
	if _, err := s.UndoReset(); err != nil {
		t.Fatalf("undo failed on a config the app itself stored: %v", err)
	}
	if got := s.GetAppRules(); len(got) != 1 {
		t.Fatalf("rules not restored: %+v", got)
	}
}
