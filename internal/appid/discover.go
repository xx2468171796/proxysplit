package appid

import (
	"path/filepath"
	"sort"
	"strings"
)

// Installed is one entry of Windows' installed-programs list.
type Installed struct {
	Name string // DisplayName
	Dir  string // install folder (InstallLocation, or the folder of its icon / uninstaller)
}

// Env is what Discover looks at; filled from the real system by DiscoverEnv.
type Env struct {
	Installed    []Installed
	Running      []string // full exe paths of running programs
	ProgramFiles []string // Program Files roots, for the apps' extra folders
	Exists       func(dir string) bool
}

// Discover fills Dirs of the built-in apps found on this PC: the install folder
// from the installed-programs list, extra VM folders that exist, and the folder
// of any running process with one of the app's known names (portable installs).
func Discover(apps []App, env Env) []App {
	out := make([]App, len(apps))
	for i, a := range apps {
		a.Dirs = nil
		if a.detect != nil {
			a.Dirs = discoverDirs(a, env)
		}
		out[i] = a
	}
	return out
}

func discoverDirs(a App, env Env) []string {
	seen := map[string]bool{}
	var dirs []string
	add := func(d string) {
		d, err := CheckDir(d) // never the system, a shared root or ProxySplit itself
		if err != nil || seen[strings.ToLower(d)] {
			return
		}
		seen[strings.ToLower(d)] = true
		dirs = append(dirs, d)
	}
	for _, in := range env.Installed {
		if a.detect.name.MatchString(in.Name) {
			add(in.Dir)
		}
	}
	for _, root := range env.ProgramFiles {
		for _, x := range a.detect.extra {
			if d := filepath.Join(root, x); env.Exists != nil && env.Exists(d) {
				add(d)
			}
		}
	}
	for _, p := range env.Running {
		for _, n := range a.Processes {
			if strings.EqualFold(filepath.Base(p), n) && !covered(dirs, p) {
				add(filepath.Dir(p))
			}
		}
	}
	sort.Strings(dirs)
	return dropNested(dirs)
}

// NormDir cleans a folder and gives it the trailing separator that marks a
// whole-folder app rule.
func NormDir(d string) string {
	d = strings.Trim(strings.TrimSpace(d), `"`)
	if d == "" {
		return ""
	}
	return strings.TrimRight(filepath.Clean(d), `\/`) + string(filepath.Separator)
}

func covered(dirs []string, path string) bool {
	for _, d := range dirs {
		if underDir(path, d) {
			return true
		}
	}
	return false
}

// dropNested keeps only top folders (sorted input): a sub-folder of an already
// listed one adds nothing.
func dropNested(dirs []string) []string {
	var out []string
	for _, d := range dirs {
		if !covered(out, d) {
			out = append(out, d)
		}
	}
	return out
}

// DirOf extracts the folder from an uninstall entry's icon / uninstaller value
// such as `"D:\LDPlayer\LDPlayer14\dnuninst.exe" /S` or `C:\x\app.exe,0`.
func DirOf(cmd string) string {
	cmd = strings.TrimSpace(cmd)
	if strings.HasPrefix(cmd, `"`) {
		if i := strings.Index(cmd[1:], `"`); i >= 0 {
			cmd = cmd[1 : i+1]
		}
	} else if i := strings.Index(strings.ToLower(cmd), ".exe"); i >= 0 {
		cmd = cmd[:i+4]
	}
	if i := strings.LastIndex(cmd, ","); i > strings.LastIndexAny(cmd, `\/`) {
		cmd = cmd[:i]
	}
	if !strings.ContainsAny(cmd, `\/`) {
		return ""
	}
	return filepath.Dir(cmd)
}
