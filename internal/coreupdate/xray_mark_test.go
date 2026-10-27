package coreupdate

import (
	"os"
	"testing"
)

// The hash marker skips re-hashing an unchanged xray.exe and is invalidated
// when the file changes (size / mtime); the embedded payload is only read
// when an install is actually needed.
func TestXrayHashMarker(t *testing.T) {
	dir := t.TempDir()
	v1, sum1 := fakeXray(1)
	if err := InstallXray(dir, v1, sum1); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(xrayMarkPath(dir)); err != nil {
		t.Fatalf("no marker after install: %v", err)
	}
	if !XrayInstalled(dir, XrayRelease{SHA256: sum1}) {
		t.Fatal("installed build not recognised")
	}
	if err := os.WriteFile(xrayPath(dir), append(append([]byte(nil), v1...), 0), 0o600); err != nil {
		t.Fatal(err)
	}
	if XrayInstalled(dir, XrayRelease{SHA256: sum1}) {
		t.Fatal("stale marker trusted after the file changed")
	}
	loads := 0
	load := func() ([]byte, error) { loads++; return v1, nil }
	if err := EnsureBundledXray(dir, load, XrayRelease{SHA256: sum1}); err != nil || loads != 1 {
		t.Fatalf("reinstall: %v loads=%d", err, loads)
	}
	if err := EnsureBundledXray(dir, load, XrayRelease{SHA256: sum1}); err != nil || loads != 1 {
		t.Fatalf("up-to-date install loaded the payload again: %v loads=%d", err, loads)
	}
}
