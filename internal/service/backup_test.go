package service

import (
	"encoding/json"
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

// A backup file is edited by hand or comes from someone else: it must pass the
// same checks as the UI forms, and it must not choose this install's control token.
func TestImportRunsTheUIValidators(t *testing.T) {
	dir := t.TempDir()
	s, err := New(dir, dir)
	if err != nil {
		t.Fatal(err)
	}
	if msg := s.AddManualNode("socks", "keep", "127.0.0.3", 1080, "", ""); msg != "" {
		t.Fatal(msg)
	}
	token := s.APIToken()
	base, err := s.ExportAll()
	if err != nil {
		t.Fatal(err)
	}
	with := func(mutate func(c *Config)) string {
		var c Config
		if err := json.Unmarshal([]byte(base), &c); err != nil {
			t.Fatal(err)
		}
		mutate(&c)
		out, _ := json.Marshal(&c)
		return string(out)
	}
	port := func(id string, n int) ProxyPort {
		return ProxyPort{ID: id, Name: id, Port: n, Protocol: "mixed", Mode: "rule"}
	}
	bad := map[string]string{
		"DNS that is not an IP":   with(func(c *Config) { c.Settings.Net.DNSDirect = "dns.example.invalid" }),
		"MTU out of range":        with(func(c *Config) { c.Settings.Net.TunMTU = 99999 }),
		"proxy port out of range": with(func(c *Config) { c.ProxyPorts = []ProxyPort{port("a", 70000)} }),
		"duplicate proxy port":    with(func(c *Config) { c.ProxyPorts = []ProxyPort{port("a", 20001), port("b", 20001)} }),
		"proxy port without ID":   with(func(c *Config) { c.ProxyPorts = []ProxyPort{port("", 20001)} }),
		"proxy port on a missing node": with(func(c *Config) {
			p := port("a", 20001)
			p.Node = "no-such-node"
			c.ProxyPorts = []ProxyPort{p}
		}),
		"subscription filter that is not a regex": with(func(c *Config) { c.Subs = []Sub{{ID: "s", Name: "s", URL: "https://example.invalid/s", Include: "("}} }),
		"subscription interval out of range": with(func(c *Config) {
			c.Subs = []Sub{{ID: "s", Name: "s", URL: "https://example.invalid/s", IntervalMin: 999999}}
		}),
	}
	for name, data := range bad {
		if err := s.ImportAll(data); err == nil {
			t.Errorf("%s: import was accepted", name)
		}
		if got := s.ListProxyPorts(); len(got) != 0 {
			t.Fatalf("%s: rejected import changed live data", name)
		}
	}

	good := with(func(c *Config) {
		c.APIToken = "planted-control-token"
		c.ProxyPorts = []ProxyPort{{ID: "a", Port: 20001, Protocol: "bogus", Mode: "bogus"}}
		c.Subs = []Sub{{ID: "s", Name: "s", URL: "https://example.invalid/s", IntervalMin: 3, UserAgent: "  ua  "}}
	})
	if err := s.ImportAll(good); err != nil {
		t.Fatalf("valid backup rejected: %v", err)
	}
	if s.APIToken() != token {
		t.Fatal("the imported file chose the control token")
	}
	s.mu.Lock()
	p, sub := s.cfg.ProxyPorts[0], s.cfg.Subs[0]
	s.mu.Unlock()
	if p.Protocol != "mixed" || p.Mode != "rule" || p.Name == "" {
		t.Fatalf("proxy port was not normalised like the form does: %+v", p)
	}
	if sub.IntervalMin != 10 || sub.UserAgent != "ua" {
		t.Fatalf("subscription options were not normalised like the form does: %+v", sub)
	}
}
