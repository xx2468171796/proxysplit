package service

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"proxysplit/internal/core"
	"proxysplit/internal/coreupdate"
	"proxysplit/internal/nodes"
)

// Real sing-box, real files, no TUN / system proxy (a 127.0.0.1 mixed inbound
// only): a running core is restarted on a newly installed kernel; a kernel
// that cannot start is rolled back and the proxy comes back on the old one.
func TestCoreRestartAndRollbackWithRealCore(t *testing.T) {
	real, err := os.ReadFile(filepath.Join("..", "..", "bin", "sing-box.exe"))
	if err != nil {
		t.Skip("sing-box.exe not present")
	}
	binDir, dataDir := t.TempDir(), t.TempDir()
	exePath := filepath.Join(binDir, "sing-box.exe") // private copy, see routing_matrix_test
	if err := os.WriteFile(exePath, real, 0o755); err != nil {
		t.Fatal(err)
	}
	node, err := nodes.ParseLink("vless://11111111-2222-3333-4444-555555555555@127.0.0.1:9?encryption=none&security=reality&sni=www.microsoft.com&fp=chrome&pbk=jNXHt1yRo0vDuchQlIP6Z0ZvjT3KtzVI-T4E7RoLJS0&sid=0123abcd&type=tcp&flow=xtls-rprx-vision#N")
	if err != nil {
		t.Fatal(err)
	}
	m := core.NewManager(exePath, dataDir, nil)
	start := func() error {
		_, err := m.Start(node, 0, "error", core.Options{RouteMode: core.RouteGlobal})
		return err
	}
	stop := func() { _ = m.Stop() }
	if err := start(); err != nil {
		t.Fatal(err)
	}
	defer stop()

	install := func(exe []byte, version, installed string) {
		t.Helper()
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(exe) }))
		defer srv.Close()
		sum := sha256.Sum256(exe)
		if _, err := coreupdate.InstallRelease(binDir, installed, coreupdate.Release{Version: version, URL: srv.URL, SHA256: hex.EncodeToString(sum[:])}, ""); err != nil {
			t.Fatalf("install %s over the running core: %v", version, err)
		}
	}
	rollback := func() error { return coreupdate.Rollback(binDir) }

	// 1. A good newer kernel (same binary + overlay, different hash): restart, keep it.
	good := append(append([]byte{}, real...), []byte("overlay")...)
	install(good, "99.0.0-relayops.1", "")
	rb, err := restartWithRollback(stop, start, rollback)
	if rb || err != nil || !m.Running() {
		t.Fatalf("restart on good core: rolledBack=%v err=%v running=%v", rb, err, m.Running())
	}
	if err := coreupdate.ClearBackup(binDir); err != nil {
		t.Fatalf("old core still locked after restart: %v", err)
	}

	// 2. A broken kernel: the start fails, the good one is put back and runs.
	broken := make([]byte, 2<<20)
	copy(broken, "MZ")
	install(broken, "99.0.0-relayops.2", "99.0.0-relayops.1")
	rb, err = restartWithRollback(stop, start, rollback)
	if !rb || err == nil || !strings.Contains(err.Error(), "已换回旧内核并恢复运行") {
		t.Fatalf("broken core: rolledBack=%v err=%v", rb, err)
	}
	if !m.Running() {
		t.Fatal("proxy not running after rollback")
	}
	if got, _ := os.ReadFile(exePath); !bytes.Equal(got, good) {
		t.Fatal("rollback did not restore the previous kernel")
	}
	if got := coreupdate.InstalledVersion(binDir); got != "99.0.0-relayops.1" {
		t.Fatalf("version after rollback %q", got)
	}
}
