package configsync

import (
	"encoding/json"
	"strings"
	"testing"

	"proxysplit/internal/license"
	"proxysplit/internal/powervpn"
)

type memStore struct{ cfg string }

func (m *memStore) ExportAll() (string, error) { return m.cfg, nil }
func (m *memStore) ImportAll(d string) error   { m.cfg = d; return nil }

const sampleConfig = `{
  "nodes": [
    {"id":"m1","name":"manual","type":"socks","server":"1.2.3.4","port":1080,"latency":42,"speed":3.2},
    {"id":"s1","name":"from sub","type":"trojan","server":"s.example","port":443,"subId":"subA"},
    {"id":"p1","name":"POWER云 台湾","type":"vless","server":"tw.example","port":443,"official":true,"accountId":"acc"},
    {"id":"p2","name":"POWER云 日本","type":"vless","server":"jp.example","port":443,"subId":"subP"}
  ],
  "selectedId": "p1",
  "subs": [
    {"id":"subA","name":"A","url":"https://a.example/sub","autoUpdate":true,"lastUpdate":"x","nodeCount":1},
    {"id":"subP","name":"POWER云","url":"powervpn://profile","autoUpdate":true}
  ],
  "rules": [{"match":"chrome.exe","line":"l1","node":"p1","enabled":true}],
  "lines": [{"id":"l1","name":"走台湾","node":"p1","routing":{"mode":"global"}}],
  "ruleMode": "whitelist",
  "proxyPorts": [{"id":"pp","name":"浏览器","port":7891,"node":"m1"}],
  "settings": {"theme":"dark","mixedPort":7890},
  "logLevel": "info",
  "apiToken": "local-secret-token",
  "sysProxyLast": "127.0.0.1:7890"
}`

func TestOfficialSubURLMatchesPowerVPN(t *testing.T) {
	if officialSubURL != powervpn.ProfileSubURL {
		t.Fatalf("officialSubURL %q drifted from powervpn.ProfileSubURL %q", officialSubURL, powervpn.ProfileSubURL)
	}
}

func TestSnapshotExcludesAccountAndMachineData(t *testing.T) {
	b, err := Snapshot(&memStore{cfg: sampleConfig}, "pc")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := b.Encode()
	for _, leak := range []string{"tw.example", "jp.example", "powervpn://profile", "local-secret-token", "sysProxyLast", `"latency"`} {
		if strings.Contains(raw, leak) {
			t.Fatalf("bundle leaks %s:\n%s", leak, raw)
		}
	}
	p := PreviewOf(b)
	if p.Nodes != 1 || p.Subscriptions != 1 || p.Rules != 1 || p.Lines != 1 || p.ProxyPorts != 1 || !p.HasSettings || len(p.Sections) != 5 {
		t.Fatalf("unexpected preview: %+v", p)
	}
	if b.Schema != 1 || b.App != "proxysplit" || b.Device != "pc" {
		t.Fatalf("bad header: %+v", b)
	}
}

func TestRoundTripKeepsLocalOfficialLines(t *testing.T) {
	src := &memStore{cfg: sampleConfig}
	b, _ := Snapshot(src, "pc")
	text, _ := b.Encode()
	parsed, err := Parse(text)
	if err != nil {
		t.Fatal(err)
	}
	// Target machine has its own POWER云 line and nothing else.
	dst := &memStore{cfg: `{"nodes":[{"id":"own","official":true,"server":"own.example"}],"subs":[],"settings":{"theme":"light"},"apiToken":"keep-me"}`}
	dir := t.TempDir()
	if err := Apply(dst, dir, parsed, nil); err != nil {
		t.Fatal(err)
	}
	var cfg map[string]any
	_ = json.Unmarshal([]byte(dst.cfg), &cfg)
	ids := map[string]bool{}
	for _, n := range list(cfg["nodes"]) {
		ids[str(n, "id")] = true
	}
	if !ids["m1"] || !ids["s1"] || !ids["own"] || ids["p1"] || ids["p2"] {
		t.Fatalf("unexpected nodes after apply: %v", ids)
	}
	if str(cfg, "apiToken") != "keep-me" || str(cfg, "selectedId") != "" {
		t.Fatalf("machine data / dangling selection wrong: %v %v", cfg["apiToken"], cfg["selectedId"])
	}
	if node := str(list(cfg["lines"])[0], "node"); node != "active" {
		t.Fatalf("line pointing at a missing POWER云 node should fall back to active, got %q", node)
	}
	if ok, _ := CanUndo(dir); !ok {
		t.Fatal("apply must leave an undo backup")
	}
	if err := Undo(dst, dir); err != nil || !strings.Contains(dst.cfg, "keep-me") || strings.Contains(dst.cfg, "m1") {
		t.Fatalf("undo failed: %v %s", err, dst.cfg)
	}
	if ok, _ := CanUndo(dir); ok {
		t.Fatal("undo is one step only")
	}
}

