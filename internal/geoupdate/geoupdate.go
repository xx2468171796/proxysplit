// Package geoupdate refreshes the bundled sing-box rule-sets (geoip/geosite)
// from SagerNet's rule-set branch. Because raw.githubusercontent.com is blocked
// behind the GFW, downloads are normally routed THROUGH the running node via a
// local SOCKS5 proxy.
package geoupdate

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/net/proxy"
)

// maxBodyBytes caps how much of each rule-set body we will read. Rule-sets are
// small (tens to hundreds of KB); 8MB is a generous safety ceiling.
const maxBodyBytes = 8 << 20 // 8MB

// ruleSet describes one rule-set to download: the on-disk filename and its
// source URL on the SagerNet rule-set branch.
type ruleSet struct {
	name string
	url  string
}

// ruleSets is the fixed set of sing-box rule-sets ProxySplit bundles.
var ruleSets = []ruleSet{
	{"geoip-cn.srs", "https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-cn.srs"},
	{"geosite-cn.srs", "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-cn.srs"},
	{"geosite-category-ads-all.srs", "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-category-ads-all.srs"},
}

// srsMagic is the leading magic of a sing-box binary rule-set ("SRS").
var srsMagic = []byte{0x53, 0x52, 0x53}

// Update downloads the three sing-box rule-sets into destDir, overwriting the
// bundled copies. When viaProxy (host:port SOCKS5) is non-empty, downloads go
// THROUGH it (essential: raw.githubusercontent is blocked behind the GFW, so we
// fetch through the running node). Returns the number updated and an error.
//
// Each rule-set is validated (200 status, non-empty body, "SRS" magic) and
// written atomically (temp file + os.Rename), so a failed or partial download
// never corrupts the existing rule-set on disk. The returned error is non-nil
// if ANY file failed, and names which ones.
func Update(destDir string, viaProxy string) (int, error) {
	tr := &http.Transport{}
	if viaProxy != "" {
		d, err := proxy.SOCKS5("tcp", viaProxy, nil, proxy.Direct)
		if err != nil {
			return 0, fmt.Errorf("socks dialer: %w", err)
		}
		cd, ok := d.(proxy.ContextDialer)
		if !ok {
			return 0, fmt.Errorf("socks dialer lacks DialContext")
		}
		// Use the context-aware dial so the client Timeout can cancel a stalled
		// SOCKS handshake (otherwise the dial goroutine/conn would leak).
		tr.DialContext = cd.DialContext
	}
	client := &http.Client{Transport: tr, Timeout: 30 * time.Second}

	count := 0
	var failed []string
	for _, rs := range ruleSets {
		if err := updateOne(client, destDir, rs); err != nil {
			failed = append(failed, fmt.Sprintf("%s (%v)", rs.name, err))
			continue
		}
		count++
	}

	if len(failed) > 0 {
		return count, fmt.Errorf("rule-set update failed for %d file(s): %v", len(failed), failed)
	}
	return count, nil
}

// updateOne downloads a single rule-set, validates it, and writes it atomically
// into destDir. On any failure the existing on-disk file is left untouched.
func updateOne(client *http.Client, destDir string, rs ruleSet) error {
	req, err := http.NewRequest(http.MethodGet, rs.url, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("User-Agent", "ProxySplit")

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("fetch %q: %w", rs.url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("fetch %q: unexpected status %s", rs.url, resp.Status)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes+1))
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}
	if len(body) > maxBodyBytes {
		return fmt.Errorf("rule-set exceeds %d bytes", maxBodyBytes)
	}
	if len(body) < len(srsMagic) || string(body[:len(srsMagic)]) != string(srsMagic) {
		return fmt.Errorf("invalid rule-set: missing SRS magic (got %d bytes)", len(body))
	}

	tmp := filepath.Join(destDir, rs.name+".tmp")
	dst := filepath.Join(destDir, rs.name)
	if err := os.WriteFile(tmp, body, 0o644); err != nil {
		return fmt.Errorf("write temp: %w", err)
	}
	if err := os.Rename(tmp, dst); err != nil {
		os.Remove(tmp) // best-effort cleanup; don't mask the rename error
		return fmt.Errorf("rename into place: %w", err)
	}
	return nil
}
