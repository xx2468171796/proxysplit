// Package service orchestrates the node manager and the bundled sing-box TUN
// core behind the API bound to the Wails UI.
package service

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"proxysplit/internal/aiguard"
	"proxysplit/internal/appid"
	"proxysplit/internal/capture"
	"proxysplit/internal/core"
	"proxysplit/internal/coreupdate"
	"proxysplit/internal/logfile"
	"proxysplit/internal/nodes"
	"proxysplit/internal/powervpn"
	"proxysplit/internal/sysproxy"
)

// Sub is a subscription source.
type Sub struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	URL        string `json:"url"`
	AutoUpdate bool   `json:"autoUpdate"`
	LastUpdate string `json:"lastUpdate"`
	NodeCount  int    `json:"nodeCount"`
	// Per-subscription options (v2rayN SubItem): User-Agent for third-party
	// panels, node-name include / exclude filters (case-insensitive regex),
	// auto-update interval in minutes (0 = every 6 hours).
	UserAgent   string `json:"userAgent,omitempty"`
	Include     string `json:"include,omitempty"`
	Exclude     string `json:"exclude,omitempty"`
	IntervalMin int    `json:"intervalMin,omitempty"`
}

// Settings holds user-tunable options.
type Settings struct {
	MixedPort     int    `json:"mixedPort"`
	TunMode       bool   `json:"tunMode"` // true = system-wide TUN; false = sing-box process_name application split
	LanShare      bool   `json:"lanShare"`
	LanPort       int    `json:"lanPort"` // fixed port for the LAN proxy inbound (0 => 7890)
	LanType       string `json:"lanType"` // mixed | socks | http
	LanUser       string `json:"lanUser"` // LAN proxy auth username (empty = no auth)
	LanPass       string `json:"lanPass"` // LAN proxy auth password
	ExcludeSelf   bool   `json:"excludeSelf"`
	PrivateDirect bool   `json:"privateDirect"`
	BlockQUIC     bool   `json:"blockQUIC"`
	RemoteDNS     bool   `json:"remoteDNS"`
	FakeIP        bool   `json:"fakeIP"`
	Autostart     bool   `json:"autostart"`
	TrayClose     bool   `json:"trayClose"`
	Theme         string `json:"theme"`
	AutoUpdateApp bool   `json:"autoUpdateApp"` // 启动后自动检查已签名的客户端版本
	// 内核自动跟随面板标准内核（corefollow.go）：默认开启；零值即默认，老配置 / 旧备份导入后自动生效
	AutoUpdateCoreOff bool `json:"autoUpdateCoreOff,omitempty"`
	// Claude Code 加速（docs/Claude加速-网关切换.md）：默认开启、自动切换；零值即默认，老配置升级后自动生效
	ClaudeAccelOff     bool `json:"claudeAccelOff,omitempty"`     // 整个功能关掉（不开本机入口，恢复官方默认）
	ClaudeAccelAutoOff bool `json:"claudeAccelAutoOff,omitempty"` // 关掉自动切换（只在用户手动点编码模式时编码）
	// 接管方式（capture_svc.go）："" / "tun" = 整机虚拟网卡（默认），"process" = 仅接管选中程序（WinDivert）
	CaptureMode string `json:"captureMode,omitempty"`
	// 关掉内置「推流程序默认直连」（零值 = 开）
	StreamDirectOff bool `json:"streamDirectOff,omitempty"`
	// 日志文件保留天数（logfiles.go）：1–30，零值 / 老配置没有这个字段 = 7
	LogDays int `json:"logRetentionDays,omitempty"`
	// Net holds the DNS and TUN advanced options (settings_net.go).
	Net NetSettings `json:"net"`
}

func defaultSettings() Settings {
	return Settings{ExcludeSelf: true, PrivateDirect: true, BlockQUIC: true, RemoteDNS: true, TrayClose: true, Theme: "light", LanPort: 7890, LanType: "mixed", AutoUpdateApp: true}
}

