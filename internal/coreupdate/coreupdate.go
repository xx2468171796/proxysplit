// Package coreupdate keeps the bundled sing-box binary current with the latest
// GitHub release. Because GitHub (api/objects) is blocked behind the GFW,
// requests are normally routed THROUGH the running node via a local SOCKS5
// proxy.
package coreupdate

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/proxy"
)

// releaseURL is the GitHub API endpoint for the latest sing-box release.
const releaseURL = "https://api.github.com/repos/SagerNet/sing-box/releases/latest"

var installMu sync.Mutex

// maxZipBytes caps how much of the release zip we will read into memory. The
// windows-amd64 build is a few MB; 80MB is a generous safety ceiling.
const maxZipBytes = 80 << 20 // 80MB

// maxExeBytes caps how much of the extracted sing-box.exe we will read. The
// binary is ~30-40MB; 80MB is a generous safety ceiling.
const maxExeBytes = 80 << 20 // 80MB

// minExeBytes is a sanity floor: a real sing-box.exe is well over 1MB, so a
// smaller "MZ" file is almost certainly a stub or corruption.
const minExeBytes = 1 << 20 // 1MB

// peMagic is the leading magic of a Windows PE executable ("MZ").
var peMagic = []byte{0x4D, 0x5A}

// release is the subset of the GitHub release JSON we care about.
type release struct {
	TagName string `json:"tag_name"`
	Assets  []struct {
		Name        string `json:"name"`
		DownloadURL string `json:"browser_download_url"`
		Digest      string `json:"digest"`
	} `json:"assets"`
}

// newClient builds an *http.Client with a bounded download timeout. When viaProxy
// (host:port SOCKS5) is non-empty, requests are routed THROUGH it (essential:
// GitHub is blocked behind the GFW, so we fetch through the running node).
func newClient(viaProxy string) (*http.Client, error) {
	tr := &http.Transport{}
	if viaProxy != "" {
		d, err := proxy.SOCKS5("tcp", viaProxy, nil, proxy.Direct)
		if err != nil {
			return nil, fmt.Errorf("socks dialer: %w", err)
		}
		cd, ok := d.(proxy.ContextDialer)
		if !ok {
			return nil, fmt.Errorf("socks dialer lacks DialContext")
		}
		// Use the context-aware dial so the client Timeout can cancel a stalled
		// SOCKS handshake (otherwise the dial goroutine/conn would leak).
		tr.DialContext = cd.DialContext
	}
	return &http.Client{Transport: tr, Timeout: 5 * time.Minute}, nil
}

// fetchRelease GETs the latest release JSON and decodes it.
func fetchRelease(client *http.Client) (*release, error) {
	req, err := http.NewRequest(http.MethodGet, releaseURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("User-Agent", "ProxySplit")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch release: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch release: unexpected status %s", resp.Status)
	}

	var rel release
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return nil, fmt.Errorf("decode release JSON: %w", err)
	}
	return &rel, nil
}

// LatestVersion returns the newest sing-box release version (e.g. "1.13.15").
// viaProxy (host:port SOCKS5) routes the GitHub request through the running node
// when set.
func LatestVersion(viaProxy string) (string, error) {
	client, err := newClient(viaProxy)
	if err != nil {
		return "", err
	}
	defer client.CloseIdleConnections()
	rel, err := fetchRelease(client)
	if err != nil {
		return "", err
	}
	if rel.TagName == "" {
		return "", fmt.Errorf("release has empty tag_name")
	}
	return strings.TrimPrefix(rel.TagName, "v"), nil
}

// Update downloads the latest sing-box windows-amd64 build, extracts sing-box.exe
// and atomically replaces the copy in destDir. Returns the new version. viaProxy
// routes downloads through the node (GitHub is blocked behind the GFW).
//
// The extracted binary is validated (PE "MZ" magic, > 1MB) and written
// atomically (temp file + os.Rename), so a failed or partial download never
// corrupts the existing binary on disk.
func Update(destDir, viaProxy string) (string, error) {
	installMu.Lock()
	defer installMu.Unlock()
	client, err := newClient(viaProxy)
	if err != nil {
		return "", err
	}
	defer client.CloseIdleConnections()
	return updateWithClient(destDir, client)
}

