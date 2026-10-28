package coreupdate

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// fakeExe is a native-executable-looking payload above minExeBytes.
func fakeExe(tag string) []byte {
	b := make([]byte, minExeBytes+1024)
	copy(b, exeMagic)
	copy(b[len(exeMagic):], tag)
	return b
}

func serve(t *testing.T, body []byte) (*httptest.Server, string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(body) }))
	t.Cleanup(srv.Close)
	sum := sha256.Sum256(body)
	return srv, hex.EncodeToString(sum[:])
}

func writeInstalled(t *testing.T, dir string, exe []byte, version string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, SingBoxExe), exe, 0o755); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(exe)
	if err := writeMarker(dir, version, sum[:]); err != nil {
		t.Fatal(err)
	}
}

func TestNeedsRelease(t *testing.T) {
	for _, tc := range []struct {
		installed, offered string
		want, err          bool
	}{
		{"1.14.2-relayops.9", "1.14.2-relayops.15", true, false},
		{"1.14.2-relayops.15", "1.14.2-relayops.15", false, false},
		{"1.14.2-relayops.16", "1.14.2-relayops.15", false, false},
		{"1.14.2", "1.14.2-relayops.1", true, false}, // official -> platform
		{"", "1.14.2-relayops.15", true, false},      // unknown installed
		{"1.14.2-relayops.9", "1.14.2-beta.1", false, true},
		{"1.14.2-relayops.9", "garbage", false, true},
	} {
		got, err := NeedsRelease(tc.installed, tc.offered)
		if got != tc.want || (err != nil) != tc.err {
			t.Errorf("NeedsRelease(%q, %q) = %v, %v", tc.installed, tc.offered, got, err)
		}
	}
}

func TestInstallReleaseKeepsBackupAndRollsBack(t *testing.T) {
	dir := t.TempDir()
	oldExe, newExe := fakeExe("old"), fakeExe("new")
	writeInstalled(t, dir, oldExe, "1.14.2-relayops.9")
	srv, sum := serve(t, newExe)

	v, err := InstallRelease(dir, "1.14.2-relayops.9", Release{Version: "1.14.2-relayops.15", URL: srv.URL, SHA256: sum}, "")
	if err != nil || v != "1.14.2-relayops.15" {
		t.Fatalf("install: %q %v", v, err)
	}
	if got := InstalledVersion(dir); got != "1.14.2-relayops.15" {
		t.Fatalf("installed version %q", got)
	}
	if !HasBackup(dir) {
		t.Fatal("previous core not kept for rollback")
	}
	if b, _ := os.ReadFile(backupPath(dir)); !bytes.Equal(b, oldExe) {
		t.Fatal("backup is not the previous core")
	}

	if err := Rollback(dir); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, SingBoxExe)); !bytes.Equal(b, oldExe) {
		t.Fatal("rollback did not restore the previous core")
	}
	if got := InstalledVersion(dir); got != "1.14.2-relayops.9" {
		t.Fatalf("version after rollback %q", got)
	}
	if HasBackup(dir) {
		t.Fatal("backup still present after rollback")
	}
	for _, leftover := range []string{SingBoxExe + failedSuffix, markerFile + ".old"} {
		if _, err := os.Stat(filepath.Join(dir, leftover)); !os.IsNotExist(err) {
			t.Fatalf("%s left behind", leftover)
		}
	}
	if err := Rollback(dir); err == nil {
		t.Fatal("rollback without backup succeeded")
	}

	// Install again, then the new core is good: ClearBackup drops the old one.
	if _, err := InstallRelease(dir, "1.14.2-relayops.9", Release{Version: "1.14.2-relayops.15", URL: srv.URL, SHA256: sum}, ""); err != nil {
		t.Fatal(err)
	}
	if err := ClearBackup(dir); err != nil || HasBackup(dir) {
		t.Fatalf("clear backup: %v", err)
	}
	if _, err := os.Stat(markerBackupPath(dir)); !os.IsNotExist(err) {
		t.Fatal("marker backup left behind")
	}
	if got := InstalledVersion(dir); got != "1.14.2-relayops.15" {
		t.Fatalf("version after clear %q", got)
	}
}

func TestRollbackWithoutPreviousMarker(t *testing.T) {
	dir := t.TempDir()
	oldExe := fakeExe("old")
	if err := os.WriteFile(filepath.Join(dir, SingBoxExe), oldExe, 0o755); err != nil {
		t.Fatal(err)
	}
	srv, sum := serve(t, fakeExe("new"))
	if _, err := InstallRelease(dir, "", Release{Version: "1.14.2-relayops.15", URL: srv.URL, SHA256: sum}, ""); err != nil {
		t.Fatal(err)
	}
	if err := Rollback(dir); err != nil {
		t.Fatal(err)
	}
	// The new core's marker must not survive to mislabel the old executable.
	if _, err := os.Stat(filepath.Join(dir, markerFile)); !os.IsNotExist(err) {
		t.Fatal("new marker kept after rollback to a core without one")
	}
}

func TestInstallReleaseLockedBackup(t *testing.T) {
	dir := t.TempDir()
	writeInstalled(t, dir, fakeExe("old"), "1.14.2-relayops.9")
	saved := releaseWait
	releaseWait = 0
	defer func() { releaseWait = saved }()
	// A non-empty directory cannot be removed: stands in for a locked file.
	if err := os.Mkdir(backupPath(dir), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(backupPath(dir), "x"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++ }))
	defer srv.Close()
	_, err := InstallRelease(dir, "1.14.2-relayops.9", Release{Version: "1.14.2-relayops.15", URL: srv.URL, SHA256: string(bytes.Repeat([]byte("a"), 64))}, "")
	if !errors.Is(err, ErrBackupBusy) {
		t.Fatalf("got %v, want ErrBackupBusy", err)
	}
	if hits != 0 {
		t.Fatal("downloaded although the backup slot is busy")
	}
	if err := ClearBackup(dir); !errors.Is(err, ErrBackupBusy) {
		t.Fatalf("clear: %v", err)
	}
}

func TestDownloadLimitFitsCurrentCore(t *testing.T) {
	// 1.14.2-relayops.15 windows-amd64 is 82,191,360 bytes.
	if maxZipBytes < 82191360*3/2 || maxExeBytes < 82191360*3/2 {
		t.Fatalf("download limits too small for the current core: zip %d exe %d", maxZipBytes, maxExeBytes)
	}
}