// Routing is the in-tunnel traffic-split config (v2rayN-style).
type Routing struct {
	Enabled bool             `json:"enabled"` // master switch; when false, everything goes through the node
	Mode    string           `json:"mode"`    // core.RouteGlobal | RouteBypassCN | RouteCustom
	Rules   []core.RouteRule `json:"rules"`   // used when Mode == custom
}

// Config is the persisted application state.
type Config struct {
	Nodes       []*nodes.Node `json:"nodes"`
	SelectedID  string        `json:"selectedId"`
	Rules       []AppRule     `json:"rules"`
	Lines       []Line        `json:"lines"`       // custom lines (builtins injected at runtime)
	RuleMode    string        `json:"ruleMode"`    // blacklist | whitelist
	DefaultLine string        `json:"defaultLine"` // whitelist: line for unlisted apps
	Routing     Routing       `json:"routing"`     // now only .Enabled is used (master 分流 switch)
	Subs        []Sub         `json:"subs"`
	Settings    Settings      `json:"settings"`
	LogLevel    string        `json:"logLevel"`
	CorePort    int           `json:"corePort"`
	// ConnectivityProbeVersion invalidates cached latency values whenever the
	// definition of "available" becomes stricter. Version 2 means a successful
	// Google HTTPS /generate_204 response through the complete node tunnel.
	ConnectivityProbeVersion int `json:"connectivityProbeVersion,omitempty"`

	ClashMode    string           `json:"clashMode,omitempty"`    // rule|global|direct (persisted across restarts)
	SysProxyLast string           `json:"sysProxyLast,omitempty"` // exact host:port we last set as OS proxy (crash-recovery marker)
	APIToken     string           `json:"apiToken,omitempty"`     // stable token for the local AI-control HTTP API
	CustomRules  []core.RouteRule `json:"customRules,omitempty"`  // global user rules (域名/IP → 代理/直连/拦截), highest priority
	RuleSets     map[string]bool  `json:"ruleSets,omitempty"`     // bundled rule-set file -> enabled
	ProxyPorts   []ProxyPort      `json:"proxyPorts,omitempty"`   // 端口代理（指纹浏览器 / 局域网客户端），每个端口独立内核进程
	CustomApps   []appid.App      `json:"customApps,omitempty"`   // 用户自定义应用（一个应用对应多个进程），内置应用库见 internal/appid

	Apps []string `json:"apps,omitempty"` // legacy; migrated to Rules on load
}

// Stats is a cumulative counter snapshot surfaced to the UI. It is populated
// from sing-box's Clash API; the frontend derives bytes/second from consecutive
// snapshots.
type Stats struct {
	Running     bool  `json:"running"`
	ActiveConns int64 `json:"activeConns"`
	TotalConns  int64 `json:"totalConns"`
	Tracked     int   `json:"tracked"`
	UpBytes     int64 `json:"upBytes"`
	DownBytes   int64 `json:"downBytes"`
}

