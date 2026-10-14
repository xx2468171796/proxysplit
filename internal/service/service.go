// Package service orchestrates the node manager and the bundled sing-box TUN
// core behind the API bound to the Wails UI.
package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"proxysplit/internal/core"
	"proxysplit/internal/coreupdate"
	"proxysplit/internal/engine"
	"proxysplit/internal/geoupdate"
	"proxysplit/internal/icon"
	"proxysplit/internal/latency"
	"proxysplit/internal/nodes"
	"proxysplit/internal/powervpn"
	"proxysplit/internal/proc"
)

// Sub is a subscription source.
type Sub struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	URL        string `json:"url"`
	AutoUpdate bool   `json:"autoUpdate"`
	LastUpdate string `json:"lastUpdate"`
	NodeCount  int    `json:"nodeCount"`
}

// Settings holds user-tunable options.
type Settings struct {
	MixedPort       int    `json:"mixedPort"`
	TunMode         bool   `json:"tunMode"` // true = system-wide TUN; false = sing-box process_name application split
	LanShare        bool   `json:"lanShare"`
	LanPort         int    `json:"lanPort"` // fixed port for the LAN proxy inbound (0 => 7890)
	LanType         string `json:"lanType"` // mixed | socks | http
	LanUser         string `json:"lanUser"` // LAN proxy auth username (empty = no auth)
	LanPass         string `json:"lanPass"` // LAN proxy auth password
	ExcludeSelf     bool   `json:"excludeSelf"`
	PrivateDirect   bool   `json:"privateDirect"`
	BlockQUIC       bool   `json:"blockQUIC"`
	RemoteDNS       bool   `json:"remoteDNS"` // 开 = 境外域名 Fake IP、由节点解析（core/dns.go）；关 = 全部国内 DNS
	FakeIP          bool   `json:"fakeIP"`    // 早期预留、从未接线；Fake IP 跟 RemoteDNS 走，留着只为兼容旧配置
	Autostart       bool   `json:"autostart"`
	TrayClose       bool   `json:"trayClose"`
	Theme           string `json:"theme"`
	AutoUpdateRules bool   `json:"autoUpdateRules"` // 添加节点后自动更新分流规则集(可选,默认关)
	AutoUpdateApp   bool   `json:"autoUpdateApp"`   // 启动后自动检查已签名的客户端版本
	// 内核自动跟随面板标准内核（corefollow.go）：默认开启；零值即默认，老配置 / 旧备份导入后自动生效
	AutoUpdateCoreOff bool `json:"autoUpdateCoreOff,omitempty"`
	// Claude Code 加速（docs/Claude加速-网关切换.md）：默认开启、自动切换；零值即默认，老配置升级后自动生效
	ClaudeAccelOff     bool `json:"claudeAccelOff,omitempty"`     // 整个功能关掉（不开本机入口，恢复官方默认）
	ClaudeAccelAutoOff bool `json:"claudeAccelAutoOff,omitempty"` // 关掉自动切换（只在用户手动点编码模式时编码）
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

// Status is a snapshot for the UI.
type Status struct {
	CoreRunning   bool   `json:"coreRunning"`
	EngineRunning bool   `json:"engineRunning"`
	CorePort      int    `json:"corePort"`
	NodeName      string `json:"nodeName"`
	SelectedID    string `json:"selectedId"`
	RuleMode      string `json:"ruleMode"`
	UptimeSec     int64  `json:"uptimeSec"`
	Stats         Stats  `json:"stats"`
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

	followOnce    sync.Once // core follow (corefollow.go)
	followStart   sync.Once
	follower      *coreFollower
	followTrigger chan struct{}
}

// New loads (or initializes) config from dataDir.
func New(binDir, dataDir string) (*Service, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	s := &Service{binDir: binDir, dataDir: dataDir, onLog: func(string) {}}
	s.load()
	s.clashMode = s.cfg.ClashMode // restore last runtime mode (rule|global|direct)
	s.core = core.NewManager(filepath.Join(binDir, "sing-box.exe"), dataDir, func(line string) { s.log(line) })
	s.core.SetOnExit(s.onCoreExit) // clear a dangling system proxy if the core crashes
	s.core.CleanStrays()           // kill orphaned sing-box from a prior crash (else it keeps proxying)
	s.healStaleSystemProxy()       // recover from a prior crash that left one dangling
	s.startScheduler()
	go s.healthLoop() // live line/node reachability for the status panel
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

// startScheduler periodically auto-updates subscriptions that opt in.
func (s *Service) startScheduler() {
	go func() {
		t := time.NewTicker(6 * time.Hour)
		defer t.Stop()
		for range t.C {
			for _, sub := range s.GetSubs() {
				if !sub.AutoUpdate {
					continue
				}
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
	s.mu.Lock()
	fn := s.onLog
	s.mu.Unlock()
	if fn != nil {
		fn(line)
	}
}

// LogLine emits a line to the UI log (public wrapper around log).
func (s *Service) LogLine(line string) { s.log(line) }

func (s *Service) configPath() string { return filepath.Join(s.dataDir, "config.json") }

// altConfigPath is a redundant copy of the config kept next to the .exe, so the
// user's nodes/rules survive even if %APPDATA% is wiped by a cleaner tool. It is
// best-effort: "" when the exe dir can't be determined; writes are ignored if
// the folder is read-only (e.g. Program Files).
func (s *Service) altConfigPath() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	// `go test` runs every case from the same temporary *.test executable.
	// Writing a portable backup beside that binary leaks one test's nodes into
	// the next test's otherwise-isolated dataDir.  Production binaries never use
	// this suffix, so disable the exe-adjacent store only for test executables.
	if strings.HasSuffix(strings.ToLower(filepath.Base(exe)), ".test.exe") ||
		strings.HasSuffix(strings.ToLower(filepath.Base(exe)), ".test") {
		return ""
	}
	return filepath.Join(filepath.Dir(exe), "proxysplit-data.json")
}

// isCoreConfig reports whether data is a sing-box config (which has outbounds /
// inbounds) rather than the app config — a guard against ever loading a file the
// core clobbered into place.
func isCoreConfig(data []byte) bool {
	return bytes.Contains(data, []byte(`"outbounds"`)) || bytes.Contains(data, []byte(`"inbounds"`))
}

func decodeAppConfig(data []byte) (Config, bool) {
	var cfg Config
	if len(data) == 0 || !json.Valid(data) || isCoreConfig(data) || json.Unmarshal(data, &cfg) != nil {
		return Config{}, false
	}
	return cfg, true
}

func (s *Service) load() {
	// Read the main config; if it is missing, corrupt, or was clobbered by the
	// core's sing-box config (a past bug wrote it here), fall back to the last
	// known-good backup so the user's nodes/rules are never lost.
	data, err := os.ReadFile(s.configPath())
	decoded, ok := decodeAppConfig(data)
	bad := err != nil || !ok
	if bad {
		// Recovery chain: .bak (same dir) → the redundant copy next to the exe.
		recovered := false
		if bak, berr := os.ReadFile(s.configPath() + ".bak"); berr == nil {
			if candidate, valid := decodeAppConfig(bak); valid {
				data = bak
				decoded = candidate
				s.log("[store] 主配置异常,已从备份恢复节点/规则")
				_ = os.WriteFile(s.configPath(), bak, 0o600)
				recovered = true
			}
		}
		if !recovered {
			if alt := s.altConfigPath(); alt != "" {
				if ad, aerr := os.ReadFile(alt); aerr == nil {
					if candidate, valid := decodeAppConfig(ad); valid {
						data = ad
						decoded = candidate
						s.log("[store] 从 exe 旁的备份 proxysplit-data.json 恢复节点/规则")
						_ = os.WriteFile(s.configPath(), ad, 0o600)
						recovered = true
					}
				}
			}
		}
		if !recovered {
			data = nil // nothing usable — start clean rather than importing junk
		}
	}
	if len(data) > 0 {
		s.cfg = decoded
	}
	// Defaults / migration.
	if s.cfg.LogLevel == "" {
		s.cfg.LogLevel = "info"
	}
	if s.cfg.RuleMode == "" {
		// 只代理列出的 — what the UI recommends; 默认全走代理 is opt-in.
		s.cfg.RuleMode = engine.ModeWhitelist
	}
	if s.cfg.DefaultLine == "" {
		s.cfg.DefaultLine = LineRule
	}
	s.cfg.RuleSets = normalizeRuleSetConfig(s.cfg.RuleSets)
	if s.cfg.Settings.Theme == "" {
		s.cfg.Settings = defaultSettings()
	}
	// Existing v1.8.2 configs predate this field. Opt them into startup checks
	// while still preserving an explicit false saved by newer versions.
	if len(data) == 0 || !bytes.Contains(data, []byte(`"autoUpdateApp"`)) {
		s.cfg.Settings.AutoUpdateApp = true
	}
	// Legacy string apps -> rules.
	if len(s.cfg.Rules) == 0 && len(s.cfg.Apps) > 0 {
		def := LineGlobal
		if s.cfg.Routing.Enabled && s.cfg.Routing.Mode == core.RouteBypassCN {
			def = LineRule
		}
		for _, a := range s.cfg.Apps {
			s.cfg.Rules = append(s.cfg.Rules, AppRule{Match: a, Path: a, Line: def, Enabled: true})
		}
		s.cfg.Apps = nil
	}
	// Migrate legacy action/follow rules to lines.
	for i := range s.cfg.Rules {
		migrateRuleLocked(&s.cfg.Rules[i], s.cfg.Routing)
	}
	// Never resurrect design-preview endpoints from an old/hand-edited backup.
	// The desktop client has no built-in nodes: every displayed node must have
	// come from the user's import, subscription, or manual entry.
	placeholdersDropped := s.dropPlaceholderNodesLocked()
	refsHealed := s.healDanglingNodeRefsLocked()
	probeMigrated := false
	if s.cfg.ConnectivityProbeVersion < 2 {
		for _, n := range s.cfg.Nodes {
			if n != nil {
				n.Latency = 0
				n.TCPLatency = 0
			}
		}
		s.cfg.ConnectivityProbeVersion = 2
		probeMigrated = true
	}
	if placeholdersDropped || refsHealed || probeMigrated {
		s.save()
	}
}

// dropPlaceholderNodesLocked removes only IANA documentation endpoints. They
// cannot be real proxy servers and were used solely by historic UI prototypes
// (for example jp01.example.net). The caller must hold s.mu when the service is
// already live; load calls it before the service becomes concurrent.
func (s *Service) dropPlaceholderNodesLocked() bool {
	kept := s.cfg.Nodes[:0]
	removed := false
	selectedStillPresent := false
	for _, n := range s.cfg.Nodes {
		if n == nil || isPlaceholderEndpoint(n.Server) {
			removed = true
			continue
		}
		kept = append(kept, n)
		if n.ID == s.cfg.SelectedID {
			selectedStillPresent = true
		}
	}
	s.cfg.Nodes = kept
	if !selectedStillPresent {
		s.cfg.SelectedID = ""
		if len(kept) > 0 {
			s.cfg.SelectedID = kept[0].ID
		}
	}
	return removed
}

func isPlaceholderEndpoint(server string) bool {
	host := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(server)), ".")
	for _, domain := range []string{"example.com", "example.net", "example.org", "example.edu"} {
		if host == domain || strings.HasSuffix(host, "."+domain) {
			return true
		}
	}
	return false
}

// save writes the config atomically: it snapshots the current good file to
// <config>.bak, writes the new content to <config>.tmp, then renames it over the
// live file (an atomic op on the same volume). A crash mid-write leaves the old
// config intact, so data is never lost to a partial write.
func (s *Service) save() {
	data, err := json.MarshalIndent(&s.cfg, "", "  ")
	if err != nil {
		s.log("[store] 序列化配置失败: " + err.Error())
		return
	}
	path := s.configPath()
	// Snapshot the current valid app-config file as the recovery backup (never a
	// core-config, so .bak always holds real nodes/rules).
	if cur, rerr := os.ReadFile(path); rerr == nil && json.Valid(cur) && !isCoreConfig(cur) {
		_ = os.WriteFile(path+".bak", cur, 0o600)
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		s.log("[store] 写入配置失败: " + err.Error())
		return
	}
	if err := os.Rename(tmp, path); err != nil {
		s.log("[store] 保存配置失败: " + err.Error())
		_ = os.Remove(tmp)
	}
	// Redundant copy next to the exe (best-effort; ignore read-only folders).
	if alt := s.altConfigPath(); alt != "" {
		_ = os.WriteFile(alt, data, 0o600)
	}
}

// persistLocked is the error-returning variant used by configuration restore.
// Most legacy mutators use save() as best effort, but an import must never claim
// success unless the new snapshot is already durable on disk. Caller holds s.mu.
func (s *Service) persistLocked() error {
	data, err := json.MarshalIndent(&s.cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("serialize config: %w", err)
	}
	path := s.configPath()
	if cur, rerr := os.ReadFile(path); rerr == nil && json.Valid(cur) && !isCoreConfig(cur) {
		if err := os.WriteFile(path+".bak", cur, 0o600); err != nil {
			return fmt.Errorf("write recovery backup: %w", err)
		}
	}
	tmp := path + ".import.tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return fmt.Errorf("write imported config: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("activate imported config: %w", err)
	}
	if alt := s.altConfigPath(); alt != "" {
		_ = os.WriteFile(alt, data, 0o600)
	}
	return nil
}

// --- Nodes ---

// AddNodes parses share links from text and appends new (non-duplicate) nodes.
func (s *Service) AddNodes(text string) (added, skipped int) {
	parsed, skip := nodes.ParseMany(text)
	parsed = s.officializePasted(parsed) // POWER云 links → official nodes (network; no lock held)
	s.mu.Lock()
	added = s.mergeNodesLocked(parsed, "")
	if s.cfg.SelectedID == "" && len(s.cfg.Nodes) > 0 {
		s.cfg.SelectedID = s.cfg.Nodes[0].ID
	}
	s.save()
	s.mu.Unlock()
	if added > 0 {
		s.maybeAutoUpdateRules() // opt-in: refresh rule-sets after adding a node
	}
	return added, skip
}

// mergeNodesLocked appends non-duplicate nodes, tagging them with subID.
func (s *Service) mergeNodesLocked(list []*nodes.Node, subID string) int {
	existing := map[string]bool{}
	for _, n := range s.cfg.Nodes {
		existing[n.ID] = true
	}
	added := 0
	for _, n := range list {
		if existing[n.ID] {
			continue
		}
		n.SubID = subID
		s.cfg.Nodes = append(s.cfg.Nodes, n)
		existing[n.ID] = true
		added++
	}
	return added
}

// AddManualNode adds a node from hand-entered fields (socks/http/etc.). Returns
// "" on success or an error string.
func (s *Service) AddManualNode(nodeType, name, server string, port int, username, password string) string {
	n, err := nodes.Manual(nodeType, name, server, port, username, password)
	if err != nil {
		return err.Error()
	}
	s.mu.Lock()
	added := s.mergeNodesLocked([]*nodes.Node{n}, "")
	if s.cfg.SelectedID == "" && len(s.cfg.Nodes) > 0 {
		s.cfg.SelectedID = s.cfg.Nodes[0].ID
	}
	s.save()
	s.mu.Unlock()
	if added == 0 {
		return "节点已存在"
	}
	s.maybeAutoUpdateRules() // opt-in: refresh rule-sets after adding a node
	return ""
}

// Nodes returns deep copies of the configured nodes. Copies (not the live
// pointers) are handed to the UI so the Wails marshaler never reads a Node struct
// while a latency test is writing to it.
func (s *Service) Nodes() []*nodes.Node {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*nodes.Node, 0, len(s.cfg.Nodes))
	for _, n := range s.cfg.Nodes {
		c := *n
		out = append(out, &c)
	}
	return out
}

