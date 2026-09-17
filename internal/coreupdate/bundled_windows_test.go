package coreupdate

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func TestEnsureBundledWithRealCore(t *testing.T) {
	core, err := os.ReadFile(filepath.Join("..", "..", "bin", "sing-box.exe"))
	if err != nil {
		t.Fatal("fetch the pinned core before testing: ", err)
	}
	hash := sha256.Sum256(core)
	for _, tc := range []struct {
		name, bundleVersion string
		replaced            bool
	}{
		{"upgrade older installed core", "99.0.0", true},
		{"preserve newer installed core", "0.1.0", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			dst := filepath.Join(dir, "sing-box.exe")
			// A PE overlay keeps the official executable runnable while ensuring
			// its bytes differ, exercising the real bounded version query.
			installed := append(append([]byte{}, core...), []byte("test-overlay")...)
			if err := os.WriteFile(dst, installed, 0o700); err != nil {
				t.Fatal(err)
			}
			if err := EnsureBundled(dir, core, tc.bundleVersion, hex.EncodeToString(hash[:])); err != nil {
				t.Fatal(err)
			}
			got, err := os.ReadFile(dst)
			if err != nil {
				t.Fatal(err)
			}
			want := installed
			if tc.replaced {
				want = core
			}
			if !bytes.Equal(got, want) {
				t.Fatal("core upgrade/preservation contract failed")
			}
			if err := EnsureBundled(dir, core, tc.bundleVersion, "invalid"); err == nil {
				t.Fatal("invalid embedded hash accepted")
			}
		})
	}
}