func updateWithClient(destDir string, client *http.Client) (string, error) {
	rel, err := fetchRelease(client)
	if err != nil {
		return "", err
	}
	version := strings.TrimPrefix(rel.TagName, "v")
	if _, err := needsBundledUpgrade("", version); err != nil {
		return "", err
	}

	// Pick the windows-amd64 zip that is NOT the "legacy" (older-CPU) build.
	var downloadURL, assetName, checksumURL, digest string
	for _, a := range rel.Assets {
		if strings.HasSuffix(a.Name, "windows-amd64.zip") && !strings.Contains(a.Name, "legacy") {
			downloadURL, assetName = a.DownloadURL, a.Name
			digest = a.Digest
		}
		if strings.Contains(strings.ToLower(a.Name), "checksums") && strings.HasSuffix(strings.ToLower(a.Name), ".txt") {
			checksumURL = a.DownloadURL
		}
	}
	if downloadURL == "" {
		return "", fmt.Errorf("no windows-amd64 asset found in release %s", rel.TagName)
	}
	expected, err := releaseChecksum(client, digest, checksumURL, assetName)
	if err != nil {
		return "", err
	}

	// Download the zip into memory (bounded).
	zipBytes, err := download(client, downloadURL)
	if err != nil {
		return "", err
	}
	actual := sha256.Sum256(zipBytes)
	if !strings.EqualFold(expected, hex.EncodeToString(actual[:])) {
		return "", fmt.Errorf("release zip SHA256 mismatch")
	}

	// Extract sing-box.exe from the zip.
	exe, err := extractExe(zipBytes)
	if err != nil {
		return "", err
	}

	// Validate: PE magic and size floor.
	if len(exe) < len(peMagic) || !bytes.Equal(exe[:len(peMagic)], peMagic) {
		return "", fmt.Errorf("invalid sing-box.exe: missing PE magic (got %d bytes)", len(exe))
	}
	if len(exe) <= minExeBytes {
		return "", fmt.Errorf("invalid sing-box.exe: only %d bytes (expected > %d)", len(exe), minExeBytes)
	}

	// Write to a temp file, then swap it in. On Windows the running sing-box.exe
	// is locked and cannot be deleted, but a running image CAN be renamed aside —
	// so move the current binary to .old first, then move the new one into place.
	// The .old file is cleaned up on the next launch (it may still be locked now).
	if err := installBinary(destDir, exe); err != nil {
		return "", err
	}
	return version, nil
}

// GitHub now publishes a SHA256 digest on each release asset. Older releases
// may have only a checksum file. Missing or malformed integrity data fails closed.
func releaseChecksum(client *http.Client, digest, checksumURL, assetName string) (string, error) {
	if digest != "" {
		hash := strings.TrimPrefix(digest, "sha256:")
		if !strings.HasPrefix(digest, "sha256:") || len(hash) != 64 {
			return "", fmt.Errorf("invalid release asset SHA256 digest")
		}
		if _, err := hex.DecodeString(hash); err != nil {
			return "", fmt.Errorf("invalid release asset SHA256 digest: %w", err)
		}
		return strings.ToLower(hash), nil
	}
	if checksumURL == "" {
		return "", fmt.Errorf("release has neither a SHA256 digest nor a checksum manifest")
	}
	checksums, err := download(client, checksumURL)
	if err != nil {
		return "", fmt.Errorf("download checksum manifest: %w", err)
	}
	return checksumForAsset(checksums, assetName)
}

func installBinary(destDir string, exe []byte) error {
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return err
	}
	f, err := os.CreateTemp(destDir, "sing-box-*.tmp")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	_, writeErr := f.Write(exe)
	closeErr := f.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	dst := filepath.Join(destDir, "sing-box.exe")
	old := dst + ".old"
	if err := os.Remove(old); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("previous core still in use; restart before updating: %w", err)
	}
	moved := false
	if err := os.Rename(dst, old); err == nil {
		moved = true
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("backup core: %w", err)
	}
	if err := os.Rename(tmp, dst); err != nil {
		if moved {
			if rollbackErr := os.Rename(old, dst); rollbackErr != nil {
				return fmt.Errorf("replace core: %v; restore from %s: %w", err, old, rollbackErr)
			}
		}
		return fmt.Errorf("replace core: %w", err)
	}
	_ = os.Remove(old)
	return nil
}

func checksumForAsset(manifest []byte, assetName string) (string, error) {
	for _, line := range strings.Split(string(manifest), "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 2 {
			continue
		}
		name := strings.TrimPrefix(fields[len(fields)-1], "*")
		if path.Base(strings.ReplaceAll(name, "\\", "/")) == assetName && len(fields[0]) == 64 {
			if _, err := hex.DecodeString(fields[0]); err == nil {
				return strings.ToLower(fields[0]), nil
			}
		}
	}
	return "", fmt.Errorf("checksum for %s not found", assetName)
}

// download fetches url through client and returns the body (bounded to
// maxZipBytes).
func download(client *http.Client, url string) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("User-Agent", "ProxySplit")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("download %q: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download %q: unexpected status %s", url, resp.Status)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxZipBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read download body: %w", err)
	}
	if len(body) > maxZipBytes {
		return nil, fmt.Errorf("release zip exceeds %d bytes", maxZipBytes)
	}
	return body, nil
}

// extractExe opens the release zip and returns the bytes of the single entry
// whose base name is "sing-box.exe" (it lives inside a top-level folder).
func extractExe(zipBytes []byte) ([]byte, error) {
	zr, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		return nil, fmt.Errorf("open zip: %w", err)
	}

	for _, f := range zr.File {
		// Match only by base name; we never use the (attacker-controlled) path
		// to write a file, so there is no zip-slip exposure here.
		if path.Base(f.Name) != "sing-box.exe" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, fmt.Errorf("open zip entry %q: %w", f.Name, err)
		}
		defer rc.Close()

		exe, err := io.ReadAll(io.LimitReader(rc, maxExeBytes+1))
		if err != nil {
			return nil, fmt.Errorf("read zip entry %q: %w", f.Name, err)
		}
		if len(exe) > maxExeBytes {
			return nil, fmt.Errorf("sing-box.exe exceeds %d bytes", maxExeBytes)
		}
		return exe, nil
	}
	return nil, fmt.Errorf("sing-box.exe not found in release zip")
}
