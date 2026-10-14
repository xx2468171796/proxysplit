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
	URL     string // absolute download URL = origin (raw .exe, or a zip containing sing-box.exe)
	// URLs are optional mirrors of URL (same bytes), best first. The origin is
	// always tried last, whether or not it is listed here.
	URLs   []string
	SHA256 string // of the downloaded artifact
}

// NeedsRelease reports whether the panel-published version should replace the
// installed core: true only when it is strictly newer (compareCore: never
// downgrade, never go back from a platform build to an official one). An
// unknown installed version counts as older. Errors only for an invalid
// offered version.
func NeedsRelease(installed, offered string) (bool, error) {
	want, ok := parseCoreVersion(offered)
	if !ok || (want.suffix != "" && want.relayops < 0) {
		return false, fmt.Errorf("服务器提供的内核版本无效：%q", offered)
	}
	cur, ok := parseCoreVersion(installed)
	if !ok {
		return true, nil
	}
	return compareCore(cur, want) < 0, nil
}

// InstallRelease downloads and installs a panel-published core when it is
// newer than installed (see NeedsRelease). The download is tried directly
// first, then through viaProxy (the running node) if given. Returns the
// resulting version. The replaced core is kept as sing-box.exe.old (see
// Rollback / ClearBackup); a leftover backup that is still locked fails with
// ErrBackupBusy before anything is downloaded.
func InstallRelease(destDir, installed string, r Release, viaProxy string) (string, error) {
	need, err := NeedsRelease(installed, r.Version)
	if err != nil {
		return "", err
	}
	expected := strings.ToLower(strings.TrimSpace(r.SHA256))
	if len(expected) != 64 {
		return "", fmt.Errorf("服务器提供的内核校验值无效")
	}
	if _, err := hex.DecodeString(expected); err != nil {
		return "", fmt.Errorf("服务器提供的内核校验值无效")
	}
	if !need {
		if older, _ := NeedsRelease(r.Version, installed); !older {
			return installed, nil // already current (same version)
		}
		return installed, fmt.Errorf("当前内核 %s 不低于服务器版本 %s，无需更新", installed, r.Version)
	}

	installMu.Lock()
	defer installMu.Unlock()
	if err := clearBackupLocked(destDir); err != nil {
		return "", err
	}
	var body []byte
	if mirrors := candidateURLs(r.URLs, r.URL); len(mirrors) > 0 {
		// Mirrors first (fastest first, resumable), origin always last.
		if body, err = fetchMultiSource(destDir, mirrors, r.URL, expected, viaProxy); err != nil {
			return "", err
		}
	} else {
		body, err = fetchArtifact(r.URL, "")
		if err != nil && viaProxy != "" {
			body, err = fetchArtifact(r.URL, viaProxy)
		}
		if err != nil {
			return "", err
		}
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
	backupMarkerLocked(destDir)
	if err := installBinary(destDir, exe, true); err != nil {
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