// Service ties the pieces together.
type Service struct {
	binDir  string
	dataDir string

	mu sync.Mutex
	// lifecycleMu serializes Start/Stop/reload operations.  In particular a
	// Stop clicked while TUN is still coming up must win over that in-flight
	// Start; without this lock the late Start could leave sing-box running after
	// the UI had already changed to the stopped state.
	lifecycleMu      sync.Mutex
	cfg              Config
	core             *core.Manager
	onLog            func(string)
	logs             logRing         // recent lines for diagnostics (diag.go)
	files            *logfile.Writer // daily log files (logfiles.go)
	startedAt        time.Time
	activeFP         map[string]string // running line id -> content fingerprint (change detection)
	clashPort        int               // clash_api external controller port of the running core
	clashSecret      string            // clash_api bearer secret
	trafficStats     Stats             // last successful clash_api counter snapshot
	clashMode        string            // last-applied clash mode: rule|global|direct (default rule)
	sysProxyOn       bool              // the Windows system proxy is currently applied by us
	sysProxyWant     bool              // user wants system proxy on — re-applied (new port) each Start
	startGuard       func() error      // commercial entitlement gate for every start/restart path
	directDomainList []string          // hosts always routed outside the tunnel (our API)
	healthCache      atomic.Value      // []LineHealth — refreshed by the background health loop
	run              *runState         // running app-split core (nil in 整机全局 / stopped)
	accelPort        int               // Claude Code 加速本机入口端口（进程内固定）
	accelOut         string            // 该入口当前走的出站（Claude Code 所用线路）
	pv               *powervpn.Client  // POWER云 panel client (nil in tests)
	aiGuard          bool              // AI 强制走线路（aiguard.go；App 按中转站客户开关）
	aiGuardOut       string            // 运行中的内核 AI 走的出站（"" = 没开）
	aiLock           aiLockState       // AI 访问锁的预热 / 检测 / 停止倒计时（ailock.go）
	aiProxyPort      int               // 给其他程序用的 AI 线路代理端口（本次运行固定；0 = 还没分配）
	aiProxyUser      string
	aiProxyPass      string
	aiProxyFile      string // 约定文件（App 设置），见 aiproxy.go
	aiProxyState     AIProxyInfo
	exitProbe        core.AIProxy // AI 页测分应用代理出口的本机入口（TUN 模式，本次运行固定）
	hostIPv6Seen     atomic.Bool  // hostIPv6: last answer measured with the core stopped
	hostIPv6Known    atomic.Bool
	exits            exitsCache      // AI 页实时出口 IP（exits.go）
	google           googleProbe     // 概览 Google 延迟（link_svc.go）
	capEng           *capture.Engine // 仅接管选中程序的抓包引擎（capture_svc.go；nil = TUN）
	wdFetch          chan struct{}   // in-flight WinDivert download (prefetchWinDivert)
	wdReady          func() bool     // nil = coreupdate.WinDivertReady (tests stub it)
	wdBroken         atomic.Bool     // WinDivert failed to open this run: use the TUN until restart
	wdNote           atomic.Value    // string: captureFallbackNote, computed once at the fallback

	followOnce    sync.Once // core follow (corefollow.go)
	followStart   sync.Once
	follower      *coreFollower
	followTrigger chan struct{}

	ruleSyncStart sync.Once // rule-set mirror sync (rulesets.go)

	ports portSet // 端口代理运行状态（proxyports.go）

	appMon appid.Monitor // 逐应用连接监测（appmonitor.go）
	tap    logTap        // 客户端日志上报（telemetry_tap.go）
	warm   warmState     // 节点保活 + DNS 预热（warm_svc.go）

	quit      chan struct{} // closed by Close: stops the background loops
	closeOnce sync.Once
}

// Close stops the background loops started by New (health, app monitor). Safe
// to call more than once; it does not stop the core (use Stop for that).
func (s *Service) Close() {
	s.closeOnce.Do(func() {
		if s.quit != nil {
			close(s.quit)
			s.closeLogFiles()
		}
	})
}

