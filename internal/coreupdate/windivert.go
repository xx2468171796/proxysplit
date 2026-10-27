package coreupdate

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
)

// WinDivert 2.2.2 x64 (official basil00 release) for 仅接管选中程序. Not
// embedded in proxysplit.exe: Defender has flagged the WinDivert package
// (basil00/WinDivert#411), and embedding would risk the main exe being
// quarantined for every user. It is downloaded from our own site only when a
// user switches to that mode; scripts/fetch-core.ps1 pins the same hashes.
const winDivertBase = "https://proxysplit.zygskins.cn/download/windivert/2.2.2/"

var winDivertFiles = map[string]string{
	"WinDivert.dll":   "c1e060ee19444a259b2162f8af0f3fe8c4428a1c6f694dce20de194ac8d7d9a2",
	"WinDivert64.sys": "8da085332782708d8767bcace5327a6ec7283c17cfb85e40b03cd2323a90ddc2",
}

// EnsureWinDivert makes sure dir holds the pinned WinDivert files, downloading
// the missing or damaged ones (sha256-verified). A loaded driver keeps
// WinDivert64.sys open, so files that already match are never rewritten.
func EnsureWinDivert(dir string) error {
	for name, want := range winDivertFiles {
		dst := filepath.Join(dir, name)
		if fileSHA256(dst) == want {
			continue
		}
		body, err := fetchMultiSource(dir, nil, winDivertBase+name, want, "")
		if err != nil {
			return fmt.Errorf("下载 %s 失败: %w", name, err)
		}
		if err := writeIfChanged(dst, body); err != nil {
			return err
		}
	}
	return nil
}

// WinDivertReady reports whether dir already holds the pinned files (no
// network; safe to call under locks).
func WinDivertReady(dir string) bool {
	for name, want := range winDivertFiles {
		if fileSHA256(filepath.Join(dir, name)) != want {
			return false
		}
	}
	return true
}

func fileSHA256(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func writeIfChanged(dst string, data []byte) error {
	if old, err := os.ReadFile(dst); err == nil && bytes.Equal(old, data) {
		return nil
	}
	tmp := dst + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, dst)
}
