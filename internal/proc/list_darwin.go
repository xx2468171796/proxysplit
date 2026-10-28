// Package proc lists running programs for the app picker. On macOS one app is
// many processes (Chrome's network traffic comes from "Google Chrome Helper"
// inside the bundle), so processes inside an .app are grouped by their
// top-level bundle and its folder becomes a directory rule; command-line
// programs (node, claude, curl …) are listed by executable.
package proc

import (
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

// ProcInfo is one running program.
type ProcInfo struct {
	Name  string `json:"name"`  // executable name, e.g. "Google Chrome" or "node"
	Desc  string `json:"desc"`  // friendly name: the app's name, e.g. "Google Chrome"
	Path  string `json:"path"`  // the .app folder (directory rule) or the executable
	Count int    `json:"count"` // number of live processes
}

// systemPrefixes are macOS's own daemons: not something to proxy per app.
var systemPrefixes = []string{"/System/Library/", "/usr/libexec/", "/usr/sbin/", "/sbin/", "/Library/Apple/", "/usr/bin/login", "/System/Applications/Utilities/"}

// ListProcesses returns running programs grouped by app bundle / executable,
// sorted by friendly name.
func ListProcesses() ([]ProcInfo, error) {
	out, err := exec.Command("/bin/ps", "-axo", "comm=").Output()
	if err != nil {
		return nil, err
	}
	return parsePS(string(out)), nil
}

func parsePS(out string) []ProcInfo {
	byKey := map[string]*ProcInfo{}
	for _, line := range strings.Split(out, "\n") {
		path := strings.TrimSpace(line)
		if !strings.HasPrefix(path, "/") || isSystem(path) {
			continue
		}
		key, pi := path, ProcInfo{Name: filepath.Base(path), Desc: filepath.Base(path), Path: path}
		if app := BundleOf(path); app != "" {
			key = app
			pi = ProcInfo{Name: bundleExe(app, path), Desc: strings.TrimSuffix(filepath.Base(app), ".app"), Path: app}
		}
		if p := byKey[key]; p != nil {
			p.Count++
			continue
		}
		pi.Count = 1
		byKey[key] = &pi
	}
	list := make([]ProcInfo, 0, len(byKey))
	for _, p := range byKey {
		list = append(list, *p)
	}
	sort.Slice(list, func(i, j int) bool {
		li, lj := strings.ToLower(list[i].Desc), strings.ToLower(list[j].Desc)
		if li == lj {
			return list[i].Path < list[j].Path
		}
		return li < lj
	})
	return list
}

func isSystem(path string) bool {
	for _, p := range systemPrefixes {
		if strings.HasPrefix(path, p) {
			return true
		}
	}
	return false
}

// BundleOf returns the outermost .app folder containing path ("" if none).
func BundleOf(path string) string {
	i := strings.Index(path, ".app/")
	if i < 0 {
		if strings.HasSuffix(path, ".app") {
			return path
		}
		return ""
	}
	return path[:i+len(".app")]
}

// bundleExe is the app's main executable name: the one directly in
// Contents/MacOS of the outer bundle when this process is it, else the
// bundle name (helpers live deeper).
func bundleExe(app, path string) string {
	if filepath.Dir(path) == filepath.Join(app, "Contents", "MacOS") {
		return filepath.Base(path)
	}
	return strings.TrimSuffix(filepath.Base(app), ".app")
}
