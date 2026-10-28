// Package coreupdate installs sing-box: the bundled core (EnsureBundled) and
// the platform build published by the POWER云 panel (InstallRelease). Downloads
// may be routed THROUGH the running node via a local SOCKS5 proxy.
package coreupdate

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sync"
	"time"

	"golang.org/x/net/proxy"
)

var installMu sync.Mutex

// maxZipBytes caps how much of the downloaded artifact (raw .exe or a zip
// holding it) we will read into memory. The platform windows-amd64 build is
// ~82MB (1.14.2-relayops.15); 160MB leaves room for growth.
const maxZipBytes = 160 << 20 // 160MB

// maxExeBytes caps how much of the extracted sing-box.exe we will read.
const maxExeBytes = 160 << 20 // 160MB

// minExeBytes is a sanity floor: a real sing-box.exe is well over 1MB, so a
// smaller "MZ" file is almost certainly a stub or corruption.
const minExeBytes = 1 << 20 // 1MB

// newClient builds an *http.Client with a bounded download timeout. When viaProxy
// (host:port SOCKS5) is non-empty, requests are routed THROUGH it (the
// fallback when the download host is unreachable directly).
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

// installBinary atomically replaces destDir/sing-box.exe with exe. The
// previous file is moved to sing-box.exe.old; keepBackup leaves it there so a
// core that fails to start can be rolled back (see Rollback / ClearBackup),
// otherwise it is deleted right away (best effort: a running core keeps it
// locked until it exits).
func installBinary(destDir string, exe []byte, keepBackup bool) error {
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
	if writeErr == nil {
		writeErr = f.Chmod(0o755) // CreateTemp makes 0600: macOS needs the exec bit
	}
	closeErr := f.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	dst := filepath.Join(destDir, SingBoxExe)
	old := backupPath(destDir)
	if err := os.Remove(old); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("%w: %v", ErrBackupBusy, err)
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
	if !keepBackup {
		_ = os.Remove(old)
	}
	return nil
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
		if path.Base(f.Name) != SingBoxExe {
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
