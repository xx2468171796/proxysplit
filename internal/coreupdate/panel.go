package coreupdate

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

// Release is a core build announced by the POWER云 panel
// (GET /api/client/core, already signature-verified by the caller).
type Release struct {
	Version string // e.g. "1.14.2-relayops.6"
	URL     string // absolute download URL (raw .exe, or a zip containing sing-box.exe)
	SHA256  string // of the downloaded artifact
}

// InstallRelease downloads and installs a panel-published core when it is
// newer than installed (see compareCore: never downgrades, never goes back
// from a platform build to an official one). The download is tried directly
// first, then through viaProxy (the running node) if given. Returns the
// resulting version.
func InstallRelease(destDir, installed string, r Release, viaProxy string) (string, error) {
	want, ok := parseCoreVersion(r.Version)
	if !ok || (want.suffix != "" && want.relayops < 0) {
		return "", fmt.Errorf("服务器提供的内核版本无效：%q", r.Version)
	}
	expected := strings.ToLower(strings.TrimSpace(r.SHA256))
	if len(expected) != 64 {
		return "", fmt.Errorf("服务器提供的内核校验值无效")
	}
	if _, err := hex.DecodeString(expected); err != nil {
		return "", fmt.Errorf("服务器提供的内核校验值无效")
	}
	if cur, ok := parseCoreVersion(installed); ok {
		switch c := compareCore(cur, want); {
		case c == 0:
			return installed, nil // already current
		case c > 0:
			return installed, fmt.Errorf("当前内核 %s 不低于服务器版本 %s，无需更新", installed, r.Version)
		}
	}

	installMu.Lock()
	defer installMu.Unlock()
	body, err := fetchArtifact(r.URL, "")
	if err != nil && viaProxy != "" {
		body, err = fetchArtifact(r.URL, viaProxy)
	}
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(body)
	if hex.EncodeToString(sum[:]) != expected {
		return "", fmt.Errorf("内核文件 SHA256 校验失败")
	}
	exe := body
	if bytes.HasPrefix(body, []byte("PK")) {
		if exe, err = extractExe(body); err != nil {
			return "", err
		}
	}
	if len(exe) < len(peMagic) || !bytes.Equal(exe[:len(peMagic)], peMagic) {
		return "", fmt.Errorf("invalid sing-box.exe: missing PE magic (got %d bytes)", len(exe))
	}
	if len(exe) <= minExeBytes {
		return "", fmt.Errorf("invalid sing-box.exe: only %d bytes (expected > %d)", len(exe), minExeBytes)
	}
	if err := installBinary(destDir, exe); err != nil {
		return "", err
	}
	exeSum := sha256.Sum256(exe)
	_ = writeMarker(destDir, r.Version, exeSum[:])
	return r.Version, nil
}

func fetchArtifact(url, viaProxy string) ([]byte, error) {
	client, err := newClient(viaProxy)
	if err != nil {
		return nil, err
	}
	defer client.CloseIdleConnections()
	return download(client, url)
}
