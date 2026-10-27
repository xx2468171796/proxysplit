package main

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/energye/systray"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/runtime"

	"proxysplit/internal/core"
	"proxysplit/internal/coreupdate"
	"proxysplit/internal/license"
	"proxysplit/internal/nodes"
	"proxysplit/internal/powervpn"
	"proxysplit/internal/proc"
	"proxysplit/internal/service"
	"proxysplit/internal/updater"
)

// payloadFS bundles sing-box and its rule sets into the portable executable.
//
//go:embed bin/sing-box.exe bin/core-release.json bin/geoip-cn.srs bin/geosite-cn.srs bin/geosite-category-ads-all.srs
var payloadFS embed.FS

// App is the Wails-bound application object.
type App struct {
	freshInstall bool // no config.json before this launch: no "what changed" dialog
	ctx          context.Context
	svc          *service.Service
	lic          *license.Client
	upd          *updater.Client
	forceQuit    bool        // set when the user picks 退出 from the tray (allow real close)
	installing   atomic.Bool // an update install is in progress (auto and manual must not race)
	trayUp       bool        // the tray icon initialized OK (only then may we hide to it)
	apiUp        bool        // the local AI-control HTTP API is listening
	background   bool        // started with --background: window hidden, tray only
	ready        chan struct{}
	readyOnce    sync.Once
	initErr      error
	accel        *accelRuntime                // Claude Code 加速（accel_app.go）
	pv           *powervpn.Client             // POWER云 账号 / 自家节点（powervpn_app.go）
	autoLogin    atomic.Pointer[autoLoginRun] // 免登录下载（channel.go）；nil = 这次启动没有
}

// NewApp creates the App.
func NewApp() *App {
	return &App{
		ready: make(chan struct{}),
		upd:   updater.New(updateAPIURL, appVersion, dataDir(), updatePublicKeyBase64, updateTLSSPKISHA256),
	}
}

// finishStartup releases every startup reader exactly once. Wails may expose
// bindings and render the page before OnStartup has finished, so bound methods
// must synchronize with service creation rather than dereference a nil service.
func (a *App) finishStartup(err error) {
	a.initErr = err
	a.readyOnce.Do(func() { close(a.ready) })
}

// startup wires the service and streams core/engine logs to the frontend.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if a.background {
		defer func() { go a.revealIfNeeded() }()
	}
	bin, err := ensurePayload()
	if err != nil {
		runtime.LogError(ctx, "extract payload: "+err.Error())
		if appVersion != "dev" {
			a.finishStartup(fmt.Errorf("内核初始化失败：%w", err))
			return
		}
		bin = binDir() // dev fallback: use ./bin
	}
	setupXray(ctx, bin)
	// Before New: it writes config.json even on a fresh install (release_notes.go).
	if _, err := os.Stat(filepath.Join(dataDir(), "config.json")); err != nil {
		a.freshInstall = true
	}
	svc, err := service.New(bin, dataDir())
	if err != nil {
		runtime.LogError(ctx, "service init: "+err.Error())
		a.finishStartup(err)
		return
	}
	a.svc = svc
	// 给 aigw 等本机程序的 AI 线路代理约定文件（internal/service/aiproxy.go）
	svc.SetAIProxyFile(filepath.Join(dataDir(), "ai-proxy.json"))
	a.lic = license.New(dataDir(), appVersion)
	// Validate persisted online credentials before exposing the first UI
	// snapshot. A short timeout avoids delaying offline startup; network
	// failures retain the signed offline lease, while revoked/stale sessions
	// are removed so upgrades cannot resurrect a false "signed in" state.
	reconcileCtx, reconcileCancel := context.WithTimeout(ctx, 4*time.Second)
	if err := a.lic.ReconcileSession(reconcileCtx); err != nil {
		runtime.LogWarning(ctx, "license session reconcile: "+err.Error())
	}
	reconcileCancel()
	// Never tunnel our own domestic sites (AI relay gateways, panels) or our
	// API: sending them through an overseas node is slow and can fail.
	apiHost := ""
	if origin := a.lic.APIOrigin(); origin != "" {
		if u, err := url.Parse(origin); err == nil {
			apiHost = u.Hostname()
		}
	}
	svc.SetDirectDomains(service.DirectDomains(apiHost))
	svc.SetStartGuard(a.commercialStartGuard)
	a.initPowerVPN()
	svc.SetLogSink(func(line string) {
		runtime.EventsEmit(ctx, "log", line)
	})
	a.startAccel()
	a.startAutoLogin(ctx) // AI-site download: sign in with the ticket in the file name (background)
	a.finishStartup(nil)
	go a.aiGuardBoot()        // AI-site customers: AI pinned to our line + DNS lock + proxy on at once
	go svc.MigrateAutostart() // Run-key autostart never launched the elevated app: move it to a logon task
	go a.licenseWatchdog()
	go a.powervpnMembershipSync() // AI-site customers: membership follows the POWER云 AI plan
	go a.resumeAfterUpdate()      // bring the proxy back after an automatic update
	go a.autoUpdateLoop()         // install new signed releases without prompting
	svc.StartCoreFollow()         // follow the POWER云 standard core: hourly check, apply automatically
	svc.StartRuleSync()           // rule-sets from the Shenzhen mirror: check at launch, then every 6 h
	go svc.StartProxyPorts()      // 端口代理：开启的端口随软件启动
	go a.ensureDesktopShortcut()  // every launch: recreate / repair the desktop shortcut
	go removeStaleExecutables()   // old versions an --mcp bridge kept busy during an update
	go a.initTray()               // system-tray icon (minimise-to-tray, quick start/stop)
	a.startAPIServer()            // local AI-control HTTP API (127.0.0.1)
}

