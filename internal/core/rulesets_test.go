package core

import (
	"os"
	"path/filepath"
	"testing"
)

// An app moved between per-app lists must join its new list before it leaves
// the old one (the core reloads each file on its own). setGains decides which
// files go first; TestHotReloadMoveHasNoGap checks the effect on a real core.
func TestRuleSetWriteOrderAddsBeforeRemoves(t *testing.T) {
	a, ab := processSet([]string{"a.exe"}), processSet([]string{"a.exe", "B.exe"})
	if !setGains(a, ab) || setGains(ab, a) || setGains(ab, processSet([]string{"b.exe", "A.EXE"})) {
		t.Fatal("setGains: names are compared as a set, case-insensitively")
	}
	if !setGains([]byte("garbage"), a) {
		t.Fatal("an unreadable old file must be written early")
	}
	if !setGains(processSet(nil), a) || setGains(a, processSet(nil)) {
		t.Fatal("the empty-list placeholder is not a real process")
	}

	dir := t.TempDir()
	opts := Options{Split: true, RuleDir: dir, SplitDirect: []string{"x.exe"}}
	if err := writeRuleSets(opts); err != nil {
		t.Fatal(err)
	}
	opts.SplitDirect, opts.SplitBlock = nil, []string{"x.exe"}
	if err := writeRuleSets(opts); err != nil {
		t.Fatal(err)
	}
	for tag, want := range SplitRuleSets(opts) {
		got, err := os.ReadFile(filepath.Join(dir, tag+".json"))
		if err != nil || string(got) != string(want) {
			t.Fatalf("%s not written: %s", tag, got)
		}
	}
}