// RemoveNode deletes a node by id.
func (s *Service) RemoveNode(id string) string {
	s.mu.Lock()
	kept := s.cfg.Nodes[:0]
	for _, n := range s.cfg.Nodes {
		if n.ID != id {
			kept = append(kept, n)
		}
	}
	s.cfg.Nodes = kept
	s.healDanglingNodeRefsLocked()
	s.save()
	s.mu.Unlock()
	return restartMsg(s.applyLive())
}

// SelectNode sets the active node (and restarts if a running line follows it).
func (s *Service) SelectNode(id string) string {
	s.mu.Lock()
	s.cfg.SelectedID = id
	s.save()
	s.mu.Unlock()
	return restartMsg(s.applyLive())
}

func (s *Service) selectedNode() *nodes.Node {
	for _, n := range s.cfg.Nodes {
		if n.ID == s.cfg.SelectedID {
			return n
		}
	}
	return nil
}

func (s *Service) nodeByID(id string) *nodes.Node {
	for _, n := range s.cfg.Nodes {
		if n.ID == id {
			return n
		}
	}
	return nil
}

// TestLatency measures one node and stores the result. measureNode starts an
// isolated core when necessary, then requires a real Google HTTPS 204 response
// through the complete protocol tunnel.
func (s *Service) TestLatency(id string) int {
	s.mu.Lock()
	n := s.nodeByID(id)
	var snap nodes.Node
	if n != nil {
		snap = *n
	}
	s.mu.Unlock()
	if n == nil {
		return -1
	}
	res := s.measureNode(&snap, 8*time.Second)
	s.mu.Lock()
	if current := s.nodeByID(id); current != nil {
		current.Latency = res.Latency
		current.TCPLatency = res.TCPLatency
		if res.Speed > 0 {
			current.Speed = res.Speed
		}
		s.save()
	}
	s.mu.Unlock()
	return res.Latency
}

