package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// startIdleCore runs a sing-box from bin that just sits there (loopback mixed
// inbound, direct outbound) and reports its exit on the returned channel.
func startIdleCore(t *testing.T, bin, dir, name string) (*exec.Cmd, <-chan struct{}) {
	t.Helper()
	cfg := filepath.Join(dir, name+".json")
	if err := os.WriteFile(cfg, []byte(`{"log":{"level":"error"},"inbounds":[{"type":"mixed","listen":"127.0.0.1","listen_port":0}],"outbounds":[{"type":"direct"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(bin, "run", "-c", cfg)
	hideWindow(cmd)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	exited := make(chan struct{})
	go func() { _ = cmd.Wait(); close(exited) }()
	t.Cleanup(func() { _ = cmd.Process.Kill() })
	return cmd, exited
}

// Stopping (or restarting) the main core must end exactly the process the
// manager started. Latency / speed probes run the same sing-box binary: the
// old sweep by image path killed them too, so a node tested while the proxy
// restarted was reported unreachable.
func TestStopKillsOnlyTheRecordedCore(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("the image-path sweep was the Windows stop path")
	}
	src, err := os.ReadFile(singboxPath(t))
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	bin := filepath.Join(dir, "sing-box.exe") // private copy: other tests sweep the repo's bin path
	if err := os.WriteFile(bin, src, 0o755); err != nil {
		t.Fatal(err)
	}
	_, probeExited := startIdleCore(t, bin, dir, "probe")
	mainCmd, mainExited := startIdleCore(t, bin, dir, "main")
	time.Sleep(500 * time.Millisecond)

	m := NewManager(bin, dir, nil)
	done := make(chan struct{})
	go func() { <-mainExited; close(done) }()
	m.cmd, m.running, m.done = mainCmd, true, done
	if err := m.Stop(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-mainExited:
	default:
		t.Fatal("Stop must end the core it recorded")
	}
	select {
	case <-probeExited:
		t.Fatal("Stop killed another sing-box from the same path (a latency probe)")
	case <-time.After(300 * time.Millisecond):
	}
}
