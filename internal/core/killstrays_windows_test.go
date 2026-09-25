//go:build windows

package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// killStrays must find a leftover core even when the data directory (from
// %APPDATA%, i.e. the Windows user name) contains a typographic quote, which
// PowerShell would otherwise treat as the end of a '…' string.
func TestKillStraysOddPath(t *testing.T) {
	src, err := os.ReadFile(singboxPath(t))
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(t.TempDir(), "O’Brien ‘用户’ $x")
	os.MkdirAll(dir, 0o755)
	bin := filepath.Join(dir, "sing-box.exe")
	if err := os.WriteFile(bin, src, 0o755); err != nil {
		t.Fatal(err)
	}
	cfg := filepath.Join(dir, "c.json")
	os.WriteFile(cfg, []byte(`{"log":{"level":"error"},"inbounds":[{"type":"mixed","listen":"127.0.0.1","listen_port":0}],"outbounds":[{"type":"direct"}]}`), 0o600)
	cmd := exec.Command(bin, "run", "-c", cfg)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()
	t.Cleanup(func() { cmd.Process.Kill() })
	time.Sleep(500 * time.Millisecond)
	select {
	case err := <-exited:
		t.Fatalf("test core exited early: %v", err)
	default:
	}

	NewManager(bin, dir, func(string) {}).CleanStrays()
	select {
	case <-exited:
	case <-time.After(10 * time.Second):
		t.Fatal("stray core in a path with ’ was not stopped")
	}
}
