package appid

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Folder safety: a whole-folder app rule proxies (or blocks) every program
// under it, so it must never be the system, a shared root, or a folder that
// holds ProxySplit itself (blocking that would cut the client off its own API).

// Protected lists folders a rule may not cover: ProxySplit's own program and
// core folders. Set once at startup (SetProtected).
var protected []string

// SetProtected records ProxySplit's own folders (exe dir, core bin dir).
func SetProtected(dirs ...string) {
	protected = protected[:0]
	for _, d := range dirs {
		if d = strings.TrimSpace(d); d != "" {
			protected = append(protected, NormDir(d))
		}
	}
}

// sharedRoots are folders that hold many unrelated programs.
func sharedRoots() []string {
	if runtime.GOOS == "darwin" {
		out := []string{"/Applications/", "/System/Applications/", "/Users/", "/usr/local/", "/opt/homebrew/"}
		if h, err := os.UserHomeDir(); err == nil {
			out = append(out, NormDir(h), NormDir(filepath.Join(h, "Applications")))
		}
		return out
	}
	var out []string
	for _, k := range []string{"ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "ProgramData",
		"APPDATA", "LOCALAPPDATA", "USERPROFILE", "PUBLIC", "SystemDrive"} {
		if v := os.Getenv(k); v != "" {
			out = append(out, NormDir(v))
		}
	}
	if v := os.Getenv("LOCALAPPDATA"); v != "" {
		out = append(out, NormDir(filepath.Join(v, "Programs")))
	}
	return out
}

func systemRoot() string {
	if runtime.GOOS == "darwin" {
		return "/System/"
	}
	if v := os.Getenv("SystemRoot"); v != "" {
		return NormDir(v)
	}
	return `C:\Windows\`
}

// CheckDir validates a folder for a whole-folder rule and returns it normalized
// (trailing separator). Environment variables are expanded.
func CheckDir(dir string) (string, error) {
	raw := strings.TrimSpace(dir)
	n := NormDir(os.ExpandEnv(winEnvToGo(raw)))
	if !filepath.IsAbs(n) || len(n) <= 4 || strings.ContainsAny(n, "*?<>|\"") {
		return "", fmt.Errorf("程序目录无效（要完整路径，且不能是整个磁盘）：%s", raw)
	}
	bundle := runtime.GOOS == "darwin" && strings.HasSuffix(n, ".app/") // e.g. /System/Applications/Mail.app
	if !bundle && (underDir(n, systemRoot()) || strings.EqualFold(n, systemRoot())) {
		return "", fmt.Errorf("不能把系统目录当成一个应用：%s", raw)
	}
	for _, r := range sharedRoots() {
		if strings.EqualFold(n, r) {
			return "", fmt.Errorf("这个目录下有很多不相关的程序，请选具体软件的目录：%s", raw)
		}
	}
	for _, p := range protected {
		if strings.EqualFold(n, p) || underDir(p, n) {
			return "", fmt.Errorf("这个目录包含 ProxySplit 自己，不能整体分流：%s", raw)
		}
	}
	return n, nil
}

// winEnvToGo turns %VAR% into ${VAR} so os.ExpandEnv understands it.
func winEnvToGo(s string) string {
	var b strings.Builder
	for {
		i := strings.Index(s, "%")
		if i < 0 {
			b.WriteString(s)
			return b.String()
		}
		j := strings.Index(s[i+1:], "%")
		if j < 0 {
			b.WriteString(s)
			return b.String()
		}
		b.WriteString(s[:i] + "${" + s[i+1:i+1+j] + "}")
		s = s[i+2+j:]
	}
}