// TestTCP measures ONLY the raw TCP latency to a node's edge (direct dial +
// protocol handshake, no proxy tunnel). It is fast and needs no core, so it is
// the cheap "is the line reachable at all" check, distinct from TestLatency's
// full Google end-to-end probe. Returns ms, -1 on failure.
func (s *Service) TestTCP(id string) int {
	s.mu.Lock()
	n := s.nodeByID(id)
	var snap nodes.Node
	if n != nil {
		snap = *n
	}
	s.mu.Unlock()
	if n == nil {
		return -1
	}
	res := latency.Measure(&snap, "", 6*time.Second)
	s.mu.Lock()
	if current := s.nodeByID(id); current != nil {
		current.TCPLatency = res.TCPLatency
		s.save()
	}
	s.mu.Unlock()
	return res.TCPLatency
}

// TestAllLatency measures every node.
func (s *Service) TestAllLatency() {
	s.mu.Lock()
	snaps := make([]nodes.Node, 0, len(s.cfg.Nodes))
	for _, n := range s.cfg.Nodes {
		if n != nil {
			snaps = append(snaps, *n)
		}
	}
	s.mu.Unlock()

	type measured struct {
		id      string
		latency int
		tcp     int
	}
	jobs := make(chan nodes.Node)
	results := make(chan measured, len(snaps))
	workers := 4
	if len(snaps) < workers {
		workers = len(snaps)
	}
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for n := range jobs {
				r := s.measureNode(&n, 8*time.Second)
				results <- measured{id: n.ID, latency: r.Latency, tcp: r.TCPLatency}
			}
		}()
	}
	go func() {
		for _, n := range snaps {
			jobs <- n
		}
		close(jobs)
		wg.Wait()
		close(results)
	}()

	measuredResults := make([]measured, 0, len(snaps))
	for r := range results {
		measuredResults = append(measuredResults, r)
	}
	s.mu.Lock()
	for _, r := range measuredResults {
		if n := s.nodeByID(r.id); n != nil {
			n.Latency = r.latency
			n.TCPLatency = r.tcp
		}
	}
	s.save()
	s.mu.Unlock()
}

// --- App rules ---

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

// UpsertAppRule adds or updates a single app rule (used by the control API).
// The complete candidate set is passed through the same validation as the UI,
// so API callers cannot persist dangling line/node references.
func (s *Service) UpsertAppRule(match, path, line, node string, enabled bool) {
	match = strings.TrimSpace(match)
	if match == "" {
		return
	}
	s.mu.Lock()
	rules := append([]AppRule{}, s.cfg.Rules...)
	s.mu.Unlock()
	found := false
	for i := range rules {
		if strings.EqualFold(rules[i].Match, match) {
			rules[i].Line = line
			rules[i].Node = node
			if path != "" {
				rules[i].Path = path
			}
			rules[i].Enabled = enabled
			found = true
			break
		}
	}
	if !found {
		p := path
		if p == "" {
			p = match
		}
		rules = append(rules, AppRule{Match: match, Path: p, Line: line, Node: node, Enabled: enabled})
	}
	if msg := s.SetAppRules(rules); msg != "" {
		s.log("[rules] control API rule rejected: " + msg)
	}
}

// RemoveAppRule deletes the rule whose Match equals the given name.
func (s *Service) RemoveAppRule(match string) {
	s.mu.Lock()
	out := s.cfg.Rules[:0]
	for _, r := range s.cfg.Rules {
		if !strings.EqualFold(r.Match, match) {
			out = append(out, r)
		}
	}
	s.cfg.Rules = out
	s.save()
	s.mu.Unlock()
	_ = s.applyAppRules() // failure is logged; the rule is already removed from config
}

