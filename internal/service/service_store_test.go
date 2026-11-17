package service

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const plantedExeCopy = `{
 "nodes": [{"id":"planted","name":"planted","type":"trojan","server":"attacker.proxysplit.test","port":443,"password":"x"}],
 "selectedId": "planted",
 "settings": {"theme":"dark"},
 "apiToken": "planted-control-token"
}`

// exeCopyAt points the legacy exe-side copy at a file in a temp "Downloads"
// folder for one test (real test binaries have none, see legacyExeCopyPath).
func exeCopyAt(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "proxysplit-data.json")
	if content != "" {
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	old := legacyExeCopyPath
	legacyExeCopyPath = func() string { return path }
	t.Cleanup(func() { legacyExeCopyPath = old })
	return path
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// Saving must not leave the whole config (control token, node credentials,
// subscription URLs) in plaintext next to the exe — often the Downloads folder.
func TestSaveWritesNothingNextToTheExe(t *testing.T) {
	exeCopy := exeCopyAt(t, "")
	dataDir := t.TempDir()
	s, err := New(t.TempDir(), dataDir)
	if err != nil {
		t.Fatal(err)
	}
	s.APIToken() // creates and saves the token
	s.UpsertAppRule("chrome.exe", "", LineRule, "", true)
	if exists(exeCopy) {
		t.Fatal("a config copy was written next to the exe")
	}
	if !exists(filepath.Join(dataDir, "config.json")) {
		t.Fatal("config.json was not saved in the data dir")
	}
}

// A file dropped next to the exe must never become the configuration: with it
// an attacker who can write to Downloads chooses the nodes and the control
// token of a fresh install.
func TestLoadIgnoresAConfigPlantedNextToTheExe(t *testing.T) {
	exeCopy := exeCopyAt(t, plantedExeCopy)
	dataDir := t.TempDir()
	s, err := New(t.TempDir(), dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if n := s.Nodes(); len(n) != 0 {
		t.Fatalf("planted nodes were loaded: %+v", n[0])
	}
	if s.APIToken() == "planted-control-token" {
		t.Fatal("planted control token was adopted")
	}
	// The plaintext copy leaves the exe folder; with no config in the data dir
	// it may be the user's only copy, so it is kept there, unloaded.
	if exists(exeCopy) {
		t.Fatal("exe-side copy was left in place")
	}
	kept, err := os.ReadFile(filepath.Join(dataDir, retiredExeCopyName))
	if err != nil || !strings.Contains(string(kept), "attacker.proxysplit.test") {
		t.Fatalf("exe-side copy was not moved into the data dir: %v", err)
	}
	// And it stays unloaded on the next start.
	again, err := New(t.TempDir(), dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(again.Nodes()) != 0 {
		t.Fatal("the retired copy was loaded on the next start")
	}
}

// An upgraded install: the data dir holds the real config, the exe-side copy
// is only a leak. It is deleted once the data-dir config is known good.
func TestLoadDeletesTheExeCopyWhenTheDataDirConfigIsGood(t *testing.T) {
	dataDir := t.TempDir()
	first, err := New(t.TempDir(), dataDir)
	if err != nil {
		t.Fatal(err)
	}
	first.UpsertAppRule("chrome.exe", "", LineRule, "", true)

	exeCopy := exeCopyAt(t, plantedExeCopy)
	s, err := New(t.TempDir(), dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if exists(exeCopy) {
		t.Fatal("exe-side copy survived a start with a good data-dir config")
	}
	if exists(filepath.Join(dataDir, retiredExeCopyName)) {
		t.Fatal("a redundant copy was kept although the data dir has the config")
	}
	if rules := s.GetAppRules(); len(rules) != 1 || len(s.Nodes()) != 0 {
		t.Fatalf("data-dir config was not the one loaded: %+v", rules)
	}
}

// The recovery copy inside the data dir keeps working.
func TestLoadStillRecoversFromTheDataDirBackup(t *testing.T) {
	exeCopy := exeCopyAt(t, plantedExeCopy)
	dataDir := t.TempDir()
	first, err := New(t.TempDir(), dataDir)
	if err != nil {
		t.Fatal(err)
	}
	first.UpsertAppRule("chrome.exe", "", LineRule, "", true)
	first.UpsertAppRule("git.exe", "", LineGlobal, "", true) // second save: .bak now holds chrome.exe
	if err := os.WriteFile(filepath.Join(dataDir, "config.json"), []byte("{broken"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(exeCopy, []byte(plantedExeCopy), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := New(t.TempDir(), dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if rules := s.GetAppRules(); len(rules) == 0 || rules[0].Match != "chrome.exe" {
		t.Fatalf("backup in the data dir was not used: %+v", rules)
	}
	if len(s.Nodes()) != 0 || exists(exeCopy) {
		t.Fatal("exe-side copy was used or left in place")
	}
}
