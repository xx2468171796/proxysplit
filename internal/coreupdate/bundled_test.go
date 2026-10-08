package coreupdate

import (
	"os"
	"path/filepath"
	"testing"
)

func TestBundledUpgradeDecision(t *testing.T) {
	for _, tc := range []struct {
		installed, bundled string
		upgrade            bool
	}{
		{"1.13.14", "1.14.1", true},
		{"1.14.1", "1.14.1", false},
		{"1.15.0", "1.14.1", false},
		{"1.14.10", "1.14.9", false},
		{"1.14.1-beta.1", "1.14.1", true},
		{"1.15.0-alpha.1", "1.14.1", false},
		{"", "1.14.1", true},
		// platform build (relayops): newer N wins, never back to official
		{"1.14.1", "1.14.2-relayops.6", true},
		{"1.15.0", "1.14.2-relayops.6", true},
		{"1.14.2-relayops.5", "1.14.2-relayops.6", true},
		{"1.14.2-relayops.6", "1.14.2-relayops.6", false},
		{"1.14.2-relayops.7", "1.14.2-relayops.6", false},
		{"1.14.2-relayops.6", "1.15.0", false},
		{"1.14.2-relayops.12", "1.14.3-relayops.1", true},
	} {
		got, err := needsBundledUpgrade(tc.installed, tc.bundled)
		if err != nil || got != tc.upgrade {
			t.Errorf("%+v: got %v, %v", tc, got, err)
		}
	}
	if _, err := needsBundledUpgrade("1.13.14", "invalid"); err == nil {
		t.Fatal("invalid bundle version accepted")
	}
	if _, err := needsBundledUpgrade("1.13.14", "1.14.2-beta.1"); err == nil {
		t.Fatal("pre-release bundle accepted")
	}
}

func TestInstallBinary(t *testing.T) {
	dir := t.TempDir()
	dst := filepath.Join(dir, "sing-box.exe")
	if err := installBinary(dir, []byte("old"), false); err != nil {
		t.Fatal(err)
	}
	if err := installBinary(dir, []byte("new"), false); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(dst)
	if err != nil || string(got) != "new" {
		t.Fatalf("got %q, %v", got, err)
	}
	// A backup which cannot be removed must not destroy the installed core.
	old := dst + ".old"
	if err := os.Mkdir(old, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(old, "locked"), []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := installBinary(dir, []byte("replacement"), false); err == nil {
		t.Fatal("backup failure ignored")
	}
	got, _ = os.ReadFile(dst)
	if string(got) != "new" {
		t.Fatalf("installed core lost: %q", got)
	}
}
