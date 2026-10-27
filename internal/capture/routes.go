// Package capture implements 仅接管选中程序 (process-only capture): WinDivert
// diverts only the traffic of the programs in the app lists and relays it into
// sing-box's per-group mixed inbounds; every other program's packets never
// leave the kernel fast path (see docs/memory/routing.md「仅接管选中程序」).
package capture

import (
	"path/filepath"
	"strings"
)

// Action is what happens to one process's traffic.
type Action int

const (
	Pass  Action = iota // untouched (direct, never enters userspace beyond the first SYN)
	Drop                // 拦截
	Proxy               // relayed into sing-box inbound Port
)

// Verdict is the decision for one process.
type Verdict struct {
	Action Action
	Port   int // sing-box mixed inbound port when Action == Proxy
}

// DirRoute is an install-folder entry (appid "dir:" rules).
type DirRoute struct {
	Prefix string // lower-case folder path ending with `\`
	Port   int
}

// Routes is an immutable snapshot of the app lists, swapped atomically on hot
// changes. Precedence mirrors the TUN rule order: 拦截 > per-target apps >
// 直连 > groups > default line (默认全走代理 only).
type Routes struct {
	// Exclude holds full exe paths (lower-case, `\`) that are never captured,
	// whatever the lists say: our own cores (sing-box / xray sidecars) and the
	// sing-box rules' process_path → direct entries. Capturing them would loop
	// their upstream traffic back into the core.
	Exclude    map[string]bool
	Block      map[string]bool
	BlockDirs  []string
	Apps       map[string]int // exe name (lower) -> inbound port
	AppDirs    []DirRoute
	Direct     map[string]bool
	DirectDirs []string
	Default    int // inbound for unlisted programs; 0 = pass (只代理列出的)
}

// NormDir lower-cases a folder and ensures a trailing backslash.
func NormDir(dir string) string {
	d := strings.ToLower(strings.TrimRight(strings.ReplaceAll(strings.TrimSpace(dir), "/", `\`), `\`))
	if d == "" {
		return ""
	}
	return d + `\`
}

// NormExe is the key form of a full exe path for Routes.Exclude.
func NormExe(p string) string {
	return strings.ToLower(filepath.Clean(strings.ReplaceAll(p, "/", `\`)))
}

func underAny(path string, dirs []string) bool {
	for _, d := range dirs {
		if d != "" && strings.HasPrefix(path, d) {
			return true
		}
	}
	return false
}

// Decide maps a full exe path to a verdict. A nil Routes passes everything.
func (r *Routes) Decide(exePath string) Verdict {
	if r == nil || exePath == "" {
		return Verdict{}
	}
	p := NormExe(exePath)
	if r.Exclude[p] {
		return Verdict{}
	}
	name := filepath.Base(strings.ReplaceAll(p, `\`, "/"))
	if r.Block[name] || underAny(p, r.BlockDirs) {
		return Verdict{Action: Drop}
	}
	if port, ok := r.Apps[name]; ok && port > 0 {
		return Verdict{Action: Proxy, Port: port}
	}
	for _, d := range r.AppDirs {
		if d.Prefix != "" && strings.HasPrefix(p, d.Prefix) && d.Port > 0 {
			return Verdict{Action: Proxy, Port: d.Port}
		}
	}
	if r.Direct[name] || underAny(p, r.DirectDirs) {
		return Verdict{}
	}
	if r.Default > 0 {
		return Verdict{Action: Proxy, Port: r.Default}
	}
	return Verdict{}
}
