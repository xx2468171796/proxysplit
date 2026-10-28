package configsync

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"proxysplit/internal/license"
)

// Target machine: its own POWER云 line "own" that every reference points at.
const ownMachine = `{
  "nodes":[{"id":"own","official":true,"server":"own.example"},{"id":"m1","server":"1.2.3.4"}],
  "selectedId":"own",
  "subs":[],
  "rules":[{"match":"chrome.exe","line":"l1","node":"own","enabled":true}],
  "lines":[{"id":"l1","name":"走台湾","node":"own"}],
  "proxyPorts":[{"id":"pp","name":"浏览器","port":7891,"node":"own"}],
  "settings":{"theme":"light"}
}`

func decode(t *testing.T, raw string) map[string]any {
	t.Helper()
	var cfg map[string]any
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		t.Fatal(err)
	}
	return cfg
}

func TestImportKeepsLocalValueForAccountNodeReferences(t *testing.T) {
	b, _ := Snapshot(&memStore{cfg: sampleConfig}, "pc") // refs point at the exporter's POWER云 p1
	dst := &memStore{cfg: ownMachine}
	if err := Apply(dst, t.TempDir(), b, nil); err != nil {
		t.Fatal(err)
	}
	cfg := decode(t, dst.cfg)
	if got := str(list(cfg["lines"])[0], "node"); got != "own" {
		t.Fatalf("line should keep this machine's POWER云 node, got %q", got)
	}
	if got := str(list(cfg["rules"])[0], "node"); got != "own" {
		t.Fatalf("rule should keep this machine's POWER云 node, got %q", got)
	}
	if got := str(list(cfg["proxyPorts"])[0], "node"); got != "m1" {
		t.Fatalf("a reference to an existing node is taken from the bundle, got %q", got)
	}
	if got := str(cfg, "selectedId"); got != "own" {
		t.Fatalf("a selection of a missing node keeps the local selection, got %q", got)
	}
}

func TestManualImportAppliesSelectionButSyncNeverDoes(t *testing.T) {
	src := strings.Replace(sampleConfig, `"selectedId": "p1"`, `"selectedId": "m1"`, 1)
	b, _ := Snapshot(&memStore{cfg: src}, "pc")
	manual := &memStore{cfg: ownMachine}
	if err := Apply(manual, t.TempDir(), b, nil); err != nil {
		t.Fatal(err)
	}
	if got := str(decode(t, manual.cfg), "selectedId"); got != "m1" {
		t.Fatalf("manual import should apply the file's selection, got %q", got)
	}
	synced := &memStore{cfg: ownMachine}
	if err := ApplySync(synced, t.TempDir(), b); err != nil {
		t.Fatal(err)
	}
	if got := str(decode(t, synced.cfg), "selectedId"); got != "own" {
		t.Fatalf("cloud sync must keep this machine's selection, got %q", got)
	}
	// Switching nodes is not a sync change, and the uploaded bundle has no selection.
	other, _ := Snapshot(&memStore{cfg: sampleConfig}, "pc")
	if b.ForSync().Hash() != other.ForSync().Hash() || b.Hash() == other.Hash() {
		t.Fatal("ForSync must ignore selectedId (and only it)")
	}
	raw, _ := b.ForSync().Encode()
	if strings.Contains(raw, "selectedId") {
		t.Fatalf("sync bundle carries selectedId: %s", raw)
	}
}

func TestAutoPullKeepsManualImportUndo(t *testing.T) {
	dir := t.TempDir()
	store := &memStore{cfg: ownMachine}
	b, _ := Snapshot(&memStore{cfg: sampleConfig}, "pc")
	if err := Apply(store, dir, b, []string{SecSettings}); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(filepath.Join(dir, BackupFile))
	// The cloud has a newer copy from another device; this one is untouched → auto pull.
	remote := &fakeRemote{}
	s := NewSyncer(dir, "pc", store, remote, func() bool { return true }, func() string { return "alice" }, nil)
	if err := s.SyncNow(); err != nil {
		t.Fatal(err)
	}
	other, _ := Snapshot(&memStore{cfg: strings.Replace(sampleConfig, `"dark"`, `"system"`, 1)}, "laptop")
	payload, _ := other.Encode()
	remote.meta = license.SyncMeta{Exists: true, Version: 2, Payload: payload}
	if err := s.SyncNow(); err != nil || !strings.Contains(store.cfg, `"system"`) {
		t.Fatalf("auto pull failed: %v", err)
	}
	after, _ := os.ReadFile(filepath.Join(dir, BackupFile))
	if string(after) != string(before) {
		t.Fatal("auto pull overwrote the manual import undo backup")
	}
	if _, err := os.Stat(filepath.Join(dir, SyncBackupFile)); err != nil {
		t.Fatalf("auto pull must keep its own backup: %v", err)
	}
	if err := Undo(store, dir); err != nil || !strings.Contains(store.cfg, `"light"`) {
		t.Fatalf("manual undo should still restore the pre-import config: %v %s", err, store.cfg)
	}
}

func TestSyncerForgetsStateOnAccountSwitchWithoutLogout(t *testing.T) {
	dir := t.TempDir()
	account := "alice"
	remote := &fakeRemote{}
	store := &memStore{cfg: sampleConfig}
	s := NewSyncer(dir, "pc", store, remote, func() bool { return true }, func() string { return account }, nil)
	if err := s.SyncNow(); err != nil || remote.puts != 1 {
		t.Fatalf("alice's first sync should upload: %v", err)
	}
	// bob signs in directly (no Logout → no Forget); his cloud copy is at the
	// same version number alice's state remembers, with different content.
	account = "bob"
	bobs, _ := Snapshot(&memStore{cfg: strings.Replace(sampleConfig, `"dark"`, `"bob-theme"`, 1)}, "bob-pc")
	payload, _ := bobs.Encode()
	remote.meta = license.SyncMeta{Exists: true, Version: 1, Payload: payload}
	store.cfg = strings.Replace(store.cfg, `"dark"`, `"local-edit"`, 1)
	err := s.SyncNow()
	if err != license.ErrSyncConflict {
		t.Fatalf("account switch must treat this machine as never synced (conflict), got %v", err)
	}
	if remote.puts != 1 || !strings.Contains(remote.meta.Payload, "bob-theme") {
		t.Fatal("alice's bookkeeping must never overwrite bob's cloud copy")
	}
	// The new account is remembered; a reload keeps it.
	again := NewSyncer(dir, "pc", store, remote, func() bool { return true }, func() string { return "bob" }, nil)
	if again.ensureAccount() {
		t.Fatal("account should be persisted in the state file")
	}
}

type failingMetaRemote struct{ fakeRemote }

func (f *failingMetaRemote) ConfigSyncGet(bool) (license.SyncMeta, error) {
	return license.SyncMeta{}, os.ErrDeadlineExceeded
}

func TestConflictMetadataFailureIsAnError(t *testing.T) {
	r := &failingMetaRemote{fakeRemote{fails: license.ErrSyncConflict}}
	s := NewSyncer(t.TempDir(), "pc", &memStore{cfg: sampleConfig}, r, func() bool { return true }, nil, nil)
	b, _ := s.snapshot()
	err := s.push(b, 3)
	if err == nil || err == license.ErrSyncConflict || s.Status().Conflict != nil {
		t.Fatalf("metadata fetch failure must surface an error, not a version-0 conflict: %v", err)
	}
}
