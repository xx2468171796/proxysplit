// Package geoupdate refreshes the bundled sing-box rule-sets (geoip/geosite).
//
// The primary source is our Shenzhen mirror (MirrorBase), refreshed daily from
// SagerNet's rule-set branch and reachable directly from mainland China. Each
// file is verified against the mirror's manifest.json (size + sha256) before it
// replaces the copy on disk. When the mirror is unreachable or a file fails
// verification, Update falls back to SagerNet upstream — through the running
// node's local SOCKS5 proxy when one is given, since raw.githubusercontent.com is
// blocked behind the GFW.
package geoupdate

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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

// maxManifestBytes caps the mirror manifest.
const maxManifestBytes = 64 << 10

// MirrorBase is the Shenzhen rule-set mirror (server/deploy/rules-sync.py).
// A variable so tests can point it at a local server.
var MirrorBase = "https://proxysplit.zygskins.cn/rules/"

// ruleSet describes one rule-set to download: the on-disk filename and its
// upstream URL on the SagerNet rule-set branch.
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

// manifestFile is one entry of the mirror's manifest.json.
type manifestFile struct {
	Name   string `json:"name"`
	SHA256 string `json:"sha256"`
	Size   int    `json:"size"`
}

// Result reports what an update did.
type Result struct {
	Changed  int // files whose content was replaced
	Current  int // files now up to date (changed + already current)
	Upstream int // files that had to come from upstream instead of the mirror
}

// Sync brings destDir up to date from the mirror only (direct connection, no
// upstream fallback) — the quiet background path. Files already matching the
// manifest are not downloaded again.
func Sync(destDir string) (Result, error) {
	return update(destDir, "", false)
}

// Update refreshes destDir from the mirror and falls back to upstream for any
// file the mirror could not provide. viaProxy (host:port SOCKS5) is used only
// for the upstream fallback. The returned error is non-nil if ANY file is still
// not up to date, and names which ones.
func Update(destDir string, viaProxy string) (Result, error) {
	return update(destDir, viaProxy, true)
}

func update(destDir, viaProxy string, fallback bool) (Result, error) {
	direct := &http.Client{Timeout: 30 * time.Second}
	var res Result
	var failed []string

	manifest, merr := fetchManifest(direct)
	var upstream *http.Client
	for _, rs := range ruleSets {
		changed, err := fromMirror(direct, destDir, rs.name, manifest, merr)
		if err != nil && fallback {
			if upstream == nil {
				c, cerr := upstreamClient(viaProxy)
				if cerr != nil {
					return res, cerr
				}
				upstream = c
			}
			if uerr := fromUpstream(upstream, destDir, rs); uerr != nil {
				err = fmt.Errorf("镜像：%v；上游：%v", err, uerr)
			} else {
				err, changed = nil, true
				res.Upstream++
			}
		}
		if err != nil {
			failed = append(failed, fmt.Sprintf("%s (%v)", rs.name, err))
			continue
		}
		res.Current++
		if changed {
			res.Changed++
		}
	}
	if len(failed) > 0 {
		return res, fmt.Errorf("rule-set update failed for %d file(s): %v", len(failed), failed)
	}
	return res, nil
}

func fetchManifest(c *http.Client) (map[string]manifestFile, error) {
	body, err := get(c, MirrorBase+"manifest.json", maxManifestBytes)
	if err != nil {
		return nil, err
	}
	var m struct {
		Files []manifestFile `json:"files"`
	}
	if err := json.Unmarshal(body, &m); err != nil {
		return nil, fmt.Errorf("manifest: %w", err)
	}
	out := make(map[string]manifestFile, len(m.Files))
	for _, f := range m.Files {
		out[f.Name] = f
	}
	return out, nil
}

// fromMirror makes destDir/name match the manifest entry, downloading only when
// the local copy differs. Reports whether the file was replaced.
func fromMirror(c *http.Client, destDir, name string, manifest map[string]manifestFile, merr error) (bool, error) {
	if merr != nil {
		return false, merr
	}
	want, ok := manifest[name]
	if !ok {
		return false, fmt.Errorf("manifest has no %s", name)
	}
	dst := filepath.Join(destDir, name)
	if local, err := os.ReadFile(dst); err == nil && sum(local) == want.SHA256 {
		return false, nil
	}
	body, err := get(c, MirrorBase+name, maxBodyBytes)
	if err != nil {
		return false, err
	}
	if len(body) != want.Size || sum(body) != want.SHA256 {
		return false, fmt.Errorf("%s: checksum mismatch (%d bytes)", name, len(body))
	}
	if err := writeRuleSet(dst, body); err != nil {
		return false, err
	}
	return true, nil
}

func fromUpstream(c *http.Client, destDir string, rs ruleSet) error {
	body, err := get(c, rs.url, maxBodyBytes)
	if err != nil {
		return err
	}
	return writeRuleSet(filepath.Join(destDir, rs.name), body)
}

func upstreamClient(viaProxy string) (*http.Client, error) {
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
	return &http.Client{Transport: tr, Timeout: 30 * time.Second}, nil
}

func get(c *http.Client, url string, limit int64) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("User-Agent", "ProxySplit")
	resp, err := c.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch %q: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch %q: unexpected status %s", url, resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}
	if int64(len(body)) > limit {
		return nil, fmt.Errorf("%q exceeds %d bytes", url, limit)
	}
	return body, nil
}

// writeRuleSet validates the SRS magic and writes atomically (temp file +
// os.Rename), so a bad or partial download never corrupts the existing file.
func writeRuleSet(dst string, body []byte) error {
	if !bytes.HasPrefix(body, srsMagic) {
		return fmt.Errorf("invalid rule-set: missing SRS magic (got %d bytes)", len(body))
	}
	tmp := dst + ".tmp"
	if err := os.WriteFile(tmp, body, 0o644); err != nil {
		return fmt.Errorf("write temp: %w", err)
	}
	if err := os.Rename(tmp, dst); err != nil {
		os.Remove(tmp) // best-effort cleanup; don't mask the rename error
		return fmt.Errorf("rename into place: %w", err)
	}
	return nil
}

func sum(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
