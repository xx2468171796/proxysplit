package coreupdate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// EnsureBundled upgrades old payloads when the client itself is upgraded, while
// preserving a newer core installed through the independent core updater.
func EnsureBundled(dir string, exe []byte, version, expectedHash string) error {
	installMu.Lock()
	defer installMu.Unlock()
	hash := sha256.Sum256(exe)
	if hex.EncodeToString(hash[:]) != expectedHash {
		return fmt.Errorf("embedded core SHA256 mismatch")
	}
	dst := filepath.Join(dir, "sing-box.exe")
	current, err := os.ReadFile(dst)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if sha256.Sum256(current) == hash {
		_ = writeMarker(dir, version, hash[:])
		return nil
	}
	installed := ""
	if err == nil {
		installed = installedVersion(dir, current)
	}
	upgrade, err := needsBundledUpgrade(installed, version)
	if err != nil {
		return err
	}
	if !upgrade {
		return nil
	}
	if err := installBinary(dir, exe); err != nil {
		return err
	}
	return writeMarker(dir, version, hash[:])
}

// markerFile records the full version of the installed core. The platform
// build prints only "sing-box version 1.14.2" (relayops is visible just in the
// Tags line), so the build number N is kept here, bound to the EXE's SHA256.
const markerFile = "sing-box.version.json"

type marker struct {
	Version string `json:"version"`
	SHA256  string `json:"sha256"`
}

func writeMarker(dir, version string, sum []byte) error {
	raw, _ := json.Marshal(marker{Version: version, SHA256: hex.EncodeToString(sum)})
	return os.WriteFile(filepath.Join(dir, markerFile), raw, 0o644)
}

// InstalledVersion returns the full version of dir/sing-box.exe, e.g.
// "1.14.2-relayops.6", or "" when there is no usable core.
func InstalledVersion(dir string) string {
	exe, err := os.ReadFile(filepath.Join(dir, "sing-box.exe"))
	if err != nil {
		return ""
	}
	return installedVersion(dir, exe)
}

func installedVersion(dir string, exe []byte) string {
	sum := sha256.Sum256(exe)
	if raw, err := os.ReadFile(filepath.Join(dir, markerFile)); err == nil {
		var m marker
		if json.Unmarshal(raw, &m) == nil && m.SHA256 == hex.EncodeToString(sum[:]) {
			if _, ok := parseCoreVersion(m.Version); ok {
				return m.Version
			}
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, filepath.Join(dir, "sing-box.exe"), "version")
	hideVersionWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return parseVersionOutput(string(out))
}

// parseVersionOutput reads `sing-box version`. A platform build (Tags contain
// relayops_*) without a marker is reported as "<x.y.z>-relayops.0": known to
// be ours, build number unknown (so any published relayops.N replaces it).
func parseVersionOutput(out string) string {
	lines := strings.Split(strings.ReplaceAll(out, "\r\n", "\n"), "\n")
	fields := strings.Fields(lines[0])
	if len(fields) != 3 || fields[0] != "sing-box" || fields[1] != "version" {
		return ""
	}
	v := fields[2]
	for _, l := range lines[1:] {
		l = strings.TrimSpace(l)
		if strings.HasPrefix(l, "Tags:") && strings.Contains(l, "relayops_") && !strings.Contains(v, "-") {
			return v + "-relayops.0"
		}
	}
	return v
}

var coreVersionPattern = regexp.MustCompile(`^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$`)

// relayopsPattern matches the platform-built core's suffix: x.y.z-relayops.N.
var relayopsPattern = regexp.MustCompile(`^-relayops\.(\d+)$`)

type coreVersion struct {
	nums     [3]uint64
	suffix   string // "" for stable
	relayops int64  // N of -relayops.N, or -1
}

func parseCoreVersion(v string) (coreVersion, bool) {
	m := coreVersionPattern.FindStringSubmatch(strings.TrimPrefix(strings.TrimSpace(v), "v"))
	if m == nil {
		return coreVersion{}, false
	}
	out := coreVersion{suffix: m[4], relayops: -1}
	for i := 0; i < 3; i++ {
		n, err := strconv.ParseUint(m[i+1], 10, 32)
		if err != nil {
			return coreVersion{}, false
		}
		out.nums[i] = n
	}
	if r := relayopsPattern.FindStringSubmatch(m[4]); r != nil {
		n, err := strconv.ParseInt(r[1], 10, 32)
		if err != nil {
			return coreVersion{}, false
		}
		out.relayops = n
	}
	return out, true
}

// compareCore orders core versions. The platform build (x.y.z-relayops.N)
// ranks above every official build — once installed we never downgrade to an
// official core; between platform builds the higher x.y.z, then N, wins.
// Among official builds a stable release beats a pre-release of the same x.y.z.
func compareCore(a, b coreVersion) int {
	if (a.relayops >= 0) != (b.relayops >= 0) {
		if a.relayops >= 0 {
			return 1
		}
		return -1
	}
	for i := 0; i < 3; i++ {
		if a.nums[i] != b.nums[i] {
			if a.nums[i] < b.nums[i] {
				return -1
			}
			return 1
		}
	}
	if a.relayops >= 0 {
		switch {
		case a.relayops < b.relayops:
			return -1
		case a.relayops > b.relayops:
			return 1
		}
		return 0
	}
	switch {
	case a.suffix == b.suffix:
		return 0
	case a.suffix == "":
		return 1
	case b.suffix == "":
		return -1
	}
	return 0 // two different pre-releases: treat as equal (no churn)
}

// needsBundledUpgrade reports whether the installed core should be replaced by
// the bundled one. The bundle must be a stable or platform (relayops) build.
func needsBundledUpgrade(installed, bundled string) (bool, error) {
	b, ok := parseCoreVersion(bundled)
	if !ok || (b.suffix != "" && b.relayops < 0) {
		return false, fmt.Errorf("invalid bundled stable core version %q", bundled)
	}
	a, ok := parseCoreVersion(installed)
	if !ok {
		return true, nil
	}
	return compareCore(a, b) < 0, nil
}
