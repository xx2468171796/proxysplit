//go:build windows

package shortcut

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func target(t *testing.T, lnk string) string {
	t.Helper()
	out, err := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
		"(New-Object -ComObject WScript.Shell).CreateShortcut('"+strings.ReplaceAll(lnk, "'", "''")+"').TargetPath").Output()
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(string(out))
}

func TestEnsureCreatesRepairsAndKeeps(t *testing.T) {
	dir := t.TempDir()
	exeA := filepath.Join(dir, "app dir's", "ProxySplit.exe") // space + quote in the path
	exeB := filepath.Join(dir, "moved", "ProxySplit.exe")
	for _, p := range []string{exeA, exeB} {
		os.MkdirAll(filepath.Dir(p), 0o755)
		os.WriteFile(p, []byte("MZ"), 0o755)
	}
	exeA, exeB = LongPath(exeA), LongPath(exeB)
	lnk := filepath.Join(dir, "ProxySplit.lnk")

	if err := ensureIn(dir, "ProxySplit", exeA); err != nil {
		t.Fatal(err)
	}
	if got := target(t, lnk); !strings.EqualFold(got, exeA) {
		t.Fatalf("created shortcut points at %q, want %q", got, exeA)
	}
	before, _ := os.Stat(lnk)
	time.Sleep(1100 * time.Millisecond)
	if err := ensureIn(dir, "ProxySplit", exeA); err != nil {
		t.Fatal(err)
	}
	if after, _ := os.Stat(lnk); !after.ModTime().Equal(before.ModTime()) {
		t.Fatal("an up-to-date shortcut was rewritten")
	}
	os.Remove(lnk) // user deleted it
	if err := ensureIn(dir, "ProxySplit", exeA); err != nil || !strings.EqualFold(target(t, lnk), exeA) {
		t.Fatalf("deleted shortcut not recreated: %v", err)
	}
	if err := ensureIn(dir, "ProxySplit", exeB); err != nil || !strings.EqualFold(target(t, lnk), exeB) {
		t.Fatalf("stale shortcut target not corrected: %v", err)
	}
}