// GetAppRules returns the app -> line rule set.
func (s *Service) GetAppRules() []AppRule {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Non-nil empty slice → JSON `[]`, never `null`. A null here makes the
	// frontend safe() fall back to demo apps, so an empty rule set would show
	// PHANTOM apps (Code.exe/Chrome.exe…) that are not actually captured →
	// user thinks apps are added but nothing is proxied.
	return append([]AppRule{}, s.cfg.Rules...)
}

// SetAppRules replaces the rule set and applies it live (restarting the core if
// the set of active lines changed, since that requires new inbounds).
func (s *Service) SetAppRules(rules []AppRule) string {
	s.mu.Lock()
	kept, err := s.normalizeAppRulesLocked(rules)
	if err != nil {
		s.mu.Unlock()
		return err.Error()
	}
	s.cfg.Rules = kept
	s.save()
	s.mu.Unlock()
	if err := s.applyAppRules(); err != nil {
		return "已保存,但代理重新生效失败: " + err.Error()
	}
	return ""
}

// GetLines returns builtin + custom lines. GetLinesCustom returns just custom.
func (s *Service) GetLines() []Line {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.allLinesLocked()
}

// SetLines replaces the CUSTOM lines (builtins are ignored/kept).
func (s *Service) SetLines(lines []Line) string {
	s.mu.Lock()
	custom, err := s.normalizeCustomLinesLocked(lines)
	if err != nil {
		s.mu.Unlock()
		return err.Error()
	}
	s.cfg.Lines = custom
	valid := map[string]bool{LineDirect: true, LineBlock: true, LineGlobal: true, LineRule: true}
	for _, line := range custom {
		valid[line.ID] = true
	}
	// Deleting a custom line never leaves invisible/dangling app mappings.
	for i := range s.cfg.Rules {
		if !valid[s.cfg.Rules[i].Line] {
			s.cfg.Rules[i].Line = LineRule
			s.cfg.Rules[i].Node = ""
		}
	}
	if !valid[s.cfg.DefaultLine] {
		s.cfg.DefaultLine = LineRule
	}
	s.save()
	s.mu.Unlock()
	return restartMsg(s.applyLive())
}

// GetRuleMode / SetRuleMode manage blacklist vs whitelist.
func (s *Service) GetRuleMode() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cfg.RuleMode
}

func (s *Service) SetRuleMode(mode string) string {
	mode = strings.ToLower(strings.TrimSpace(mode))
	if mode != "blacklist" && mode != "whitelist" {
		return "应用分流模式无效: " + mode
	}
	s.mu.Lock()
	s.cfg.RuleMode = mode
	s.save()
	s.mu.Unlock()
	return restartMsg(s.applyLive())
}

// GetDefaultLine / SetDefaultLine manage the line for unlisted apps in
// 默认全走代理 (blacklist); in 只代理列出的 unlisted apps always go direct.
func (s *Service) GetDefaultLine() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cfg.DefaultLine
}

func (s *Service) SetDefaultLine(id string) string {
	s.mu.Lock()
	if id == "" {
		id = LineRule
	}
	if lineByID(s.allLinesLocked(), id) == nil {
		s.mu.Unlock()
		return "默认线路不存在: " + id
	}
	if id == LineBlock {
		s.mu.Unlock()
		return "没列出的程序不能设为拦截（会断开整台电脑的网络）"
	}
	changed := s.cfg.DefaultLine != id
	s.cfg.DefaultLine = id
	s.save()
	blacklist := s.cfg.RuleMode == "blacklist"
	s.mu.Unlock()
	if !changed || !blacklist {
		return "" // only 默认全走代理 routes unlisted apps by it
	}
	return restartMsg(s.applyLive())
}

// applyLive re-applies a rule/line change to the running core. In the
// sing-box-native model (TUN / 应用分流) the app rules live in the core config,
// so a change is applied by regenerating + reloading the config (restart while
// running).
func (s *Service) applyLive() error {
	if err := s.restart(); err != nil {
		s.log("[service] reload after rule change failed: " + err.Error())
		return err
	}
	return nil
}

// restart stops and starts a running core under one lifecycle lock, so a Stop
// from the user cannot slip in between and be undone by the Start, and
// concurrent changes restart one after the other. No-op when stopped.
func (s *Service) restart() error {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	if !s.core.Running() {
		return nil
	}
	s.stopLocked()
	return s.startLocked()
}

// applyAppRules makes an app-rule change take effect on the running core.
// Moving apps between the lists the core already has (拦截 / 直连 / 规则 / 全局
// on the active node, lines already in use) only rewrites rule-set files: no
// restart, other apps keep their connections, and the changed apps' open
// connections are closed so they reconnect under the new route. Anything
// structural (new node or line, target-scoped rules) restarts the core.
func (s *Service) applyAppRules() error {
	s.lifecycleMu.Lock()
	s.mu.Lock()
	run := s.run
	if run == nil {
		// Stopped (nothing to apply), or 整机全局 where app rules have no effect.
		s.mu.Unlock()
		s.lifecycleMu.Unlock()
		return nil
	}
	opts := run.base
	sum := s.splitOptionsLocked(&opts, run.node)
	port, secret := s.clashPort, s.clashSecret
	s.mu.Unlock()
	ok, err := s.core.ApplySplitLists(run.node, run.level, run.route, nil, opts)
	if err != nil || !ok {
		s.lifecycleMu.Unlock()
		if err != nil {
			s.log("[service] 实时更新应用规则失败,改为重启内核: " + err.Error())
		}
		return s.applyLive()
	}
	changed := changedApps(run.targets, sum.targets)
	s.mu.Lock()
	run.targets = sum.targets
	s.mu.Unlock()
	s.lifecycleMu.Unlock()
	if len(changed) == 0 {
		s.log("[service] 应用规则已实时生效(未重启)")
		return nil
	}
	// sing-box reloads a rewritten rule-set file asynchronously (file watcher,
	// ~0.1 s measured). Closing right away lets an app that reconnects at once
	// (browsers, WebSockets) come back on its old route and keep it, so wait
	// for the reload before cutting the old connections.
	go func() {
		time.Sleep(ruleSetReloadWait)
		closed := closeProcessConnections(port, secret, changed)
		s.log(fmt.Sprintf("[service] 应用规则已实时生效(未重启): %d 个应用变动, 断开其旧连接 %d 条", len(changed), closed))
	}()
	return nil
}

// ruleSetReloadWait is how long to give sing-box to pick up rewritten app
// lists before closing the affected apps' connections.
var ruleSetReloadWait = 600 * time.Millisecond

// lineOutbound resolves a line's (or an app's) node choice to an outbound tag:
// "proxy" for the active node, "direct" for a custom line whose exit is 直连,
// or "node-<id>" (registered in extra) for another node. A node that no longer
// exists falls back to the active node.
func lineOutbound(nodeID, activeID string, nodeByID map[string]*nodes.Node, extra map[string]*nodes.Node) string {
	if nodeID == LineDirect {
		return "direct"
	}
	if nodeID == "" || nodeID == "active" || nodeID == activeID {
		return "proxy"
	}
	n, ok := nodeByID[nodeID]
	if !ok {
		return "proxy"
	}
	tag := "node-" + nodeID
	extra[tag] = n
	return tag
}

