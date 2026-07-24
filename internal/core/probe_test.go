package core

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"proxysplit/internal/nodes"
)

func TestStartProbeRejectsMissingBinaryWithoutLeavingFiles(t *testing.T) {
	base := t.TempDir()
	_, err := StartProbe(
		filepath.Join(base, "missing-sing-box.exe"),
		filepath.Join(base, "probes"),
		&nodes.Node{ID: "n1", Name: "test", Type: "socks", Server: "127.0.0.1", Port: 1080},
		10*time.Millisecond,
	)
	if err == nil || !strings.Contains(err.Error(), "binary not found") {
		t.Fatalf("expected missing binary error, got %v", err)
	}
}
