package main

import (
	_ "embed"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// 更新说明：升级（含强制自动更新）后第一次打开，弹出这次更新了什么。
// 内容来自打进程序的 CHANGELOG.md，所以每次发版只要写好更新日志即可。

//go:embed CHANGELOG.md
var changelogMD string

// ReleaseNote is one version's user-facing change list.
type ReleaseNote struct {
	Version string   `json:"version"`
	Items   []string `json:"items"`
}

const maxNoteVersions = 5

// parseChangelog splits CHANGELOG.md into versions (newest first).
func parseChangelog(md string) []ReleaseNote {
	var out []ReleaseNote
	var cur *ReleaseNote
	for _, line := range strings.Split(strings.ReplaceAll(md, "\r\n", "\n"), "\n") {
		if v, ok := strings.CutPrefix(line, "## v"); ok {
			out = append(out, ReleaseNote{Version: strings.TrimSpace(v)})
			cur = &out[len(out)-1]
			continue
		}
		if cur == nil {
			continue
		}
		if item, ok := strings.CutPrefix(line, "- "); ok {
			cur.Items = append(cur.Items, strings.TrimSpace(item))
		} else if t := strings.TrimSpace(line); t != "" && len(cur.Items) > 0 {
			cur.Items[len(cur.Items)-1] += " " + t // wrapped bullet
		}
	}
	return out
}

// versionLess compares dotted numeric versions ("1.9.76").
func versionLess(a, b string) bool {
	pa, pb := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < len(pa) || i < len(pb); i++ {
		var x, y int
		if i < len(pa) {
			x, _ = strconv.Atoi(pa[i])
		}
		if i < len(pb) {
			y, _ = strconv.Atoi(pb[i])
		}
		if x != y {
			return x < y
		}
	}
	return false
}

// notesSince returns the versions newer than seen, up to current (newest first).
func notesSince(all []ReleaseNote, seen, current string) []ReleaseNote {
	var out []ReleaseNote
	for _, n := range all {
		if versionLess(seen, n.Version) && !versionLess(current, n.Version) && len(n.Items) > 0 {
			out = append(out, n)
		}
		if len(out) == maxNoteVersions {
			break
		}
	}
	return out
}

func seenVersionPath() string { return filepath.Join(dataDir(), "seen-version.txt") }

// GetUpdateNotes returns what changed since the version the user last opened.
// Empty on a fresh install (nothing to compare) or when already shown; a fresh
// install is marked seen right away so only real upgrades show the dialog.
func (a *App) GetUpdateNotes() []ReleaseNote {
	if appVersion == "dev" {
		return []ReleaseNote{}
	}
	b, err := os.ReadFile(seenVersionPath())
	seen := strings.TrimSpace(string(b))
	if err != nil || seen == "" {
		// Versions before 1.9.77 kept no marker: a config from before this launch
		// means an upgrade (show this version only), none means a fresh install.
		if a.freshInstall {
			a.MarkUpdateNotesSeen()
			return []ReleaseNote{}
		}
		for _, n := range parseChangelog(changelogMD) {
			if n.Version == appVersion {
				return []ReleaseNote{n}
			}
		}
		return []ReleaseNote{}
	}
	if !versionLess(seen, appVersion) {
		return []ReleaseNote{}
	}
	return notesSince(parseChangelog(changelogMD), seen, appVersion)
}

// MarkUpdateNotesSeen records that this version's notes were shown.
func (a *App) MarkUpdateNotesSeen() {
	_ = os.MkdirAll(dataDir(), 0o755)
	_ = os.WriteFile(seenVersionPath(), []byte(appVersion), 0o644)
}