// changedApps returns the app names (lower-case) whose routing differs.
func changedApps(before, after map[string]string) map[string]bool {
	out := map[string]bool{}
	for k, v := range before {
		if after[k] != v {
			out[k] = true
		}
	}
	for k, v := range after {
		if before[k] != v {
			out[k] = true
		}
	}
	return out
}

// selfProcess is our own executable name when 代理程序自身不走代理 is on.
func selfProcess(exclude bool) string {
	if !exclude {
		return ""
	}
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	return filepath.Base(exe)
}

// restartMsg turns a failed live re-apply into the UI message ("" = fine).
func restartMsg(err error) string {
	if err == nil {
		return ""
	}
	return "已保存,但代理重新启动失败: " + err.Error()
}

// Apps / SetApps are legacy string wrappers (proxy = a global-line rule).
func (s *Service) Apps() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []string
	for _, r := range s.cfg.Rules {
		if r.Enabled && r.Line != LineDirect && r.Line != LineBlock {
			out = append(out, r.Match)
		}
	}
	return out
}

func (s *Service) SetApps(apps []string) {
	rules := make([]AppRule, 0, len(apps))
	for _, a := range apps {
		rules = append(rules, AppRule{Match: a, Path: a, Line: LineGlobal, Enabled: true})
	}
	s.SetAppRules(rules)
}

// ListProcesses returns running executables for the picker UI.
func (s *Service) ListProcesses() ([]proc.ProcInfo, error) { return proc.ListProcesses() }

// GetAppIcon returns a PNG data URI for an executable's icon (best effort).
func (s *Service) GetAppIcon(exePath string) string {
	uri, err := icon.PNGBase64(exePath)
	if err != nil {
		return ""
	}
	return uri
}

// --- Subscriptions ---

// GetSubs returns configured subscriptions.
func (s *Service) GetSubs() []Sub {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Sub{}, s.cfg.Subs...) // non-nil → JSON [] (avoid phantom demo subs on empty)
}

// AddSub adds a subscription, fetches it and merges its nodes.
func (s *Service) AddSub(name, url string, autoUpdate bool) error {
	name, url = strings.TrimSpace(name), strings.TrimSpace(url)
	if name == "" || url == "" {
		return fmt.Errorf("订阅名称和地址不能为空")
	}
	list, err := s.fetchSubscription(url)
	if err != nil {
		return err
	}
	sub := Sub{ID: subID(url), Name: name, URL: url, AutoUpdate: autoUpdate}
	s.mu.Lock()
	for _, e := range s.cfg.Subs {
		if e.ID == sub.ID || strings.EqualFold(strings.TrimSpace(e.URL), url) {
			s.mu.Unlock()
			return fmt.Errorf("订阅地址已存在")
		}
	}
	s.cfg.Subs = append(s.cfg.Subs, sub)
	s.replaceSubscriptionNodesLocked(sub.ID, list)
	s.save()
	s.mu.Unlock()
	s.applyLive()
	return nil
}

// UpdateSub re-fetches a subscription and replaces its nodes.
func (s *Service) UpdateSub(id string) error {
	// Copy the primitive fields out under the lock; do NOT retain a pointer into
	// the Subs slice, which AddSub/RemoveSub may reallocate or compact in place.
	s.mu.Lock()
	url, found := "", false
	for i := range s.cfg.Subs {
		if s.cfg.Subs[i].ID == id {
			url = s.cfg.Subs[i].URL
			found = true
		}
	}
	s.mu.Unlock()
	if !found {
		return fmt.Errorf("订阅不存在")
	}

	list, err := s.fetchSubscription(url)
	if err != nil {
		return err
	}
	s.mu.Lock()
	if !s.subscriptionExistsLocked(id) {
		s.mu.Unlock()
		return fmt.Errorf("订阅不存在")
	}
	s.replaceSubscriptionNodesLocked(id, list)
	s.save()
	s.mu.Unlock()
	s.applyLive()
	return nil
}

// EditSub changes a subscription's display name/address and validates the new
// address before mutating any saved state. A failed fetch therefore leaves the
// old subscription and all of its nodes intact.
func (s *Service) EditSub(id, name, url string) error {
	name, url = strings.TrimSpace(name), strings.TrimSpace(url)
	if name == "" || url == "" {
		return fmt.Errorf("订阅名称和地址不能为空")
	}
	s.mu.Lock()
	found := false
	for _, sub := range s.cfg.Subs {
		if sub.ID == id {
			found = true
		} else if strings.EqualFold(strings.TrimSpace(sub.URL), url) {
			s.mu.Unlock()
			return fmt.Errorf("订阅地址已存在")
		}
	}
	s.mu.Unlock()
	if !found {
		return fmt.Errorf("订阅不存在")
	}

	list, err := s.fetchSubscription(url)
	if err != nil {
		return err
	}
	s.mu.Lock()
	index := -1
	for i := range s.cfg.Subs {
		if s.cfg.Subs[i].ID == id {
			index = i
		} else if strings.EqualFold(strings.TrimSpace(s.cfg.Subs[i].URL), url) {
			s.mu.Unlock()
			return fmt.Errorf("订阅地址已存在")
		}
	}
	if index < 0 {
		s.mu.Unlock()
		return fmt.Errorf("订阅不存在")
	}
	s.cfg.Subs[index].Name = name
	s.cfg.Subs[index].URL = url
	s.replaceSubscriptionNodesLocked(id, list)
	s.save()
	s.mu.Unlock()
	s.applyLive()
	return nil
}

func (s *Service) subscriptionExistsLocked(id string) bool {
	for i := range s.cfg.Subs {
		if s.cfg.Subs[i].ID == id {
			return true
		}
	}
	return false
}

// replaceSubscriptionNodesLocked atomically swaps a fetched subscription while
// preserving stable node identities and repairing every dependent selection.
// The caller must hold s.mu.
func (s *Service) replaceSubscriptionNodesLocked(id string, list []*nodes.Node) {
	var oldNodes []*nodes.Node
	for _, n := range s.cfg.Nodes {
		if n.SubID == id {
			oldNodes = append(oldNodes, n)
		}
	}
	reconcileSubscriptionNodes(oldNodes, list)
	kept := s.cfg.Nodes[:0]
	for _, n := range s.cfg.Nodes {
		if n.SubID != id {
			kept = append(kept, n)
		}
	}
	s.cfg.Nodes = kept
	added := s.mergeNodesLocked(list, id)
	for i := range s.cfg.Subs {
		if s.cfg.Subs[i].ID == id {
			s.cfg.Subs[i].NodeCount = added
			s.cfg.Subs[i].LastUpdate = time.Now().Format("2006-01-02 15:04")
			break
		}
	}
	s.healDanglingNodeRefsLocked()
}

