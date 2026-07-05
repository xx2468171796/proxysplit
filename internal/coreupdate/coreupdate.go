// Package coreupdate keeps the bundled sing-box binary current with the latest
// GitHub release. Because GitHub (api/objects) is blocked behind the GFW,
// requests are normally routed THROUGH the running node via a local SOCKS5
// proxy.
package coreupdate

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/net/proxy"
)

// releaseURL is the GitHub API endpoint for the latest sing-box release.
const releaseURL = "https://api.github.com/repos/SagerNet/sing-box/releases/latest"

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
	} `json:"assets"`
}

// newClient builds an *http.Client with a 60s timeout. When viaProxy
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
	return &http.Client{Transport: tr, Timeout: 60 * time.Second}, nil
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
	client, err := newClient(viaProxy)
	if err != nil {
		return "", err
	}
	rel, err := fetchRelease(client)
	if err != nil {
		return "", err
	}
	version := strings.TrimPrefix(rel.TagName, "v")

	// Pick the windows-amd64 zip that is NOT the "legacy" (older-CPU) build.
	var downloadURL string
	for _, a := range rel.Assets {
		if strings.HasSuffix(a.Name, "windows-amd64.zip") && !strings.Contains(a.Name, "legacy") {
			downloadURL = a.DownloadURL
			break
		}
	}
	if downloadURL == "" {
		return "", fmt.Errorf("no windows-amd64 asset found in release %s", rel.TagName)
	}

	// Download the zip into memory (bounded).
	zipBytes, err := download(client, downloadURL)
	if err != nil {
		return "", err
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
	tmp := filepath.Join(destDir, "sing-box.exe.tmp")
	dst := filepath.Join(destDir, "sing-box.exe")
	old := dst + ".old"
	if err := os.WriteFile(tmp, exe, 0o644); err != nil {
		return "", fmt.Errorf("write temp: %w", err)
	}
	_ = os.Remove(old)
	_ = os.Rename(dst, old) // ignore error if dst is absent
	if err := os.Rename(tmp, dst); err != nil {
		_ = os.Rename(old, dst) // roll back
		_ = os.Remove(tmp)
		return "", fmt.Errorf("replace sing-box.exe: %w", err)
	}
	_ = os.Remove(old) // best-effort; if still locked it is removed on next start
	return version, nil
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
