package coreupdate

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// RealityHybridTag marks a platform core with relayops patch 0005: VLESS +
// Reality outbounds accept `tls.reality.relayops_hybrid` (keep the uTLS
// fingerprint's X25519MLKEM768 key share, like real Chrome). Stock sing-box
// rejects the field, so it may only be written when the bundled core has it.
const RealityHybridTag = "relayops_reality_hybrid"

type tagCacheEntry struct {
	size    int64
	modTime time.Time
	tags    []string
}

var (
	tagCacheMu sync.Mutex
	tagCache   = map[string]tagCacheEntry{}
)

// HasTag reports whether dir/sing-box.exe was built with tag. The result is
// cached per file (size + mtime), so config builds don't re-run the core.
func HasTag(dir, tag string) bool {
	for _, t := range installedTags(dir) {
		if t == tag {
			return true
		}
	}
	return false
}

func installedTags(dir string) []string {
	exe := filepath.Join(dir, "sing-box.exe")
	info, err := os.Stat(exe)
	if err != nil {
		return nil
	}
	tagCacheMu.Lock()
	if e, ok := tagCache[exe]; ok && e.size == info.Size() && e.modTime.Equal(info.ModTime()) {
		tagCacheMu.Unlock()
		return e.tags
	}
	tagCacheMu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, exe, "version")
	hideVersionWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return nil
	}
	tags := parseVersionTags(string(out))
	tagCacheMu.Lock()
	tagCache[exe] = tagCacheEntry{size: info.Size(), modTime: info.ModTime(), tags: tags}
	tagCacheMu.Unlock()
	return tags
}

// parseVersionTags reads the "Tags:" line of `sing-box version`.
func parseVersionTags(out string) []string {
	for _, l := range strings.Split(strings.ReplaceAll(out, "\r\n", "\n"), "\n") {
		l = strings.TrimSpace(l)
		if rest, ok := strings.CutPrefix(l, "Tags:"); ok {
			var tags []string
			for _, t := range strings.Split(rest, ",") {
				if t = strings.TrimSpace(t); t != "" {
					tags = append(tags, t)
				}
			}
			return tags
		}
	}
	return nil
}