// reconcileSubscriptionNodes preserves identity across provider format changes.
// Exact endpoint matches retain measurements. If the endpoint changed but the
// provider still exposes one uniquely named node of the same protocol, its ID
// is retained so per-app selections follow that logical node; measurements are
// intentionally reset because the actual endpoint changed.
//
// Official POWER云 nodes with a stable key (nodes.Node.OfficialKey) are matched
// by that key first: their tags carry the list position ("节点 2 · 台湾"), so
// endpoint / name matching would lose the node's identity whenever the panel
// reorders or adds nodes. Old nodes without a key (saved by an older build or
// from an older panel) are still matched by endpoint / name once, after which
// the key is saved along with the kept ID.
func reconcileSubscriptionNodes(oldNodes, freshNodes []*nodes.Node) {
	oldByEndpoint := make(map[string]*nodes.Node, len(oldNodes))
	oldByLogical := make(map[string]*nodes.Node, len(oldNodes))
	oldByKey := make(map[string]*nodes.Node, len(oldNodes))
	oldDuplicates := make(map[string]bool)
	freshCounts := make(map[string]int, len(freshNodes))
	for _, old := range oldNodes {
		if old.OfficialKey != "" {
			oldByKey[old.OfficialKey] = old
		}
	}
	// A keyed fresh node may only take over an old node with the same key, or
	// one without a key; never another node's.
	mayMatch := func(fresh, old *nodes.Node) bool {
		return old != nil && (old.OfficialKey == "" || old.OfficialKey == fresh.OfficialKey)
	}
	for _, old := range oldNodes {
		oldByEndpoint[nodeEndpointKey(old)] = old
		key := nodeLogicalKey(old)
		if _, exists := oldByLogical[key]; exists {
			oldDuplicates[key] = true
		} else {
			oldByLogical[key] = old
		}
	}
	for _, fresh := range freshNodes {
		freshCounts[nodeLogicalKey(fresh)]++
	}
	for _, fresh := range freshNodes {
		if fresh.OfficialKey != "" {
			if old := oldByKey[fresh.OfficialKey]; old != nil {
				fresh.ID = old.ID
				// Same node: measurements stay valid while it is the same server.
				if strings.EqualFold(old.Server, fresh.Server) && old.Port == fresh.Port && old.Type == fresh.Type {
					fresh.Latency, fresh.TCPLatency, fresh.Speed = old.Latency, old.TCPLatency, old.Speed
				}
				continue
			}
		}
		if old := oldByEndpoint[nodeEndpointKey(fresh)]; mayMatch(fresh, old) {
			fresh.ID = old.ID
			fresh.Latency = old.Latency
			fresh.TCPLatency = old.TCPLatency
			fresh.Speed = old.Speed
			continue
		}
		key := nodeLogicalKey(fresh)
		if !oldDuplicates[key] && freshCounts[key] == 1 {
			if old := oldByLogical[key]; mayMatch(fresh, old) {
				fresh.ID = old.ID
			}
		}
	}
}

func nodeLogicalKey(n *nodes.Node) string {
	if n == nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(n.Type)) + "\x00" +
		strings.ToLower(strings.TrimSpace(n.Name))
}

func nodeEndpointKey(n *nodes.Node) string {
	if n == nil {
		return ""
	}
	sni := n.SNI
	if strings.EqualFold(n.Security, "none") {
		sni = ""
	}
	return strings.Join([]string{
		strings.ToLower(n.Type), n.Name, strings.ToLower(n.Server),
		strconv.Itoa(n.Port), n.UUID, n.Password, n.Username, n.Method,
		strconv.Itoa(n.AlterID), n.Cipher, strings.ToLower(n.Security), sni,
		n.Flow, n.PublicKey, n.ShortID, strings.ToLower(n.Network), n.Path, n.Host,
		n.Plugin, n.PluginOpts, n.RawKey(),
	}, "\x00")
}

// RemoveSub deletes a subscription and its nodes.
func (s *Service) RemoveSub(id string) {
	s.mu.Lock()
	subsKept := s.cfg.Subs[:0]
	for _, e := range s.cfg.Subs {
		if e.ID != id {
			subsKept = append(subsKept, e)
		}
	}
	s.cfg.Subs = subsKept
	nodesKept := s.cfg.Nodes[:0]
	for _, n := range s.cfg.Nodes {
		if n.SubID != id {
			nodesKept = append(nodesKept, n)
		}
	}
	s.cfg.Nodes = nodesKept
	s.healDanglingNodeRefsLocked()
	s.save()
	s.mu.Unlock()
	s.applyLive()
}

// --- Routing (in-tunnel split) ---

// GetRouting returns the current routing config.
func (s *Service) GetRouting() Routing {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Routing{Enabled: s.cfg.Routing.Enabled, Mode: s.cfg.Routing.Mode, Rules: append([]core.RouteRule{}, s.cfg.Routing.Rules...)}
}

// SetRouting replaces the routing config. It takes effect on the next Start (a
// core config regeneration), so the caller should restart if running.
func (s *Service) SetRouting(r Routing) string {
	if r.Mode == "" {
		r.Mode = core.RouteGlobal
	}
	s.mu.Lock()
	s.cfg.Routing = r
	s.save()
	s.mu.Unlock()
	return restartMsg(s.applyLive()) // master 分流 switch takes effect live
}

// SetSubAutoUpdate toggles auto-update for a subscription.
func (s *Service) SetSubAutoUpdate(id string, on bool) {
	s.mu.Lock()
	for i := range s.cfg.Subs {
		if s.cfg.Subs[i].ID == id {
			s.cfg.Subs[i].AutoUpdate = on
		}
	}
	s.save()
	s.mu.Unlock()
}

// GetCoreVersion returns the bundled sing-box version.
func (s *Service) GetCoreVersion() string {
	if v := coreupdate.InstalledVersion(s.binDir); v != "" {
		return v
	}
	return s.core.Version()
}

// UpdateRuleSets refreshes the bundled geosite/geoip rule-sets, downloading
// through the running node when the core is up (raw.githubusercontent is blocked
// behind the GFW). Returns a status string for the UI.
func (s *Service) UpdateRuleSets() string {
	via := ""
	if s.core.Running() && s.core.Port() > 0 {
		via = fmt.Sprintf("127.0.0.1:%d", s.core.Port())
	}
	n, err := geoupdate.Update(s.binDir, via)
	if err != nil {
		s.log(fmt.Sprintf("[geo] update failed: %v", err))
		return err.Error()
	}
	s.log(fmt.Sprintf("[geo] updated %d rule-set(s); restart to apply", n))
	return ""
}

// --- Settings ---

func (s *Service) GetSettings() Settings {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cfg.Settings
}

func (s *Service) SetSettings(st Settings) string {
	s.mu.Lock()
	old := s.cfg.Settings
	s.cfg.Settings = st
	s.save()
	s.mu.Unlock()
	// Switching capture mode (TUN <-> app-split), QUIC policy, LAN sharing or
	// remote DNS changes the core filter/config, so restart if running.
	if s.core.Running() && (old.TunMode != st.TunMode || old.BlockQUIC != st.BlockQUIC ||
		old.LanShare != st.LanShare || old.RemoteDNS != st.RemoteDNS ||
		old.LanPort != st.LanPort || old.LanType != st.LanType || old.LanUser != st.LanUser || old.LanPass != st.LanPass ||
		old.PrivateDirect != st.PrivateDirect || old.ExcludeSelf != st.ExcludeSelf ||
		old.ClaudeAccelOff != st.ClaudeAccelOff) {
		if err := s.restart(); err != nil {
			s.log("[service] restart after settings change failed: " + err.Error())
			return restartMsg(err)
		}
	}
	return ""
}

