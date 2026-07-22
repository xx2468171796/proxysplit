package main

import (
	"context"
	"embed"
	"net"
	"os"
	"path/filepath"

	"github.com/energye/systray"
	"github.com/wailsapp/wails/v2/pkg/runtime"

	"proxysplit/internal/core"
	"proxysplit/internal/nodes"
	"proxysplit/internal/proc"
	"proxysplit/internal/service"
)

// payloadFS bundles the runtime binaries into the executable so the shipped
// product is a single self-contained proxysplit.exe. They are extracted next to
// each other on first run (WinDivert.dll loads WinDivert64.sys from its dir).
//
//go:embed bin/sing-box.exe bin/WinDivert.dll bin/WinDivert64.sys bin/geoip-cn.srs bin/geosite-cn.srs bin/geosite-category-ads-all.srs
var payloadFS embed.FS

// App is the Wails-bound application object.
type App struct {
	ctx       context.Context
	svc       *service.Service
	forceQuit bool // set when the user picks 退出 from the tray (allow real close)
	trayUp    bool // the tray icon initialized OK (only then may we hide to it)
	apiUp     bool // the local AI-control HTTP API is listening
}

// NewApp creates the App.
func NewApp() *App { return &App{} }

// startup wires the service and streams core/engine logs to the frontend.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	bin, err := ensurePayload()
	if err != nil {
		runtime.LogError(ctx, "extract payload: "+err.Error())
		bin = binDir() // dev fallback: use ./bin
	}
	svc, err := service.New(bin, dataDir())
	if err != nil {
		runtime.LogError(ctx, "service init: "+err.Error())
		return
	}
	a.svc = svc
	svc.SetLogSink(func(line string) {
		runtime.EventsEmit(ctx, "log", line)
	})
	go a.initTray()       // system-tray icon (minimise-to-tray, quick start/stop)
	a.startAPIServer()    // local AI-control HTTP API (127.0.0.1)
}

// shutdown runs when the app window closes. It tears the core down and clears any
// system proxy we set, so exiting never orphans sing-box or leaves the OS
// pointing at a now-dead proxy.
func (a *App) shutdown(ctx context.Context) {
	systray.Quit()
	if a.svc != nil {
		a.svc.Stop()
	}
}

// ensurePayload extracts the embedded runtime binaries into a stable directory
// and returns it. Files are (re)written only when missing or a different size,
// so normal launches are cheap.
func ensurePayload() (string, error) {
	dir := filepath.Join(dataDir(), "bin")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	// Remove a leftover .old left by an in-place core update (it may have been
	// locked while the previous core was running).
	_ = os.Remove(filepath.Join(dir, "sing-box.exe.old"))

	for _, name := range []string{"sing-box.exe", "WinDivert.dll", "WinDivert64.sys", "geoip-cn.srs", "geosite-cn.srs", "geosite-category-ads-all.srs"} {
		dst := filepath.Join(dir, name)
		// Extract only when missing — never overwrite, so a GitHub-updated
		// sing-box.exe / rule-set is preserved across restarts.
		if _, err := os.Stat(dst); err == nil {
			continue
		}
		data, err := payloadFS.ReadFile("bin/" + name)
		if err != nil {
			return "", err
		}
		if err := os.WriteFile(dst, data, 0o755); err != nil {
			return "", err
		}
	}
	return dir, nil
}

// AddResult is returned by AddNodes.
type AddResult struct {
	Added   int `json:"added"`
	Skipped int `json:"skipped"`
}

// AddNodes parses share links (one per line) and stores the new ones.
func (a *App) AddNodes(text string) AddResult {
	added, skipped := a.svc.AddNodes(text)
	return AddResult{Added: added, Skipped: skipped}
}

// GetNodes lists configured nodes.
func (a *App) GetNodes() []*nodes.Node { return a.svc.Nodes() }

// AddManualNode adds a node from hand-entered fields (socks/http/...).
func (a *App) AddManualNode(nodeType, name, server string, port int, username, password string) string {
	return a.svc.AddManualNode(nodeType, name, server, port, username, password)
}

// RemoveNode deletes a node by id.
func (a *App) RemoveNode(id string) { a.svc.RemoveNode(id) }

// SelectNode sets the active node.
func (a *App) SelectNode(id string) { a.svc.SelectNode(id) }

// GetApps / SetApps are legacy string-based accessors (kept for compatibility).
func (a *App) GetApps() []string     { return a.svc.Apps() }
func (a *App) SetApps(apps []string) { a.svc.SetApps(apps) }