// revealIfNeeded shows the window of a --background start when staying hidden
// would strand the user: startup failed, not signed in (the proxy cannot start
// until they log in) or no tray icon to bring the window back from.
func (a *App) revealIfNeeded() {
	if a.svc == nil || a.lic == nil || !a.lic.Status().Authenticated {
		a.showWindow()
		return
	}
	time.Sleep(5 * time.Second)
	if !a.trayUp {
		a.showWindow()
	}
}

func (a *App) commercialStartGuard() error {
	if err := a.lic.EnsureEntitled(); err != nil {
		return err
	}
	return nil
}

// licenseWatchdog stops a running core shortly after expiry, account
// suspension, payment revocation or device unbinding. The same validation is
// also installed directly on Service.Start for every restart path.
func (a *App) licenseWatchdog() {
	// Poll every minute REGARDLESS of whether the proxy is running: an operator
	// resetting a password, granting a plan or suspending an account must take
	// effect quickly, not only on the next manual refresh. The UI is told about
	// every change so it can re-render without the user clicking anything.
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	var last string
	for {
		select {
		case <-ticker.C:
			if a.svc != nil && a.lic != nil {
				a.syncAIGuard() // channel learned from the server / lock removed by someone
			}
			if a.svc == nil || a.lic == nil || !a.lic.Enabled() || !a.lic.Status().SignedIn {
				continue
			}
			err := a.lic.EnsureEntitled()
			if err != nil {
				// Revoked session / expired or removed membership: stop the proxy
				// (if running) and send the user back to the login/purchase gate.
				if a.svc.Status().CoreRunning {
					a.svc.Stop()
				}
				runtime.EventsEmit(a.ctx, "license-expired", err.Error())
				runtime.LogWarning(a.ctx, "commercial entitlement check failed: "+err.Error())
				last = "revoked:" + err.Error()
				continue
			}
			// Entitlement is valid; push a refresh only when something actually
			// changed (plan, expiry, device allowance, sign-in state).
			status := a.lic.Status()
			current := fmt.Sprintf("%v|%s|%s|%s|%d|%v", status.Authenticated, status.PlanCode, status.Plan, status.ExpiresAt, status.MaxDevices, status.DeviceLimitReached)
			if current != last {
				last = current
				runtime.EventsEmit(a.ctx, "license-changed", status)
			}
		case <-a.ctx.Done():
			return
		}
	}
}