// GetLogLevel / SetLogLevel control the core's log verbosity. Changing it takes
// effect on the next core start (a config regeneration), so restart if running.
func (s *Service) GetLogLevel() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cfg.LogLevel == "" {
		return "info"
	}
	return s.cfg.LogLevel
}

func (s *Service) SetLogLevel(level string) string {
	switch level {
	case "trace", "debug", "info", "warn", "error":
	default:
		level = "info"
	}
	s.mu.Lock()
	s.cfg.LogLevel = level
	s.save()
	s.mu.Unlock()
	if err := s.restart(); err != nil {
		s.log("[service] restart after log-level change failed: " + err.Error())
		return restartMsg(err)
	}
	return ""
}

// --- Lifecycle ---

// Start resolves the config into per-line inbounds, launches the core, then the
// redirect engine with one upstream dialer per line.
func (s *Service) Start() error {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	return s.startLocked()
}

// startLocked starts the core; caller holds lifecycleMu.
func (s *Service) startLocked() error {
	s.mu.Lock()
	guard := s.startGuard
	s.mu.Unlock()
	if guard != nil {
		if err := guard(); err != nil {
			return fmt.Errorf("授权校验失败：%w", err)
		}
	}
	s.mu.Lock()
	node := s.selectedNode()
	level := s.cfg.LogLevel
	mode := s.cfg.RuleMode
	set := s.cfg.Settings
	custom := append([]core.RouteRule(nil), s.cfg.CustomRules...)
	ruleSets := core.RuleSetOptions{
		GeoSiteCN: s.cfg.RuleSets["geosite-cn.srs"],
		GeoIPCN:   s.cfg.RuleSets["geoip-cn.srs"],
		Ads:       s.cfg.RuleSets["geosite-category-ads-all.srs"],
	}
	// 整机全局 base = 全局规则 (bypass China: 大陆直连、境外走节点) — the DEFAULT.
	// The clash mode picks the flavor at run time: 规则=全局规则(智能), 全局=全局
	// 代理(含大陆全走节点), 直连=暂停. So 整机全局 has two sub-modes, default 全局规则.
	tunRoute := core.RouteBypassCN
	s.mu.Unlock()

	// clash_api controller for live mode switching (全局/直连/规则) + a fresh random
	// secret each run. The selected mode is baked into the config (default_mode) so
	// the core boots in it — no post-start apply window.
	clashSecret := genSecret()
	s.mu.Lock()
	s.clashSecret = clashSecret
	if s.clashMode == "" {
		s.clashMode = "rule"
	}
	wantMode := s.clashMode
	accelPort := 0
	if !set.ClaudeAccelOff {
		accelPort = s.accelPortLocked()
	}
	s.mu.Unlock()
	// Bundled core with relayops patch 0005: POWER云 Reality outbounds keep the
	// X25519MLKEM768 key share. Cached per core file; stock cores never get it.
	realityHybrid := coreupdate.HasTag(s.binDir, coreupdate.RealityHybridTag)
	clashOptsFor := func(port int) core.Options {
		ctl := ""
		if port > 0 {
			ctl = fmt.Sprintf("127.0.0.1:%d", port)
		}
		return core.Options{RemoteDNS: set.RemoteDNS, GeoDir: s.binDir, ClashController: ctl, ClashSecret: clashSecret, ClashMode: wantMode,
			LanShare: set.LanShare, LanPort: set.LanPort, LanType: set.LanType, LanUser: set.LanUser, LanPass: set.LanPass,
			CustomRules: custom, RuleSets: &ruleSets, DirectDomains: s.directDomains(),
			ProxyPrivate: !set.PrivateDirect, BlockQUIC: set.BlockQUIC, SelfProcess: selfProcess(set.ExcludeSelf),
			AccelPort: accelPort, RealityHybrid: realityHybrid}
	}

	// System-wide mode: sing-box TUN routes the whole machine.
	if set.TunMode {
		if node == nil {
			return fmt.Errorf("no node selected")
		}
		// TUN has no mixed inbound, so the clash port can't collide with one.
		clashPort, _ := core.FreePort()
		s.mu.Lock()
		s.clashPort = clashPort
		s.trafficStats = Stats{}
		s.mu.Unlock()
		tunOpts := clashOptsFor(clashPort)
		tunOpts.AccelOutbound = "proxy" // 整机全局：Claude Code 也走主节点
		if err := s.core.StartTUN(node, level, tunRoute, nil, tunOpts); err != nil {
			return fmt.Errorf("core(TUN): %w", err)
		}
		s.mu.Lock()
		s.accelOut = tunOpts.AccelOutbound
		s.mu.Unlock()
		s.mu.Lock()
		s.startedAt = time.Now()
		s.activeFP = nil
		s.run = nil
		s.mu.Unlock()
		s.applySystemProxyOnStart()
		s.log(fmt.Sprintf("[service] started — 全局 TUN 模式 (%s), 节点 %s", tunRoute, node.Name))
		return nil
	}

	// App-split mode: sing-box TUN + per-app routing. The per-app lists live in
	// rule-set files, so later app add/remove can apply without a restart.
	if node == nil {
		return fmt.Errorf("no node selected")
	}
	clashPort, _ := core.FreePort()
	base := clashOptsFor(clashPort)
	base.Split = true
	base.SplitWhitelist = mode != "blacklist"
	s.mu.Lock()
	s.clashPort = clashPort
	s.trafficStats = Stats{}
	opts := base
	sum := s.splitOptionsLocked(&opts, node)
	s.mu.Unlock()
	if err := s.core.StartTUN(node, level, tunRoute, nil, opts); err != nil {
		return fmt.Errorf("core(应用分流 TUN): %w", err)
	}

	s.mu.Lock()
	s.startedAt = time.Now()
	s.activeFP = nil
	s.run = &runState{node: node, level: level, route: tunRoute, base: base, targets: sum.targets}
	s.accelOut = opts.AccelOutbound
	s.mu.Unlock()

	s.applySystemProxyOnStart()
	s.log(fmt.Sprintf("[service] started — 应用分流 (TUN+进程名), 代理 %d / 直连 %d / 拦截 %d 个程序, 额外节点 %d, 主节点 %s",
		sum.proxied, sum.direct, sum.blocked, len(opts.ExtraNodes), node.Name))
	return nil
}

// runState is what the running app-split core was started with, so an app-rule
// change can rebuild the identical config and hot-swap only the app lists.
type runState struct {
	node    *nodes.Node
	level   string
	route   string
	base    core.Options      // everything except the per-app fields
	targets map[string]string // app name (lower) -> where it is routed
}

type splitSummary struct {
	proxied, direct, blocked int
	targets                  map[string]string
}