// GetAppRules / SetAppRules manage the app -> line rules.
func (a *App) GetAppRules() []service.AppRule      { return a.svc.GetAppRules() }
func (a *App) SetAppRules(rules []service.AppRule) { a.svc.SetAppRules(rules) }

// GetLines / SetLines manage routing lines (builtin + custom; SetLines takes custom).
func (a *App) GetLines() []service.Line      { return a.svc.GetLines() }
func (a *App) SetLines(lines []service.Line) { a.svc.SetLines(lines) }

// GetRuleMode / SetRuleMode manage blacklist vs whitelist.
func (a *App) GetRuleMode() string     { return a.svc.GetRuleMode() }
func (a *App) SetRuleMode(mode string) { a.svc.SetRuleMode(mode) }

// GetDefaultLine / SetDefaultLine: the line for unlisted apps in whitelist mode.
func (a *App) GetDefaultLine() string   { return a.svc.GetDefaultLine() }
func (a *App) SetDefaultLine(id string) { a.svc.SetDefaultLine(id) }

// ListProcesses returns running executables for the picker.
func (a *App) ListProcesses() ([]proc.ProcInfo, error) { return a.svc.ListProcesses() }

// GetAppIcon returns a PNG data URI for an executable's icon (best effort).
func (a *App) GetAppIcon(exePath string) string { return a.svc.GetAppIcon(exePath) }

// TestLatency measures one node; TestAllLatency measures every node.
func (a *App) TestLatency(id string) int { return a.svc.TestLatency(id) }
func (a *App) TestAllLatency()           { a.svc.TestAllLatency() }

// Subscriptions.
func (a *App) GetSubs() []service.Sub { return a.svc.GetSubs() }
func (a *App) AddSub(name, url string, autoUpdate bool) string {
	return errStr(a.svc.AddSub(name, url, autoUpdate))
}
func (a *App) UpdateSub(id string) string          { return errStr(a.svc.UpdateSub(id)) }
func (a *App) RemoveSub(id string)                 { a.svc.RemoveSub(id) }
func (a *App) SetSubAutoUpdate(id string, on bool) { a.svc.SetSubAutoUpdate(id, on) }

// Core (sing-box) version + update.
func (a *App) GetCoreVersion() string { return a.svc.GetCoreVersion() }
func (a *App) UpdateCore() string     { return a.svc.UpdateCore() }

// Settings.
func (a *App) GetSettings() service.Settings  { return a.svc.GetSettings() }
func (a *App) SetSettings(s service.Settings) { a.svc.SetSettings(s) }

// Routing (in-tunnel domain/IP split).
func (a *App) GetRouting() service.Routing  { return a.svc.GetRouting() }
func (a *App) SetRouting(r service.Routing) { a.svc.SetRouting(r) }

// UpdateRuleSets refreshes the geosite/geoip rule-sets (returns "" or an error).
func (a *App) UpdateRuleSets() string { return a.svc.UpdateRuleSets() }

// GetRuleSets returns the state of the routing rule-sets for the 规则 page.
func (a *App) GetRuleSets() []service.RuleSetInfo { return a.svc.GetRuleSets() }

// Global custom routing rules (域名/IP → 代理/直连/拦截).
func (a *App) GetCustomRules() []core.RouteRule      { return a.svc.GetCustomRules() }
func (a *App) SetCustomRules(rules []core.RouteRule) { a.svc.SetCustomRules(rules) }

// ResetConfig restores settings/rules/mode to defaults (keeps nodes + subs).
func (a *App) ResetConfig() { a.svc.ResetConfig() }

// Clash runtime mode toggle (全局/直连/规则 — no restart).
func (a *App) GetClashMode() string            { return a.svc.GetClashMode() }
func (a *App) SetClashMode(mode string) string { return errStr(a.svc.SetClashMode(mode)) }

// System proxy toggle (for legacy apps that only honour the OS proxy).
func (a *App) GetSystemProxy() bool          { return a.svc.GetSystemProxy() }
func (a *App) SetSystemProxy(on bool) string { return errStr(a.svc.SetSystemProxy(on)) }

// Start-on-login (开机自启) via the Windows Run key.
func (a *App) GetAutostart() bool          { return a.svc.GetAutostart() }
func (a *App) SetAutostart(on bool) string { return errStr(a.svc.SetAutostart(on)) }

