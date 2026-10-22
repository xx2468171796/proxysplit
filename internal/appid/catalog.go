// Package appid is ProxySplit's own application-identification layer: it maps
// "an application" (what the user thinks of, e.g. 雷电模拟器) to the set of
// processes that actually carry its traffic (e.g. Ld9BoxHeadless.exe), and
// attributes captured connections back to applications for monitoring.
//
// Capture itself stays in sing-box (TUN + process_name); proxying stays in the
// outbounds. This package sits between them and the rules.
package appid

import (
	"fmt"
	"regexp"
	"strings"
)

// App is one catalog entry: a named application and the processes whose
// traffic belongs to it.
type App struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Category  string   `json:"category"`  // emulator | custom | ...
	Processes []string `json:"processes"` // exe basenames
	Note      string   `json:"note,omitempty"`
	Builtin   bool     `json:"builtin"`
	// Dirs are install folders found on this PC (Discover): every program under
	// them belongs to the app, so a renamed or extra process is still caught.
	Dirs []string `json:"dirs,omitempty"`

	detect *detect // how Discover finds it; built-ins only
}

// detect tells Discover how to find an installed app: its uninstall entry
// (DisplayName pattern) and extra folders outside the install dir (relative to
// Program Files) that hold its VM / network processes.
type detect struct {
	name  *regexp.Regexp
	extra []string
}

// Android emulators route every guest app through one host VM process (NAT
// mode), so proxying that process proxies the whole emulator. Names: the VM
// ("*Headless" / VMHandle) process of each version, per Proxifier guides for
// these emulators; UI front-ends (dnplayer.exe, MuMuPlayer.exe) carry no guest
// traffic. HD-Network.exe is BlueStacks' pre-5 network process. Verified on a
// real LDPlayer 14 (ldplayer9box, Hyper-V host, 2026-10-22): guest traffic came
// from Ld9BoxHeadless.exe after a reboot, but from VBoxNetNAT.exe (VirtualBox
// NAT-network service) on the first start after install — so both. Bridged network
// mode bypasses the host process and cannot be captured by process name.
const emulatorNote = "需使用默认 NAT 网络（关闭「网络桥接」）；整台模拟器一起走代理，多开实例进程名相同、无法分开"

var builtinApps = []App{
	{ID: "emu-ldplayer", Name: "雷电模拟器", Category: "emulator",
		Processes: []string{"Ld9BoxHeadless.exe", "VBoxNetNAT.exe", "LdVBoxHeadless.exe"},
		detect:    &detect{name: regexp.MustCompile(`(?i)\bldplayer|雷电模拟器`), extra: []string{"ldplayer9box", "ldplayerbox"}}},
	{ID: "emu-mumu", Name: "MuMu 模拟器", Category: "emulator",
		Processes: []string{"MuMuVMMHeadless.exe", "NemuHeadless.exe"},
		detect:    &detect{name: regexp.MustCompile(`(?i)\bmumu\b|\bnemu\b|网易.*模拟器`)}},
	{ID: "emu-bluestacks", Name: "蓝叠模拟器（BlueStacks）", Category: "emulator",
		Processes: []string{"HD-Player.exe", "HD-Network.exe"},
		detect:    &detect{name: regexp.MustCompile(`(?i)bluestacks|蓝叠`), extra: []string{"BlueStacks_nxt", "BlueStacks"}}},
	{ID: "emu-nox", Name: "夜神模拟器", Category: "emulator",
		Processes: []string{"NoxVMHandle.exe"},
		detect:    &detect{name: regexp.MustCompile(`(?i)^nox(player)?\b|夜神`)}},
	{ID: "emu-memu", Name: "逍遥模拟器", Category: "emulator",
		Processes: []string{"MEmuHeadless.exe"},
		detect:    &detect{name: regexp.MustCompile(`(?i)\bmemu\b|逍遥`)}},
}

// Builtin returns a copy of the built-in catalog.
func Builtin() []App {
	out := make([]App, len(builtinApps))
	for i, a := range builtinApps {
		a.Processes = append([]string(nil), a.Processes...)
		a.Builtin = true
		if a.Category == "emulator" {
			a.Note = emulatorNote
		}
		out[i] = a
	}
	return out
}

var exeRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9 ._+\-]{0,80}\.exe$`)

const maxCustom = 100

// NormalizeCustom validates user-defined apps: trims names, appends ".exe",
// dedupes processes case-insensitively and assigns ids. Builtin flags are
// dropped (users cannot override built-ins).
func NormalizeCustom(apps []App) ([]App, error) {
	if len(apps) > maxCustom {
		return nil, fmt.Errorf("自定义应用最多 %d 个", maxCustom)
	}
	out := make([]App, 0, len(apps))
	ids := map[string]bool{}
	for i, a := range apps {
		name := strings.TrimSpace(a.Name)
		if name == "" {
			return nil, fmt.Errorf("第 %d 个应用没有名称", i+1)
		}
		dirs, err := normalizeDirs(a.Dirs)
		if err != nil {
			return nil, fmt.Errorf("「%s」%v", name, err)
		}
		procs, err := normalizeProcs(a.Processes, len(dirs) > 0)
		if err != nil {
			return nil, fmt.Errorf("「%s」%v", name, err)
		}
		id := strings.TrimSpace(a.ID)
		if id == "" || ids[id] || strings.HasPrefix(id, "emu-") {
			id = fmt.Sprintf("custom-%d", i+1)
			for ids[id] {
				id += "x"
			}
		}
		ids[id] = true
		out = append(out, App{ID: id, Name: name, Category: "custom", Processes: procs, Dirs: dirs, Note: strings.TrimSpace(a.Note)})
	}
	return out, nil
}

func normalizeProcs(in []string, haveDirs bool) ([]string, error) {
	seen := map[string]bool{}
	out := []string{}
	for _, p := range in {
		p = strings.TrimSpace(p)
		if i := strings.LastIndexAny(p, `/\`); i >= 0 {
			p = p[i+1:]
		}
		if p == "" {
			continue
		}
		if !strings.HasSuffix(strings.ToLower(p), ".exe") {
			p += ".exe"
		}
		if !exeRe.MatchString(p) {
			return nil, fmt.Errorf("进程名无效：%s", p)
		}
		if k := strings.ToLower(p); !seen[k] {
			seen[k] = true
			out = append(out, p)
		}
	}
	if len(out) == 0 && !haveDirs {
		return nil, fmt.Errorf("至少填一个进程名或程序目录")
	}
	if len(out) > 30 {
		return nil, fmt.Errorf("进程最多 30 个")
	}
	return out, nil
}

// normalizeDirs validates whole-folder entries: absolute, not a drive root.
func normalizeDirs(in []string) ([]string, error) {
	seen := map[string]bool{}
	out := []string{}
	for _, d := range in {
		if strings.TrimSpace(d) == "" {
			continue
		}
		n, err := CheckDir(d)
		if err != nil {
			return nil, err
		}
		if k := strings.ToLower(n); !seen[k] {
			seen[k] = true
			out = append(out, n)
		}
	}
	if len(out) > 10 {
		return nil, fmt.Errorf("程序目录最多 10 个")
	}
	return out, nil
}