// splitOptionsLocked fills the per-app fields of opts (groups, direct/block
// lists, scoped rules, extra nodes) from the enabled app rules. The built-in
// 规则/全局 groups on the active node always exist — even empty — so adding or
// removing apps on them never changes the config structure. Caller holds s.mu.
func (s *Service) splitOptionsLocked(opts *core.Options, node *nodes.Node) splitSummary {
	activeID := node.ID
	nodeByID := map[string]*nodes.Node{}
	for _, n := range s.cfg.Nodes {
		nodeByID[n.ID] = n
	}
	allLines := s.allLinesLocked()
	type gkey struct{ line, tag, mode string }
	type groupValue struct {
		names []string
		rules []core.RouteRule
	}
	groups := map[gkey]groupValue{
		{LineRule, "proxy", core.RouteBypassCN}: {},
		{LineGlobal, "proxy", core.RouteGlobal}: {},
	}
	extraByTag := map[string]*nodes.Node{}
	sum := splitSummary{targets: map[string]string{}}
	target := func(name, where string) {
		k := strings.ToLower(name)
		if old := sum.targets[k]; old != "" {
			where = old + ";" + where
		}
		sum.targets[k] = where
	}
	var directApps, blockApps []string
	var scopedRules []core.ScopedRule
	for _, r := range s.cfg.Rules {
		if !r.Enabled {
			continue
		}
		name := filepath.Base(r.Match)
		if name == "" || name == "." {
			name = filepath.Base(r.Path)
		}
		if name == "" || name == "." {
			continue
		}
		lineID := r.Line
		if lineID == "" {
			lineID = LineRule
		}
		line := lineByID(allLines, lineID)
		if line == nil {
			line = lineByID(allLines, LineRule)
		}
		// Target-scoped rule (process + domain/IP/port): emit as a ScopedRule that
		// only catches the app's matching traffic; the rest follows the default.
		if r.Scoped() {
			var outbound string
			switch line.ID {
			case LineDirect:
				outbound = "direct"
			case LineBlock:
				outbound = "reject"
			default:
				nodeID := r.Node
				if !line.Builtin {
					nodeID = line.Node
				}
				outbound = lineOutbound(nodeID, activeID, nodeByID, extraByTag)
			}
			sc := core.ScopedRule{Name: name, Domains: r.Domains, IPs: r.IPs, Ports: r.Ports, Outbound: outbound}
			scopedRules = append(scopedRules, sc)
			target(name, fmt.Sprintf("scoped:%v", sc))
			continue
		}
		switch line.ID {
		case LineDirect:
			directApps = append(directApps, name)
			target(name, "direct")
			continue
		case LineBlock:
			blockApps = append(blockApps, name)
			target(name, "block")
			continue
		}
		mode := line.Routing.Mode
		if mode == "" {
			mode = core.RouteGlobal
		}
		// Built-in global/rule lines allow an app-level node override. A custom
		// line owns its node, mode and rules as one reusable policy.
		nodeID := r.Node
		if !line.Builtin {
			nodeID = line.Node
		}
		tag := lineOutbound(nodeID, activeID, nodeByID, extraByTag)
		k := gkey{line: line.ID, tag: tag, mode: mode}
		value := groups[k]
		value.names = append(value.names, name)
		value.rules = append([]core.RouteRule{}, line.Routing.Rules...)
		groups[k] = value
		target(name, k.line+"|"+k.tag+"|"+k.mode)
	}

	keys := make([]gkey, 0, len(groups))
	for k := range groups {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].line != keys[j].line {
			return keys[i].line < keys[j].line
		}
		if keys[i].tag != keys[j].tag {
			return keys[i].tag < keys[j].tag
		}
		return keys[i].mode < keys[j].mode
	})
	opts.SplitGroups = nil
	for _, k := range keys {
		value := groups[k]
		sort.Strings(value.names)
		opts.SplitGroups = append(opts.SplitGroups, core.SplitGroup{
			Key: k.line + "|" + k.tag + "|" + k.mode, Names: value.names, Mode: k.mode, NodeTag: k.tag, Rules: value.rules,
		})
		sum.proxied += len(value.names)
	}
	opts.SplitDefault = nil
	if !opts.SplitWhitelist {
		// 默认全走代理: the line for unlisted apps. 规则 on the active node is
		// the built-in behaviour; 拦截 is refused by SetDefaultLine.
		if line := lineByID(allLines, s.cfg.DefaultLine); line != nil && line.ID != LineRule && line.ID != LineBlock {
			d := core.SplitGroup{Mode: line.Routing.Mode, NodeTag: "direct"}
			if line.ID != LineDirect {
				nodeID := ""
				if !line.Builtin {
					nodeID = line.Node
				}
				d.NodeTag = lineOutbound(nodeID, activeID, nodeByID, extraByTag)
				d.Rules = append([]core.RouteRule{}, line.Routing.Rules...)
			}
			if d.Mode == "" {
				d.Mode = core.RouteGlobal
			}
			opts.SplitDefault = &d
		}
	}
	extraTags := make([]string, 0, len(extraByTag))
	for tag := range extraByTag {
		extraTags = append(extraTags, tag)
	}
	sort.Strings(extraTags)
	opts.ExtraNodes = nil
	for _, tag := range extraTags {
		opts.ExtraNodes = append(opts.ExtraNodes, core.ExtraNode{Tag: tag, Node: extraByTag[tag]})
	}
	sort.Strings(directApps)
	sort.Strings(blockApps)
	opts.SplitDirect, opts.SplitBlock = directApps, blockApps
	opts.SplitScoped = scopedRules
	sum.direct, sum.blocked = len(directApps), len(blockApps)
	opts.AccelOutbound = claudeOutbound(opts)
	return sum
}

// Stop stops the engine and the core.
func (s *Service) Stop() {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	s.stopLocked()
}

// stopLocked stops the core; caller holds lifecycleMu.
func (s *Service) stopLocked() {
	s.mu.Lock()
	s.startedAt = time.Time{}
	s.activeFP = nil
	s.run = nil
	s.trafficStats = Stats{}
	clearSysProxy := s.sysProxyOn
	s.mu.Unlock()
	s.core.Stop()
	// Never leave the OS pointing at a now-dead proxy (would black-hole all HTTP).
	// Done synchronously here (the async onCoreExit is a crash-only safety net).
	if clearSysProxy {
		if err := s.clearOSProxy(); err != nil {
			s.log(fmt.Sprintf("[sysproxy] clear on stop failed: %v", err))
		} else {
			s.log("[sysproxy] cleared on stop")
		}
	}
	s.log("[service] stopped")
}

// Status returns a UI snapshot.
func (s *Service) Status() Status {
	s.mu.Lock()
	node := s.selectedNode()
	sel := s.cfg.SelectedID
	mode := s.cfg.RuleMode
	started := s.startedAt
	clashPort := s.clashPort
	clashSecret := s.clashSecret
	stats := s.trafficStats
	s.mu.Unlock()

	running := s.core.Running()
	st := Status{
		CoreRunning:   running,
		CorePort:      s.core.Port(),
		SelectedID:    sel,
		RuleMode:      mode,
		EngineRunning: running,
	}
	if running {
		if fresh, err := clashTraffic(clashPort, clashSecret); err == nil {
			stats = fresh
			s.mu.Lock()
			s.trafficStats = fresh
			s.mu.Unlock()
		} else {
			// A core can be alive for a fraction of a second before its Clash
			// controller is ready. Keep the status responsive and retry on the
			// next one-second UI poll.
			stats.Running = true
		}
		st.Stats = stats
	}
	if node != nil {
		st.NodeName = node.Name
	}
	if !started.IsZero() {
		st.UptimeSec = int64(time.Since(started).Seconds())
	}
	return st
}

func subID(url string) string {
	sum := 0
	for _, c := range url {
		sum = sum*31 + int(c)
	}
	return fmt.Sprintf("sub%08x", uint32(sum))
}
