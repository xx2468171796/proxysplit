package coreupdate

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestParseVersionOutputRelayops(t *testing.T) {
	out := "sing-box version 1.14.2\r\n\r\nEnvironment: go1.26.8 windows/amd64\r\nTags: with_quic,relayops_prefer_first,relayops_user_limits\r\n"
	if got := parseVersionOutput(out); got != "1.14.2-relayops.0" {
		t.Fatalf("got %q", got)
	}
	if got := parseVersionOutput("sing-box version 1.14.1\nTags: with_quic\n"); got != "1.14.1" {
		t.Fatalf("got %q", got)
	}
}

func TestInstallReleaseVerifiesAndWritesMarker(t *testing.T) {
	exe := append(append([]byte(nil), exeMagic...), make([]byte, minExeBytes+10)...)
	sum := sha256.Sum256(exe)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(exe) }))
	defer srv.Close()
	dir := t.TempDir()
	if _, err := InstallRelease(dir, "1.14.1", Release{Version: "1.14.2-relayops.6", URL: srv.URL, SHA256: hex.EncodeToString(make([]byte, 32))}, ""); err == nil {
		t.Fatal("bad sha accepted")
	}
	v, err := InstallRelease(dir, "1.14.1", Release{Version: "1.14.2-relayops.6", URL: srv.URL, SHA256: hex.EncodeToString(sum[:])}, "")
	if err != nil || v != "1.14.2-relayops.6" {
		t.Fatal(v, err)
	}
	if got := InstalledVersion(dir); got != "1.14.2-relayops.6" {
		t.Fatalf("marker version %q", got)
	}
	if _, err := InstallRelease(dir, "1.14.2-relayops.7", Release{Version: "1.14.2-relayops.6", URL: srv.URL, SHA256: hex.EncodeToString(sum[:])}, ""); err == nil {
		t.Fatal("downgrade allowed")
	}
	if _, err := os.Stat(filepath.Join(dir, SingBoxExe)); err != nil {
		t.Fatal(err)
	}
}
