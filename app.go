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
	"time"

	"github.com/energye/systray"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/runtime"

	"proxysplit/internal/core"
	"proxysplit/internal/license"
	"proxysplit/internal/nodes"
	"proxysplit/internal/proc"
	"proxysplit/internal/service"
	"proxysplit/internal/updater"
)

// payloadFS bundles sing-box and its rule sets into the portable executable.
//
//go:embed bin/sing-box.exe bin/geoip-cn.srs bin/geosite-cn.srs bin/geosite-category-ads-all.srs
var payloadFS embed.FS

// App is the Wails-bound application object.
type App struct {
	ctx       context.Context
	svc       *service.Service
	lic       *license.Client
	upd       *updater.Client
	forceQuit bool // set when the user picks 退出 from the tray (allow real close)
	trayUp    bool // the tray icon initialized OK (only then may we hide to it)
	apiUp     bool // the local AI-control HTTP API is listening
	ready     chan struct{}
	readyOnce sync.Once
	initErr   error
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
	bin, err := ensurePayload()
	if err != nil {
		runtime.LogError(ctx, "extract payload: "+err.Error())
		bin = binDir() // dev fallback: use ./bin
	}
	svc, err := service.New(bin, dataDir())
	if err != nil {
		runtime.LogError(ctx, "service init: "+err.Error())
		a.finishStartup(err)
		return
	}
	a.svc = svc
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
	svc.SetStartGuard(a.commercialStartGuard)
	svc.SetLogSink(func(line string) {
		runtime.EventsEmit(ctx, "log", line)
	})
	a.finishStartup(nil)
	go a.licenseWatchdog()
	go a.initTray()    // system-tray icon (minimise-to-tray, quick start/stop)
	a.startAPIServer() // local AI-control HTTP API (127.0.0.1)
}

func (a *App) commercialStartGuard() error {
	if err := a.lic.EnsureEntitled(); err != nil {
		return err
	}
	if !a.lic.Enabled() {
		return nil
	}
	selected := a.svc.Status().SelectedID
	for _, node := range a.svc.Nodes() {
		if node.ID != selected {
			continue
		}
		protocol := strings.ToLower(node.Type)
		if protocol == "socks5" {
			protocol = "socks"
		}
		if a.lic.HasFeature("all-protocols") || a.lic.HasFeature(protocol) {
			return nil
		}
		return fmt.Errorf("当前会员不支持 %s 协议，请升级超级会员", strings.ToUpper(protocol))
	}
	return nil
}

// licenseWatchdog stops a running core shortly after expiry, account
// suspension, payment revocation or device unbinding. The same validation is
// also installed directly on Service.Start for every restart path.
func (a *App) licenseWatchdog() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if a.svc == nil || a.lic == nil || !a.svc.Status().CoreRunning {
				continue
			}
			if err := a.lic.EnsureEntitled(); err != nil {
				a.svc.Stop()
				runtime.EventsEmit(a.ctx, "license-expired", err.Error())
				runtime.LogWarning(a.ctx, "commercial entitlement stopped the proxy core: "+err.Error())
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
		License:     a.lic.Status(),
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
		if a.svc.GetSettings().AutoUpdateApp {
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
	if a.svc != nil {
		a.svc.Stop()
	}
}

// onSecondInstance fires (on the FIRST/running instance) when the user launches
// the app again — bring the existing window back instead of starting a rival.
func (a *App) onSecondInstance(_ options.SecondInstanceData) {
	if a.ctx == nil {
		return
	}
	runtime.WindowUnminimise(a.ctx)
	runtime.WindowShow(a.ctx)
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

	// v1.8.x moved application matching to sing-box TUN process_name rules.
	// Remove legacy portable WinDivert payloads left by older versions; no
	// driver is loaded or installed by the current application.
	_ = os.Remove(filepath.Join(dir, "WinDivert.dll"))
	_ = os.Remove(filepath.Join(dir, "WinDivert64.sys"))

	for _, name := range []string{"sing-box.exe", "geoip-cn.srs", "geosite-cn.srs", "geosite-category-ads-all.srs"} {
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
func (a *App) GetAppRules() []service.AppRule             { return a.svc.GetAppRules() }
func (a *App) SetAppRules(rules []service.AppRule) string { return a.svc.SetAppRules(rules) }

// GetLines / SetLines manage routing lines (builtin + custom; SetLines takes custom).
func (a *App) GetLines() []service.Line { return a.svc.GetLines() }
func (a *App) SetLines(lines []service.Line) string {
	if len(lines) > 0 && a.lic != nil && !a.lic.HasFeature("custom-lines") {
		return "当前会员不支持自定义线路，请升级超级会员"
	}
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

// Application updates are signed independently from license leases. The UI
// checks on startup and calls InstallAppUpdate only after the user confirms.
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
	path, err := a.upd.Download(ctx, release)
	if err != nil {
		return err.Error()
	}
	if err := updater.ScheduleInstall(path); err != nil {
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
func (a *App) GetSettings() service.Settings  { return a.svc.GetSettings() }
func (a *App) SetSettings(s service.Settings) { a.svc.SetSettings(s) }

// Routing (in-tunnel domain/IP split).
func (a *App) GetRouting() service.Routing  { return a.svc.GetRouting() }
func (a *App) SetRouting(r service.Routing) { a.svc.SetRouting(r) }

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
	if len(rules) > 0 && a.lic != nil && !a.lic.HasFeature("custom-lines") {
		return "当前会员不支持高级自定义规则，请升级超级会员"
	}
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
func (a *App) GetLogLevel() string      { return a.svc.GetLogLevel() }
func (a *App) SetLogLevel(level string) { a.svc.SetLogLevel(level) }

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
	if err := a.startService(); err != nil {
		return err.Error()
	}
	return ""
}

// startService delegates to Service.Start, whose internal guard covers every
// UI, tray, local-control and live-reload restart route.
func (a *App) startService() error {
	return a.svc.Start()
}

// Commercial account/licensing. Development builds have no injected API URL,
// report Enabled=false and preserve the already-accepted local-only workflow.
func (a *App) GetLicenseStatus() license.Status {
	if a.lic == nil {
		return license.Status{}
	}
	return a.lic.Status()
}

func (a *App) Login(username, password string) string {
	if a.lic == nil {
		return "授权模块尚未初始化"
	}
	return errStr(a.lic.Login(username, password))
}

func (a *App) Register(username, email, password string) string {
	if a.lic == nil {
		return "授权模块尚未初始化"
	}
	return errStr(a.lic.Register(username, email, password))
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
	Order license.Order `json:"order"`
	Err   string        `json:"err,omitempty"`
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
	order, err := a.lic.CreateOrder(planID)
	return OrderResult{Order: order, Err: errStr(err)}
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

func (a *App) GetAnnouncements() AnnouncementsResult {
	items, err := a.lic.Announcements()
	return AnnouncementsResult{Items: items, Err: errStr(err)}
}

func (a *App) RefreshEntitlement() string {
	return errStr(a.lic.RefreshEntitlement())
}

func (a *App) Logout() string {
	if a.lic == nil {
		return ""
	}
	a.svc.Stop()
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
