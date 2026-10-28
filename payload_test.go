//go:build windows

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"proxysplit/internal/coreupdate"
	"testing"
)

func TestEmbeddedPayloadInstallAndPreserveRules(t *testing.T) {
	// UserConfigDir uses APPDATA on Windows. Never touch a real installation.
	t.Setenv("APPDATA", t.TempDir())
	dir, err := ensurePayload()
	if err != nil {
		t.Fatal(err)
	}
	metadata, err := coreFS.ReadFile(coreMetaFile)
	if err != nil {
		t.Fatal(err)
	}
	var release struct {
		SHA256 string `json:"sha256"`
	}
	if err := json.Unmarshal(metadata, &release); err != nil {
		t.Fatal(err)
	}
	exe, err := os.ReadFile(filepath.Join(dir, coreupdate.SingBoxExe))
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(exe)
	if hex.EncodeToString(hash[:]) != release.SHA256 {
		t.Fatal("installed core differs from pinned release")
	}
	rules := filepath.Join(dir, "geoip-cn.srs")
	if err := os.WriteFile(rules, []byte("user-updated-rules"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ensurePayload(); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(rules)
	if err != nil || string(got) != "user-updated-rules" {
		t.Fatal("restart overwrote rule sets")
	}
}
