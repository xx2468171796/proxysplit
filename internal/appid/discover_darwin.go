package appid

import (
	"os"
	"path/filepath"
	"strings"
)

// DiscoverEnv lists the apps in /Applications and ~/Applications; running holds
// the full paths of running programs. The built-in catalog is Windows'
// (exe names), so on macOS it mostly finds nothing — apps are picked from the
// running list instead.
func DiscoverEnv(running []string) Env {
	env := Env{Running: running, Exists: func(d string) bool {
		st, err := os.Stat(d)
		return err == nil && st.IsDir()
	}}
	home, _ := os.UserHomeDir()
	for _, root := range []string{"/Applications", filepath.Join(home, "Applications")} {
		apps, _ := filepath.Glob(filepath.Join(root, "*.app"))
		for _, a := range apps {
			env.Installed = append(env.Installed, Installed{Name: strings.TrimSuffix(filepath.Base(a), ".app"), Dir: a})
		}
	}
	return env
}
