package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveChannel(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "channel")
	cases := []struct {
		name, account, exe, want string
		persist                  bool
	}{
		{"own site download, own account", "", `C:\Users\a\Downloads\proxysplit-latest.exe`, "", false},
		{"AI site installer", "", `C:\Users\a\Downloads\proxysplit-ai-latest (1).exe`, channelAIGW, true},
		{"AI site account", channelAIGW, `C:\Program Files\ProxySplit\proxysplit.exe`, channelAIGW, true},
		{"unknown channel from a newer server", "partner-x", `proxysplit.exe`, "", false},
	}
	for _, c := range cases {
		got, persist := resolveChannel(file, c.account, c.exe)
		if got != c.want || persist != c.persist {
			t.Errorf("%s: got %q/%v, want %q/%v", c.name, got, persist, c.want, c.persist)
		}
	}
	// Once marked, it sticks: logout (no account) and a renamed exe keep contacts hidden.
	if err := os.WriteFile(file, []byte("aigw\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got, persist := resolveChannel(file, "", `proxysplit.exe`); got != channelAIGW || persist {
		t.Fatalf("persisted marker ignored: %q/%v", got, persist)
	}
}
