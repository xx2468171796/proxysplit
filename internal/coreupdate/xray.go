package coreupdate

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Xray sidecar core (internal/xray). Pinned in bin/xray-release.json, separate
// from core-release.json so the sing-box / POWER云 panel contract is untouched.
// Same rules as sing-box: fixed source, SHA256 before install, atomic replace
// with xray.exe.old kept for RollbackXray. Not auto-followed: it changes only
// with a client release (bundled) or the lazy download of that same pin.

// XrayExe is the sidecar's file name in the bin directory.
const XrayExe = "xray.exe"

// XrayRelease is bin/xray-release.json (fields the client uses).
type XrayRelease struct {
	Version string `json:"version"`
	SHA256  string `json:"sha256"`
	// URLs are public download locations for the lazy install (mirrors first,
	// origin last). The build-time "url" (company Gitea, token) is not used by
	// clients: it is unreachable from customer machines.
	URLs []string `json:"urls,omitempty"`
}

// ParseXrayRelease decodes and checks bin/xray-release.json.
func ParseXrayRelease(raw []byte) (XrayRelease, error) {
	var r XrayRelease
	if err := json.Unmarshal(raw, &r); err != nil {
		return r, err
	}
	if len(r.SHA256) != 64 {
		return r, fmt.Errorf("xray-release.json 没有有效的 sha256")
	}
	r.SHA256 = strings.ToLower(r.SHA256)
	return r, nil
}

func xrayPath(dir string) string       { return filepath.Join(dir, XrayExe) }
func xrayBackupPath(dir string) string { return filepath.Join(dir, XrayExe+".old") }

// XrayInstalled reports whether dir/xray.exe is exactly the pinned build.
func XrayInstalled(dir string, r XrayRelease) bool {
	data, err := os.ReadFile(xrayPath(dir))
	if err != nil {
		return false
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]) == r.SHA256
}

// EnsureBundledXray installs the xray.exe embedded in the client when the
// installed one differs from the pin (missing, older or damaged).
func EnsureBundledXray(dir string, exe []byte, r XrayRelease) error {
	if XrayInstalled(dir, r) {
		return nil
	}
	return InstallXray(dir, exe, r.SHA256)
}

// FetchXray downloads the pinned xray.exe (mirrors, then origin — the last
// URL — direct and then through viaProxy) and installs it.
func FetchXray(dir string, r XrayRelease, viaProxy string) error {
	if XrayInstalled(dir, r) {
		return nil
	}
	if len(r.URLs) == 0 {
		return fmt.Errorf("没有可用的下载源（这个版本没有内置 Xray）")
	}
	origin := r.URLs[len(r.URLs)-1]
	body, err := fetchMultiSource(dir, candidateURLs(r.URLs[:len(r.URLs)-1], origin), origin, r.SHA256, viaProxy)
	if err != nil {
		return err
	}
	return InstallXray(dir, body, r.SHA256)
}

// InstallXray verifies exe against expected and atomically replaces
// dir/xray.exe, keeping the previous file as xray.exe.old.
func InstallXray(dir string, exe []byte, expected string) error {
	sum := sha256.Sum256(exe)
	if hex.EncodeToString(sum[:]) != strings.ToLower(expected) {
		return fmt.Errorf("Xray %w", errSHAMismatch)
	}
	if len(exe) < minExeBytes || !bytes.HasPrefix(exe, peMagic) {
		return fmt.Errorf("Xray 内核文件无效")
	}
	installMu.Lock()
	defer installMu.Unlock()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, "xray-*.tmp")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	_, werr := f.Write(exe)
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	if werr != nil {
		return werr
	}
	dst, old := xrayPath(dir), xrayBackupPath(dir)
	if err := retry(func() error { return os.Remove(old) }); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("%w: %v", ErrBackupBusy, err)
	}
	moved := false
	if err := retry(func() error { return os.Rename(dst, old) }); err == nil {
		moved = true
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("备份 Xray 内核失败：%w", err)
	}
	if err := os.Rename(tmp, dst); err != nil {
		if moved {
			_ = os.Rename(old, dst)
		}
		return fmt.Errorf("替换 Xray 内核失败：%w", err)
	}
	return nil
}

// RollbackXray puts xray.exe.old back (the sidecar must be stopped).
func RollbackXray(dir string) error {
	installMu.Lock()
	defer installMu.Unlock()
	if _, err := os.Stat(xrayBackupPath(dir)); err != nil {
		return fmt.Errorf("没有可回滚的旧 Xray 内核")
	}
	if err := retry(func() error { return os.Remove(xrayPath(dir)) }); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("%w: %v", ErrBackupBusy, err)
	}
	return retry(func() error { return os.Rename(xrayBackupPath(dir), xrayPath(dir)) })
}