// BootstrapState is the complete persisted state needed for the first UI
// render.  It is pushed from OnDomReady as well as being available as a normal
// binding, so startup does not depend on the frontend winning a WebView/Wails
// injection race.
type BootstrapState struct {
	Ready       bool              `json:"ready"`
	Error       string            `json:"error,omitempty"`
	Nodes       []*nodes.Node     `json:"nodes"`
	Rules       []service.AppRule `json:"rules"`
	Lines       []service.Line    `json:"lines"`
	Subs        []service.Sub     `json:"subs"`
	Settings    service.Settings  `json:"settings"`
	DefaultLine string            `json:"defaultLine"`
	RuleMode    string            `json:"ruleMode"`
	Status      service.Status    `json:"status"`
	License     license.Status    `json:"license"`
}

func (a *App) GetBootstrapState() BootstrapState {
	// The first frontend call is intentionally allowed to wait. Unlike the old
	// GetNodes/GetAppRules race, it resolves only after service.New has loaded the
	// persisted config, so an empty startup screen can never masquerade as data.
	<-a.ready
	if a.svc == nil {
		message := "service initialization failed"
		if a.initErr != nil {
			message = a.initErr.Error()
		}
		return BootstrapState{Error: message}
	}
	return BootstrapState{
		Ready:       true,
		Nodes:       a.svc.Nodes(),
		Rules:       a.svc.GetAppRules(),
		Lines:       a.svc.GetLines(),
		Subs:        a.svc.GetSubs(),
		Settings:    a.svc.GetSettings(),
		DefaultLine: a.svc.GetDefaultLine(),
		RuleMode:    a.svc.GetRuleMode(),
		Status:      a.svc.Status(),
		License:     a.licenseStatus(),
	}
}

// domReady injects a server-owned startup snapshot into the page.  The global
// covers the case where this runs before Svelte mounts; the event covers the
// opposite order.  Either way, saved nodes/rules render without waiting for an
// initial JS -> Go RPC.
func (a *App) domReady(ctx context.Context) {
	// Do not block Wails' DOM-ready callback while OnStartup is still loading the
	// config. The goroutine waits for the same readiness barrier as the binding.
	go func() {
		data, err := json.Marshal(a.GetBootstrapState())
		if err != nil {
			runtime.LogError(ctx, "bootstrap state: "+err.Error())
			return
		}
		script := "window.__PROXYSPLIT_BOOTSTRAP__=" + string(data) + ";" +
			"window.dispatchEvent(new CustomEvent('proxysplit:bootstrap',{detail:window.__PROXYSPLIT_BOOTSTRAP__}));"
		runtime.WindowExecJS(ctx, script)
		a.markStartedOK()
		// Updates are forced: always check on launch so the UI can block at once.
		if a.svc != nil {
			update := a.CheckAppUpdate()
			runtime.EventsEmit(ctx, "app-update", update)
		}
	}()
}

// shutdown runs when the app window closes. It tears the core down and clears any
// system proxy we set, so exiting never orphans sing-box or leaves the OS
// pointing at a now-dead proxy.
func (a *App) shutdown(ctx context.Context) {
	systray.Quit()
	a.stopAccel() // 先把 Claude Code 配置还原成官方默认，再停内核
	if a.svc != nil {
		a.svc.Stop()
		a.svc.StopProxyPorts()
	}
}

// onSecondInstance fires (on the FIRST/running instance) when the user launches
// the app again — bring the existing window back instead of starting a rival.
func (a *App) onSecondInstance(data options.SecondInstanceData) {
	// the MCP bridge asking for a background start: already running, nothing to show
	if a.ctx == nil || hasFlag(data.Args, backgroundFlag) {
		return
	}
	runtime.WindowUnminimise(a.ctx)
	runtime.WindowShow(a.ctx)
}

