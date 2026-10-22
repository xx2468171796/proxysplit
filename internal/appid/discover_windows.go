package appid

import (
	"os"
	"strings"

	"golang.org/x/sys/windows/registry"
)

var uninstallRoots = []struct {
	root registry.Key
	path string
}{
	{registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`},
	{registry.LOCAL_MACHINE, `SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall`},
	{registry.CURRENT_USER, `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`},
}

// DiscoverEnv reads the installed-programs list and Program Files roots of this
// PC; running holds the full paths of running programs.
func DiscoverEnv(running []string) Env {
	env := Env{Running: running, Exists: func(d string) bool {
		st, err := os.Stat(d)
		return err == nil && st.IsDir()
	}}
	for _, k := range []string{"ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"} {
		if v := os.Getenv(k); v != "" {
			env.ProgramFiles = append(env.ProgramFiles, v)
		}
	}
	for _, r := range uninstallRoots {
		env.Installed = append(env.Installed, readUninstall(r.root, r.path)...)
	}
	return env
}

func readUninstall(root registry.Key, path string) []Installed {
	k, err := registry.OpenKey(root, path, registry.ENUMERATE_SUB_KEYS|registry.QUERY_VALUE)
	if err != nil {
		return nil
	}
	defer k.Close()
	names, _ := k.ReadSubKeyNames(-1)
	var out []Installed
	for _, n := range names {
		sk, err := registry.OpenKey(k, n, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		get := func(v string) string { s, _, _ := sk.GetStringValue(v); return strings.TrimSpace(s) }
		name := get("DisplayName")
		// The uninstaller sits in the install folder; the icon is the last resort
		// (MSI products often point it into C:WindowsInstaller, which CheckDir drops).
		dir := get("InstallLocation")
		if dir == "" {
			dir = DirOf(get("UninstallString"))
		}
		if dir == "" {
			dir = DirOf(get("DisplayIcon"))
		}
		sk.Close()
		if name != "" && dir != "" {
			out = append(out, Installed{Name: name, Dir: dir})
		}
	}
	return out
}