// New loads (or initializes) config from dataDir.
func New(binDir, dataDir string) (*Service, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	s := &Service{binDir: binDir, dataDir: dataDir, onLog: func(string) {}, quit: make(chan struct{})}
	s.load()
	s.openLogFiles()              // first: everything below may log
	s.clashMode = s.cfg.ClashMode // restore last runtime mode (rule|global|direct)
	s.core = core.NewManager(filepath.Join(binDir, coreupdate.SingBoxExe), dataDir, func(line string) { s.log(line) })
	sysproxy.Core = s.singBoxPath() // macOS: the control script runs this core
	if exe, err := os.Executable(); err == nil {
		appid.SetProtected(filepath.Dir(exe), binDir) // whole-folder rules may never cover ProxySplit itself
	}
	s.core.SetOnExit(s.onCoreExit)                                                                        // clear a dangling system proxy if the core crashes
	s.core.CleanStrays()                                                                                  // kill orphaned sing-box from a prior crash (else it keeps proxying)
	core.KillPortStrays(filepath.Join(binDir, coreupdate.SingBoxExe), dataDir)                            // 端口代理 orphans, before any port can start
	core.CleanProbeStrays(filepath.Join(binDir, coreupdate.SingBoxExe), filepath.Join(dataDir, "probes")) // latency-probe Xray orphans + temp dirs
	s.healStaleSystemProxy()                                                                              // recover from a prior crash that left one dangling
	s.SyncAILock()                                                                                        // crash / power-off left the AI lock on the tunnel: close it before anything else
	if err := aiguard.EnsureBootTask(); err != nil {
		s.log("[AI] " + err.Error())
	}
	s.startScheduler()
	go s.healthLoop() // live line/node reachability for the status panel
	go s.appMonitorLoop()
	go s.connLogLoop() // per-connection routing record in the day file (logfiles.go)
	s.registerCacheResetters()
	return s, nil
}

// SetStartGuard installs the single authorization gate used by all lifecycle
// paths, including internal live-reload restarts. Keeping it inside Service
// prevents UI, tray, local API or settings changes from bypassing licensing.
func (s *Service) SetStartGuard(guard func() error) {
	s.mu.Lock()
	s.startGuard = guard
	s.mu.Unlock()
}

// SetDirectDomains marks hosts that must never be tunnelled (our own commercial
// API: the backend is hosted domestically, so routing it through an overseas
// node would slow down or break login and lease renewal).
func (s *Service) SetDirectDomains(domains []string) {
	s.mu.Lock()
	s.directDomainList = append([]string(nil), domains...)
	s.mu.Unlock()
}

func (s *Service) directDomains() []string {
	return append([]string(nil), s.directDomainList...)
}

// subDefaultInterval is the auto-update period when a subscription sets none.
const subDefaultInterval = 6 * time.Hour

// startScheduler auto-updates subscriptions that opt in, each on its own
// interval (checked every minute; the first run comes one interval after
// launch, as before).
func (s *Service) startScheduler() {
	go func() {
		t := time.NewTicker(time.Minute)
		defer t.Stop()
		started := time.Now()
		last := map[string]time.Time{}
		for range t.C {
			now := time.Now()
			for _, sub := range s.GetSubs() {
				if !sub.AutoUpdate {
					continue
				}
				every := subDefaultInterval
				if sub.IntervalMin > 0 {
					every = time.Duration(max(sub.IntervalMin, 10)) * time.Minute
				}
				prev, ok := last[sub.ID]
				if !ok {
					prev = started
				}
				if now.Sub(prev) < every {
					continue
				}
				last[sub.ID] = now
				if err := s.UpdateSub(sub.ID); err != nil {
					s.log(fmt.Sprintf("[subs] auto-update %s failed: %v", sub.Name, err))
				} else {
					s.log(fmt.Sprintf("[subs] auto-updated %s", sub.Name))
				}
			}
		}
	}()
}

// SetLogSink registers the UI log callback.
func (s *Service) SetLogSink(fn func(string)) {
	s.mu.Lock()
	s.onLog = fn
	s.mu.Unlock()
}

func (s *Service) log(line string) {
	s.logs.add(line)
	s.tap.send(line)    // telemetry spool (telemetry_tap.go)
	s.files.Write(line) // daily log file (logfiles.go)
	s.appMon.OnLog(line, time.Now())
	s.mu.Lock()
	fn := s.onLog
	s.mu.Unlock()
	if fn != nil {
		fn(line)
	}
}

// LogLine emits a line to the UI log (public wrapper around log).
func (s *Service) LogLine(line string) { s.log(line) }

// APIToken returns the stable local-API token, generating + persisting one the
// first time it is requested.
func (s *Service) APIToken() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cfg.APIToken == "" {
		s.cfg.APIToken = genSecret() + genSecret()
		s.save()
	}
	return s.cfg.APIToken
}