// Log verbosity (trace|debug|info|warn|error).
func (a *App) GetLogLevel() string      { return a.svc.GetLogLevel() }
func (a *App) SetLogLevel(level string) { a.svc.SetLogLevel(level) }

// App-rule import/export (a JSON bundle of rules + custom lines).
func (a *App) ExportAppRules() string            { s, _ := a.svc.ExportAppRules(); return s }
func (a *App) ImportAppRules(data string) string { return errStr(a.svc.ImportAppRules(data)) }

// PickExeFiles opens a native dialog to choose one or more programs to proxy
// (so you can add an app that isn't currently running). Returns the full paths.
func (a *App) PickExeFiles() []string {
	paths, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "选择要分流的程序",
		Filters: []runtime.FileFilter{{DisplayName: "可执行文件 (*.exe)", Pattern: "*.exe"}},
	})
	if err != nil {
		return nil
	}
	return paths
}

// TestApp measures reachability/latency for one app rule (by match/path).
func (a *App) TestApp(match string) int { return a.svc.TestApp(match) }

// ExportConfig writes the whole config to a user-chosen file. "" = success/cancel.
func (a *App) ExportConfig() string {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "导出配置备份",
		DefaultFilename: "proxysplit-backup.json",
		Filters:         []runtime.FileFilter{{DisplayName: "配置文件 (*.json)", Pattern: "*.json"}},
	})
	if err != nil || path == "" {
		return ""
	}
	data, err := a.svc.ExportAll()
	if err != nil {
		return err.Error()
	}
	if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
		return err.Error()
	}
	return ""
}

// ImportConfig loads a config backup from a user-chosen file. "" = success/cancel.
func (a *App) ImportConfig() string {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "导入配置备份",
		Filters: []runtime.FileFilter{{DisplayName: "配置文件 (*.json)", Pattern: "*.json"}},
	})
	if err != nil || path == "" {
		return ""
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return err.Error()
	}
	return errStr(a.svc.ImportAll(string(data)))
}

// GetLanIP returns this machine's primary private IPv4 (for the LAN-share hint).
func (a *App) GetLanIP() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return ""
	}
	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() {
			if ip4 := ipnet.IP.To4(); ip4 != nil && ip4.IsPrivate() {
				return ip4.String()
			}
		}
	}
	return ""
}

// SpeedResult carries a download-speed measurement to the UI.
type SpeedResult struct {
	Mbps float64 `json:"mbps"`
	Err  string  `json:"err"`
}

// SpeedTest measures the active node's download throughput (MB/s) through the core.
func (a *App) SpeedTest() SpeedResult {
	mbps, err := a.svc.SpeedTest()
	return SpeedResult{Mbps: mbps, Err: errStr(err)}
}

// QRResult carries a node's share-link QR (PNG data URI) to the UI.
type QRResult struct {
	Data string `json:"data"`
	Err  string `json:"err"`
}

// GetNodeQR returns a PNG data URI encoding the node's share link.
func (a *App) GetNodeQR(id string) QRResult {
	data, err := a.svc.GetNodeQR(id)
	return QRResult{Data: data, Err: errStr(err)}
}

func errStr(err error) string {
	if err != nil {
		return err.Error()
	}
	return ""
}

// Start launches the core and redirect engine.
func (a *App) Start() string {
	if err := a.svc.Start(); err != nil {
		return err.Error()
	}
	return ""
}

// Stop stops everything.
func (a *App) Stop() { a.svc.Stop() }

// GetStatus returns a UI status snapshot.
func (a *App) GetStatus() service.Status { return a.svc.Status() }

// GetHealth returns live engine-capture + per-line reachability for the status panel.
func (a *App) GetHealth() service.Health { return a.svc.Health() }

// binDir resolves the directory holding sing-box.exe / WinDivert.dll. It prefers
// a bin/ next to the executable and falls back to ./bin for `wails dev`.
func binDir() string {
	if exe, err := os.Executable(); err == nil {
		cand := filepath.Join(filepath.Dir(exe), "bin")
		if st, err := os.Stat(cand); err == nil && st.IsDir() {
			return cand
		}
	}
	abs, _ := filepath.Abs("bin")
	return abs
}

// dataDir resolves a writable directory for config + generated core config.
func dataDir() string {
	base, err := os.UserConfigDir()
	if err != nil {
		base, _ = os.Getwd()
	}
	return filepath.Join(base, "proxysplit")
}
