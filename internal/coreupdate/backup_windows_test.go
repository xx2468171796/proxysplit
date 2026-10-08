package coreupdate

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// A running core keeps its executable locked on Windows: installing over it
// must still work (the running file is renamed to .old), the backup cannot be
// cleared until that process exits, a second install is refused with
// ErrBackupBusy instead of breaking anything, and Rollback after the process
// stopped restores a core that runs.
func TestRunningCoreBackupLifecycle(t *testing.T) {
	real, err := os.ReadFile(filepath.Join("..", "..", "bin", "sing-box.exe"))
	if err != nil {
		t.Skip("sing-box.exe not present")
	}
	dir := t.TempDir()
	writeInstalled(t, dir, real, "1.14.2-relayops.9")
	cfg := filepath.Join(dir, "c.json")
	if err := os.WriteFile(cfg, []byte(`{"log":{"level":"error"},"outbounds":[{"type":"direct","tag":"direct"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	proc := exec.Command(filepath.Join(dir, "sing-box.exe"), "run", "-c", cfg)
	if err := proc.Start(); err != nil {
		t.Fatal(err)
	}
	exited := make(chan struct{})
	go func() { proc.Wait(); close(exited) }()
	defer func() { proc.Process.Kill(); <-exited }()
	time.Sleep(300 * time.Millisecond)

	saved := releaseWait
	releaseWait = 200 * time.Millisecond
	defer func() { releaseWait = saved }()

	srv, sum := serve(t, fakeExe("broken-new-core"))
	if _, err := InstallRelease(dir, "1.14.2-relayops.9", Release{Version: "1.14.2-relayops.15", URL: srv.URL, SHA256: sum}, ""); err != nil {
		t.Fatalf("install over a running core: %v", err)
	}
	if err := ClearBackup(dir); !errors.Is(err, ErrBackupBusy) {
		t.Fatalf("clearing a running backup: %v", err)
	}
	srv2, sum2 := serve(t, fakeExe("newer"))
	if _, err := InstallRelease(dir, "1.14.2-relayops.15", Release{Version: "1.14.2-relayops.16", URL: srv2.URL, SHA256: sum2}, ""); !errors.Is(err, ErrBackupBusy) {
		t.Fatalf("second install while the old core runs: %v", err)
	}

	// The new core "fails to start": stop the old process, roll back.
	proc.Process.Kill()
	<-exited
	if err := Rollback(dir); err != nil {
		t.Fatal(err)
	}
	out, err := exec.Command(filepath.Join(dir, "sing-box.exe"), "version").Output()
	if err != nil || len(out) == 0 {
		t.Fatalf("restored core does not run: %v", err)
	}
	if got := InstalledVersion(dir); got != "1.14.2-relayops.9" {
		t.Fatalf("version after rollback %q", got)
	}
}
