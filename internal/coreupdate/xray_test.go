package coreupdate

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func fakeXray(fill byte) ([]byte, string) {
	exe := append([]byte("MZ"), bytes.Repeat([]byte{fill}, minExeBytes)...)
	sum := sha256.Sum256(exe)
	return exe, hex.EncodeToString(sum[:])
}

func TestInstallXrayVerifiesAndKeepsBackup(t *testing.T) {
	dir := t.TempDir()
	v1, sum1 := fakeXray(1)
	v2, sum2 := fakeXray(2)
	if err := InstallXray(dir, v1, sum2); err == nil {
		t.Fatal("sha256 mismatch accepted")
	}
	if err := InstallXray(dir, v1, sum1); err != nil {
		t.Fatal(err)
	}
	r2 := XrayRelease{Version: "2", SHA256: sum2}
	if XrayInstalled(dir, r2) {
		t.Fatal("v1 reported as v2")
	}
	if err := EnsureBundledXray(dir, v2, r2); err != nil || !XrayInstalled(dir, r2) {
		t.Fatalf("upgrade to bundled: %v", err)
	}
	if old, _ := os.ReadFile(filepath.Join(dir, XrayExe+".old")); !bytes.Equal(old, v1) {
		t.Fatal("previous xray.exe not kept")
	}
	if err := RollbackXray(dir); err != nil || !XrayInstalled(dir, XrayRelease{SHA256: sum1}) {
		t.Fatalf("rollback: %v", err)
	}
	if err := RollbackXray(dir); err == nil {
		t.Fatal("second rollback without backup accepted")
	}
}

func TestFetchXrayFromURLs(t *testing.T) {
	exe, sum := fakeXray(3)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(exe) }))
	defer srv.Close()
	dir := t.TempDir()
	r := XrayRelease{Version: "3", SHA256: sum}
	if err := FetchXray(dir, r, ""); err == nil {
		t.Fatal("no URLs must fail with a clear error")
	}
	r.URLs = []string{srv.URL + "/xray.exe"}
	if err := FetchXray(dir, r, ""); err != nil || !XrayInstalled(dir, r) {
		t.Fatalf("fetch: %v", err)
	}
}

func TestParseXrayReleaseFile(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "bin", "xray-release.json"))
	if err != nil {
		t.Fatal(err)
	}
	r, err := ParseXrayRelease(raw)
	if err != nil || r.Version == "" {
		t.Fatalf("bin/xray-release.json: %v %+v", err, r)
	}
	if _, err := ParseXrayRelease([]byte(`{"version":"1","sha256":""}`)); err == nil {
		t.Fatal("empty sha256 accepted")
	}
}