func TestPartialRestoreOnlyTouchesChosenSections(t *testing.T) {
	b, _ := Snapshot(&memStore{cfg: sampleConfig}, "pc")
	dst := &memStore{cfg: `{"nodes":[{"id":"x","server":"x.example"}],"settings":{"theme":"light"},"logLevel":"debug"}`}
	if err := Apply(dst, t.TempDir(), b, []string{SecSettings}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(dst.cfg, `"x.example"`) || strings.Contains(dst.cfg, "1.2.3.4") || !strings.Contains(dst.cfg, `"dark"`) {
		t.Fatalf("settings-only restore changed nodes or missed settings: %s", dst.cfg)
	}
}

func TestHashIgnoresMeasurementsAndSubRefresh(t *testing.T) {
	a, _ := Snapshot(&memStore{cfg: sampleConfig}, "pc")
	changed := strings.Replace(sampleConfig, `"latency":42`, `"latency":99`, 1)
	changed = strings.Replace(changed, `"lastUpdate":"x"`, `"lastUpdate":"y"`, 1)
	changed = strings.Replace(changed, `"name":"from sub"`, `"name":"renamed by provider"`, 1)
	b, _ := Snapshot(&memStore{cfg: changed}, "other")
	if a.Hash() != b.Hash() {
		t.Fatal("measurements / subscription refresh must not count as a user change")
	}
	edited, _ := Snapshot(&memStore{cfg: strings.Replace(sampleConfig, `"dark"`, `"light"`, 1)}, "pc")
	if edited.Hash() == a.Hash() {
		t.Fatal("a settings edit must change the hash")
	}
}

func TestParseAcceptsLegacyBackupAndRejectsJunk(t *testing.T) {
	if _, err := Parse(sampleConfig); err != nil {
		t.Fatalf("legacy full-config backup rejected: %v", err)
	}
	for _, junk := range []string{"", "[]", `{"inbounds":[],"outbounds":[]}`, `{"app":"other","sections":{"nodes":{}}}`, `{"schema":9,"app":"proxysplit","sections":{"nodes":{}}}`} {
		if _, err := Parse(junk); err == nil {
			t.Fatalf("junk accepted: %s", junk)
		}
	}
}

type fakeRemote struct {
	meta  license.SyncMeta
	puts  int
	fails error
}

func (f *fakeRemote) ConfigSyncGet(metaOnly bool) (license.SyncMeta, error) {
	m := f.meta
	if metaOnly {
		m.Payload = ""
	}
	return m, nil
}

func (f *fakeRemote) ConfigSyncPut(payload string, base int) (int, error) {
	if f.fails != nil {
		return 0, f.fails
	}
	if f.meta.Exists && base != f.meta.Version {
		return 0, license.ErrSyncConflict
	}
	f.puts++
	f.meta = license.SyncMeta{Exists: true, Version: f.meta.Version + 1, Payload: payload}
	return f.meta.Version, nil
}

func TestSyncerPushPullAndConflict(t *testing.T) {
	member := func() bool { return true }
	remote := &fakeRemote{}
	store := &memStore{cfg: sampleConfig}
	dir := t.TempDir()
	s := NewSyncer(dir, "pc", store, remote, member, nil, nil)
	if err := s.SyncNow(); err != nil || remote.puts != 1 {
		t.Fatalf("first sync should upload: %v puts=%d", err, remote.puts)
	}
	// Another device uploads a change; this one is untouched → pull.
	other, _ := Snapshot(&memStore{cfg: strings.Replace(sampleConfig, `"dark"`, `"light"`, 1)}, "laptop")
	payload, _ := other.Encode()
	remote.meta = license.SyncMeta{Exists: true, Version: 2, Payload: payload, DeviceName: "laptop"}
	if err := s.SyncNow(); err != nil || !strings.Contains(store.cfg, `"light"`) {
		t.Fatalf("untouched local config should pull the newer cloud copy: %v", err)
	}
	// Both sides change → conflict, resolved with the local copy.
	store.cfg = strings.Replace(store.cfg, `"light"`, `"system"`, 1)
	remote.meta = license.SyncMeta{Exists: true, Version: 3, Payload: payload}
	if err := s.SyncNow(); err != license.ErrSyncConflict || s.Status().Conflict == nil {
		t.Fatalf("expected conflict, got %v", err)
	}
	if err := s.Resolve("local"); err != nil || s.Status().Conflict != nil || remote.meta.Version != 4 {
		t.Fatalf("resolve local failed: %v %+v", err, remote.meta)
	}
	// Reloaded syncer keeps the bookkeeping.
	again := NewSyncer(dir, "pc", store, remote, member, nil, nil)
	if again.Status().LocalChanged || again.Status().LastVersion != 4 {
		t.Fatalf("state not persisted: %+v", again.Status())
	}
}

func TestSyncerTickDebouncesAndSkipsFreeUsers(t *testing.T) {
	isMember := false
	remote := &fakeRemote{}
	store := &memStore{cfg: sampleConfig}
	s := NewSyncer(t.TempDir(), "pc", store, remote, func() bool { return isMember }, nil, nil)
	s.Tick()
	s.Tick()
	if remote.puts != 0 {
		t.Fatal("free users must never upload")
	}
	isMember = true
	s.Tick() // first sight of the change: wait
	if remote.puts != 0 {
		t.Fatal("upload must wait for the debounce")
	}
	s.Tick() // unchanged for a whole tick: upload
	if remote.puts != 1 {
		t.Fatalf("debounced upload missing, puts=%d", remote.puts)
	}
	s.Tick()
	if remote.puts != 1 {
		t.Fatal("no change, no upload")
	}
	s.SetEnabled(false)
	store.cfg = strings.Replace(store.cfg, `"dark"`, `"light"`, 1)
	s.Tick()
	s.Tick()
	if remote.puts != 1 {
		t.Fatal("disabled sync must not upload")
	}
}