// ensurePayload extracts the embedded runtime binaries into a stable directory
// and returns it. Upgrade older cores; preserve newer cores and updated rule sets.
func ensurePayload() (string, error) {
	dir := filepath.Join(dataDir(), "bin")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	// Remove the previous core kept by a panel core update for rollback (it
	// may have been locked while that core was still running).
	_ = coreupdate.ClearBackup(dir)

	// v1.8.x moved application matching to sing-box TUN process_name rules.
	// Remove legacy portable WinDivert payloads left by older versions; no
	// driver is loaded or installed by the current application.
	_ = os.Remove(filepath.Join(dir, "WinDivert.dll"))
	_ = os.Remove(filepath.Join(dir, "WinDivert64.sys"))

	metadata, err := payloadFS.ReadFile("bin/core-release.json")
	if err != nil {
		return "", err
	}
	var bundled struct {
		Version string `json:"version"`
		SHA256  string `json:"sha256"`
	}
	if err := json.Unmarshal(metadata, &bundled); err != nil {
		return "", err
	}
	exe, err := payloadFS.ReadFile("bin/sing-box.exe")
	if err != nil {
		return "", err
	}
	if err := coreupdate.EnsureBundled(dir, exe, bundled.Version, bundled.SHA256); err != nil {
		return "", err
	}
	for _, name := range []string{"geoip-cn.srs", "geosite-cn.srs", "geosite-category-ads-all.srs"} {
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
func (a *App) RemoveNode(id string) string { return a.svc.RemoveNode(id) }

// SelectNode sets the active node.
func (a *App) SelectNode(id string) string { return a.svc.SelectNode(id) }

// GetApps / SetApps are legacy string-based accessors (kept for compatibility).
func (a *App) GetApps() []string     { return a.svc.Apps() }
func (a *App) SetApps(apps []string) { a.svc.SetApps(apps) }

// GetAppRules / SetAppRules manage the app -> line rules.
func (a *App) GetAppRules() []service.AppRule             { return a.svc.GetAppRules() }
func (a *App) SetAppRules(rules []service.AppRule) string { return a.svc.SetAppRules(rules) }

// GetLines / SetLines manage routing lines (builtin + custom; SetLines takes custom).
func (a *App) GetLines() []service.Line { return a.svc.GetLines() }
func (a *App) SetLines(lines []service.Line) string {
	return a.svc.SetLines(lines)
}

// GetRuleMode / SetRuleMode manage blacklist vs whitelist.
func (a *App) GetRuleMode() string            { return a.svc.GetRuleMode() }
func (a *App) SetRuleMode(mode string) string { return a.svc.SetRuleMode(mode) }

// GetDefaultLine / SetDefaultLine: the line for unlisted apps in whitelist mode.
func (a *App) GetDefaultLine() string          { return a.svc.GetDefaultLine() }
func (a *App) SetDefaultLine(id string) string { return a.svc.SetDefaultLine(id) }

// ListProcesses returns running executables for the picker.
func (a *App) ListProcesses() ([]proc.ProcInfo, error) { return a.svc.ListProcesses() }

// GetAppIcon returns a PNG data URI for an executable's icon (best effort).
func (a *App) GetAppIcon(exePath string) string { return a.svc.GetAppIcon(exePath) }

// TestLatency measures one node; TestAllLatency measures every node.
func (a *App) TestLatency(id string) int { return a.svc.TestLatency(id) }
func (a *App) TestTCP(id string) int     { return a.svc.TestTCP(id) }
func (a *App) TestAllLatency()           { a.svc.TestAllLatency() }

// GetConnections returns the live per-connection routing trace (进程 → 目标 →
// 命中规则 → 出口) for the diagnostics view.
func (a *App) GetConnections() []service.ConnInfo { return a.svc.Connections() }

// Subscriptions.
func (a *App) GetSubs() []service.Sub { return a.svc.GetSubs() }
func (a *App) AddSub(name, url string, autoUpdate bool) string {
	return errStr(a.svc.AddSub(name, url, autoUpdate))
}
func (a *App) EditSub(id, name, url string) string {
	return errStr(a.svc.EditSub(id, name, url))
}
func (a *App) UpdateSub(id string) string          { return errStr(a.svc.UpdateSub(id)) }
func (a *App) RemoveSub(id string)                 { a.svc.RemoveSub(id) }
func (a *App) SetSubAutoUpdate(id string, on bool) { a.svc.SetSubAutoUpdate(id, on) }

// Core (sing-box) version + update.
func (a *App) GetCoreVersion() string { return a.svc.GetCoreVersion() }
func (a *App) UpdateCore() string     { return a.svc.UpdateCore() }

// Application updates are signed independently from license leases. The UI
// Updates install automatically (see autoupdate.go); InstallAppUpdate is also
// the manual 立即升级 path and the fallback when an automatic attempt failed.
func (a *App) GetAppVersion() string { return appVersion }

func (a *App) CheckAppUpdate() updater.Status {
	if a.upd == nil {
		return updater.Status{Current: appVersion}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return a.upd.Check(ctx)
}

func (a *App) InstallAppUpdate(release updater.Release) string {
	if a.upd == nil {
		return "自动更新未配置"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if !a.installing.CompareAndSwap(false, true) {
		return "正在安装更新，请稍候"
	}
	path, err := a.upd.Download(ctx, release)
	if err != nil {
		a.installing.Store(false)
		return err.Error()
	}
	a.rememberProxyForUpdate(release.Version)
	if err := updater.ScheduleInstall(path, startedOKPath()); err != nil {
		_ = os.Remove(resumePath())
		a.installing.Store(false)
		return err.Error()
	}
	// runtime.Quit would otherwise be intercepted by the user's
	// "close to tray" preference, leaving the old executable locked forever.
	a.forceQuit = true
	go func() {
		time.Sleep(800 * time.Millisecond)
		if a.ctx != nil {
			runtime.Quit(a.ctx)
		}
	}()
	return ""
}

// Settings.
func (a *App) GetSettings() service.Settings { return a.svc.GetSettings() }
func (a *App) SetSettings(s service.Settings) string {
	msg := a.svc.SetSettings(s)
	a.kickAccel()
	return msg
}

// Routing (in-tunnel domain/IP split).
func (a *App) GetRouting() service.Routing         { return a.svc.GetRouting() }
func (a *App) SetRouting(r service.Routing) string { return a.svc.SetRouting(r) }

// UpdateRuleSets refreshes the geosite/geoip rule-sets (returns "" or an error).
func (a *App) UpdateRuleSets() string { return a.svc.UpdateRuleSets() }

// GetRuleSets returns the state of the routing rule-sets for the 规则 page.
func (a *App) GetRuleSets() []service.RuleSetInfo { return a.svc.GetRuleSets() }
func (a *App) SetRuleSetEnabled(name string, enabled bool) string {
	return a.svc.SetRuleSetEnabled(name, enabled)
}

// Global custom routing rules (域名/IP → 代理/直连/拦截).
func (a *App) GetCustomRules() []core.RouteRule { return a.svc.GetCustomRules() }
func (a *App) SetCustomRules(rules []core.RouteRule) string {
	return a.svc.SetCustomRules(rules)
}

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
func (a *App) GetLogLevel() string             { return a.svc.GetLogLevel() }
func (a *App) SetLogLevel(level string) string { return a.svc.SetLogLevel(level) }

// App-rule import/export (a JSON bundle of rules + custom lines).
func (a *App) ExportAppRules() string            { s, _ := a.svc.ExportAppRules(); return s }
func (a *App) ImportAppRules(data string) string { return errStr(a.svc.ImportAppRules(data)) }
func (a *App) PreviewAppRulesImport(data string) service.RuleImportPreview {
	preview, err := a.svc.PreviewAppRulesImport(data)
	if err != nil {
		preview.Error = err.Error()
	}
	return preview
}

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

// SpeedTestNode measures one specific node's download throughput (MB/s).
func (a *App) SpeedTestNode(id string) SpeedResult {
	mbps, err := a.svc.SpeedTestNode(id)
	return SpeedResult{Mbps: mbps, Err: errStr(err)}
}

// QRResult carries a QR code (PNG data URI) to the UI (payment checkout).
type QRResult struct {
	Data string `json:"data"`
	Err  string `json:"err"`
}

// NodeShareResult is a node's share link plus its QR code.
type NodeShareResult struct {
	Link string `json:"link"`
	QR   string `json:"qr"`
	Err  string `json:"err"`
}

// GetNodeShare returns the node's share link and QR (POWER云 lines refused).
func (a *App) GetNodeShare(id string) NodeShareResult {
	link, qr, err := a.svc.NodeShare(id)
	return NodeShareResult{Link: link, QR: qr, Err: errStr(err)}
}

func errStr(err error) string {
	if err != nil {
		return err.Error()
	}
	return ""
}

// Start launches the core and redirect engine.
func (a *App) Start() string {
	if err := a.startService(); err != nil {
		return err.Error()
	}
	return ""
}

// startService delegates to Service.Start, whose internal guard covers every
// UI, tray, local-control and live-reload restart route.
func (a *App) startService() error {
	if err := a.svc.Start(); err != nil {
		return err
	}
	a.watchNetBlocked()
	return nil
}

// watchNetBlocked: the core can start fine yet be blocked by security
// software, leaving the user with "nothing opens" and no error: check, and say
// why in the UI.
func (a *App) watchNetBlocked() {
	go func() {
		if msg := a.svc.PostStartCheck(); msg != "" && a.ctx != nil {
			runtime.EventsEmit(a.ctx, "net-blocked", msg)
		}
	}()
}

// Commercial account/licensing. Development builds have no injected API URL,
// report Enabled=false and preserve the already-accepted local-only workflow.
func (a *App) GetLicenseStatus() license.Status {
	if a.lic == nil {
		return license.Status{}
	}
	return a.licenseStatus()
}

func (a *App) Login(username, password string) string {
	if a.lic == nil {
		return "授权模块尚未初始化"
	}
	if err := a.lic.Login(username, password); err != nil {
		return err.Error()
	}
	a.afterSignIn()
	return ""
}

func (a *App) Register(username, email, password, ref string) string {
	if a.lic == nil {
		return "授权模块尚未初始化"
	}
	return errStr(a.lic.Register(username, email, password, ref))
}

type PlansResult struct {
	Items []license.Plan `json:"items"`
	Err   string         `json:"err,omitempty"`
}

type DevicesResult struct {
	Items []license.Device `json:"items"`
	Err   string           `json:"err,omitempty"`
}

type OrdersResult struct {
	Items []license.Order `json:"items"`
	Err   string          `json:"err,omitempty"`
}

type OrderResult struct {
	Split   bool            `json:"split"`
	GroupNo string          `json:"groupNo,omitempty"`
	Orders  []license.Order `json:"orders"`
	Order   license.Order   `json:"order"`
	Err     string          `json:"err,omitempty"`
}

type AnnouncementsResult struct {
	Items []license.Announcement `json:"items"`
	Err   string                 `json:"err,omitempty"`
}

func (a *App) GetMembershipPlans() PlansResult {
	items, err := a.lic.Plans()
	return PlansResult{Items: items, Err: errStr(err)}
}

func (a *App) GetMyDevices() DevicesResult {
	items, err := a.lic.Devices()
	return DevicesResult{Items: items, Err: errStr(err)}
}

func (a *App) UnbindMyDevice(id string) string {
	if err := a.lic.UnbindDevice(id); err != nil {
		return err.Error()
	}
	if !a.lic.Status().SignedIn {
		a.svc.Stop()
	}
	return ""
}

func (a *App) ActivateCurrentDevice() string {
	return errStr(a.lic.ActivateCurrentDevice())
}

func (a *App) GetMyOrders() OrdersResult {
	items, err := a.lic.Orders()
	return OrdersResult{Items: items, Err: errStr(err)}
}

func (a *App) CreateMembershipOrder(planID string) OrderResult {
	checkout, err := a.lic.CreateOrder(planID)
	return OrderResult{Split: checkout.Split, GroupNo: checkout.GroupNo, Orders: checkout.Orders, Order: checkout.Order, Err: errStr(err)}
}

// GetPaymentQR locally encodes the payment provider URL as a scannable PNG.
// The URL never leaves the client except when the user explicitly opens it.
func (a *App) GetPaymentQR(payURL string) QRResult {
	payURL = strings.TrimSpace(payURL)
	if !validPaymentURL(payURL) {
		return QRResult{Err: "支付链接格式无效"}
	}
	data, err := service.EncodeQRDataURI(payURL, 360)
	return QRResult{Data: data, Err: errStr(err)}
}

func validPaymentURL(value string) bool {
	u, err := url.Parse(strings.TrimSpace(value))
	if err != nil {
		return false
	}
	switch strings.ToLower(u.Scheme) {
	case "https":
		return u.Host != ""
	case "alipays":
		return true
	default:
		return false
	}
}

// OpenPaymentURL validates the exact URL again at the privileged browser-open
// boundary. The frontend never opens an arbitrary provider string directly.
func (a *App) OpenPaymentURL(payURL string) string {
	if !validPaymentURL(payURL) {
		return "支付链接格式无效"
	}
	runtime.BrowserOpenURL(a.ctx, payURL)
	return ""
}

// Fixed external destinations shown in the sidebar footer. They are hardcoded
// (not arbitrary URLs from the frontend) so the browser-open boundary can never
// be pointed at an attacker-chosen address.
const (
	websiteURL = "https://proxysplit.zygskins.cn"
	githubURL  = "https://github.com/xx2468171796"
	qqGroup    = "719243244"
)

// OpenWebsite opens the official ProxySplit site in the default browser.
func (a *App) OpenWebsite() { runtime.BrowserOpenURL(a.ctx, websiteURL) }

// OpenGitHub opens the author's GitHub profile in the default browser.
func (a *App) OpenGitHub() { runtime.BrowserOpenURL(a.ctx, githubURL) }

// QQGroup returns the support QQ group number for the UI to display/copy.
func (a *App) QQGroup() string { return qqGroup }

// CopyToClipboard puts text on the system clipboard (used for the QQ group).
func (a *App) CopyToClipboard(text string) string {
	return errStr(runtime.ClipboardSetText(a.ctx, text))
}

func (a *App) GetAnnouncements() AnnouncementsResult {
	items, err := a.lic.Announcements()
	return AnnouncementsResult{Items: items, Err: errStr(err)}
}

func (a *App) RefreshEntitlement() string {
	return errStr(a.lic.RefreshEntitlement())
}

// ChangeAccountPassword lets the signed-in user change their own password by
// providing the current one. Returns "" on success or an error message.
func (a *App) ChangeAccountPassword(current, next string) string {
	if a.lic == nil {
		return "商业授权未启用"
	}
	current, next = strings.TrimSpace(current), strings.TrimSpace(next)
	if current == "" {
		return "请输入原密码"
	}
	if len(next) < 8 {
		return "新密码至少 8 位"
	}
	return errStr(a.lic.ChangePassword(current, next))
}

// RedeemCode applies a redeem / activation code to the signed-in account and
// refreshes the membership. Returns "" on success or an error message.
func (a *App) RedeemCode(code string) string {
	if a.lic == nil {
		return "商业授权未启用"
	}
	code = strings.TrimSpace(code)
	if code == "" {
		return "请输入兑换码"
	}
	return errStr(a.lic.Redeem(code))
}

func (a *App) Logout() string {
	if a.lic == nil {
		return ""
	}
	a.svc.Stop()
	// 劫持模式 stays on after sign-out: only the in-app 恢复 lifts it.
	return errStr(a.lic.Logout())
}

// Stop stops everything.
func (a *App) Stop() { a.svc.Stop() }

// Restart stops then starts the core (one click to reload after config changes).
func (a *App) Restart() string {
	a.svc.Stop()
	if err := a.startService(); err != nil {
		return err.Error()
	}
	return ""
}

// GetStatus returns a UI status snapshot.
func (a *App) GetStatus() service.Status { return a.svc.Status() }

// GetHealth returns live engine-capture + per-line reachability for the status panel.
func (a *App) GetHealth() service.Health { return a.svc.Health() }

// binDir resolves the directory holding the extracted sing-box runtime. It prefers
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
