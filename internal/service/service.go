// Package service orchestrates the node manager, the bundled sing-box core and
// the WinDivert redirect engine behind a small API the UI layer binds to.
package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
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
	"proxysplit/internal/proc"
	"proxysplit/internal/subs"
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
	TunMode         bool   `json:"tunMode"` // true = system-wide TUN (global); false = per-app WinDivert
	LanShare        bool   `json:"lanShare"`
	LanPort         int    `json:"lanPort"` // fixed port for the LAN proxy inbound (0 => 7890)
	LanType         string `json:"lanType"` // mixed | socks | http
	LanUser         string `json:"lanUser"` // LAN proxy auth username (empty = no auth)
	LanPass         string `json:"lanPass"` // LAN proxy auth password
	ExcludeSelf     bool   `json:"excludeSelf"`
	PrivateDirect   bool   `json:"privateDirect"`
	BlockQUIC       bool   `json:"blockQUIC"`
	RemoteDNS       bool   `json:"remoteDNS"`
	FakeIP          bool   `json:"fakeIP"`
	Autostart       bool   `json:"autostart"`
	TrayClose       bool   `json:"trayClose"`
	Theme           string `json:"theme"`
	AutoUpdateRules bool   `json:"autoUpdateRules"` // 添加节点后自动更新分流规则集(可选,默认关)
}

func defaultSettings() Settings {
	return Settings{ExcludeSelf: true, PrivateDirect: true, BlockQUIC: true, RemoteDNS: true, TrayClose: true, Theme: "light", LanPort: 7890, LanType: "mixed"}
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

	ClashMode    string           `json:"clashMode,omitempty"`    // rule|global|direct (persisted across restarts)
	SysProxyLast string           `json:"sysProxyLast,omitempty"` // exact host:port we last set as OS proxy (crash-recovery marker)
	APIToken     string           `json:"apiToken,omitempty"`     // stable token for the local AI-control HTTP API
	CustomRules  []core.RouteRule `json:"customRules,omitempty"`  // global user rules (域名/IP → 代理/直连/拦截), highest priority

	Apps []string `json:"apps,omitempty"` // legacy; migrated to Rules on load
}

// Status is a snapshot for the UI.
type Status struct {
	CoreRunning   bool         `json:"coreRunning"`
	EngineRunning bool         `json:"engineRunning"`
	CorePort      int          `json:"corePort"`
	NodeName      string       `json:"nodeName"`
	SelectedID    string       `json:"selectedId"`
	RuleMode      string       `json:"ruleMode"`
	UptimeSec     int64        `json:"uptimeSec"`
	Stats         engine.Stats `json:"stats"`
}

// Service ties the pieces together.
type Service struct {
	binDir  string
	dataDir string

	mu           sync.Mutex
	cfg          Config
	core         *core.Manager
	eng          *engine.Engine
	onLog        func(string)
	startedAt    time.Time
	activeFP     map[string]string // running line id -> content fingerprint (change detection)
	clashPort    int               // clash_api external controller port of the running core
	clashSecret  string            // clash_api bearer secret
	clashMode    string            // last-applied clash mode: rule|global|direct (default rule)
	sysProxyOn   bool              // the Windows system proxy is currently applied by us
	sysProxyWant bool              // user wants system proxy on — re-applied (new port) each Start
	healthCache  atomic.Value      // []LineHealth — refreshed by the background health loop
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
	s.healStaleSystemProxy()       // recover from a prior crash that left one dangling
	s.startScheduler()
	go s.healthLoop() // live line/node reachability for the status panel
	return s, nil
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

// isCoreConfig reports whether data is a sing-box config (which has outbounds /
// inbounds) rather than the app config — a guard against ever loading a file the
// core clobbered into place.
func isCoreConfig(data []byte) bool {
	return bytes.Contains(data, []byte(`"outbounds"`)) || bytes.Contains(data, []byte(`"inbounds"`))
}

func (s *Service) load() {
	// Read the main config; if it is missing, corrupt, or was clobbered by the
	// core's sing-box config (a past bug wrote it here), fall back to the last
	// known-good backup so the user's nodes/rules are never lost.
	data, err := os.ReadFile(s.configPath())
	bad := err != nil || !json.Valid(data) || isCoreConfig(data)
	if bad {
		if bak, berr := os.ReadFile(s.configPath() + ".bak"); berr == nil && json.Valid(bak) && !isCoreConfig(bak) {
			data = bak
			s.log("[store] 主配置异常,已从备份恢复节点/规则")
			_ = os.WriteFile(s.configPath(), bak, 0o600) // repair the main file
		} else {
			data = nil // nothing usable — start clean rather than importing junk
		}
	}
	if len(data) > 0 && json.Valid(data) && !isCoreConfig(data) {
		_ = json.Unmarshal(data, &s.cfg)
	}
	// Defaults / migration.
	if s.cfg.LogLevel == "" {
		s.cfg.LogLevel = "info"
	}
	if s.cfg.RuleMode == "" {
		s.cfg.RuleMode = engine.ModeBlacklist
	}
	if s.cfg.DefaultLine == "" {
		s.cfg.DefaultLine = LineRule
	}
	if s.cfg.Settings.Theme == "" {
		s.cfg.Settings = defaultSettings()
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
}

// --- Nodes ---

// AddNodes parses share links from text and appends new (non-duplicate) nodes.
func (s *Service) AddNodes(text string) (added, skipped int) {
	parsed, skip := nodes.ParseMany(text)
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
		if n.Latency == 0 {
			n.Latency = -1
		}
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
func (s *Service) RemoveNode(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	kept := s.cfg.Nodes[:0]
	for _, n := range s.cfg.Nodes {
		if n.ID != id {
			kept = append(kept, n)
		}
	}
	s.cfg.Nodes = kept
	if s.cfg.SelectedID == id {
		s.cfg.SelectedID = ""
		if len(s.cfg.Nodes) > 0 {
			s.cfg.SelectedID = s.cfg.Nodes[0].ID
		}
	}
	s.save()
}

// SelectNode sets the active node (and restarts if a running line follows it).
func (s *Service) SelectNode(id string) {
	s.mu.Lock()
	s.cfg.SelectedID = id
	s.save()
	s.mu.Unlock()
	s.applyLive()
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

// TestLatency measures one node and stores the result. The core's tunnel is
// pinned to the selected node, so end-to-end measurement through SOCKS is only
// meaningful for that node; other nodes fall back to a direct TCP probe to their
// edge (measuring a snapshot copy so no shared Node struct is read unlocked).
func (s *Service) TestLatency(id string) int {
	s.mu.Lock()
	n := s.nodeByID(id)
	socks := ""
	if s.core.Running() && s.core.Port() > 0 && id == s.cfg.SelectedID {
		socks = fmt.Sprintf("127.0.0.1:%d", s.core.Port())
	}
	var snap nodes.Node
	if n != nil {
		snap = *n
	}
	s.mu.Unlock()
	if n == nil {
		return -1
	}
	res := latency.Measure(&snap, socks, 5*time.Second)
	s.mu.Lock()
	n.Latency = res.Latency
	if res.Speed > 0 {
		n.Speed = res.Speed
	}
	s.save()
	s.mu.Unlock()
	return res.Latency
}

// TestAllLatency measures every node.
func (s *Service) TestAllLatency() {
	for _, n := range s.Nodes() {
		s.TestLatency(n.ID)
	}
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
// line is one of rule/global/direct/block; anything else defaults to rule.
// node is an optional node id ("" = active node).
func (s *Service) UpsertAppRule(match, path, line, node string, enabled bool) {
	match = strings.TrimSpace(match)
	if match == "" {
		return
	}
	switch line {
	case LineGlobal, LineDirect, LineBlock:
	default:
		line = LineRule
	}
	s.mu.Lock()
	found := false
	for i := range s.cfg.Rules {
		if strings.EqualFold(s.cfg.Rules[i].Match, match) {
			s.cfg.Rules[i].Line = line
			s.cfg.Rules[i].Node = node
			if path != "" {
				s.cfg.Rules[i].Path = path
			}
			s.cfg.Rules[i].Enabled = enabled
			found = true
			break
		}
	}
	if !found {
		p := path
		if p == "" {
			p = match
		}
		s.cfg.Rules = append(s.cfg.Rules, AppRule{Match: match, Path: p, Line: line, Node: node, Enabled: enabled})
	}
	s.save()
	s.mu.Unlock()
	s.applyLive()
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
	s.applyLive()
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
func (s *Service) SetAppRules(rules []AppRule) {
	for i := range rules {
		if rules[i].Line == "" {
			rules[i].Line = LineGlobal
		}
	}
	s.mu.Lock()
	s.cfg.Rules = rules
	s.save()
	s.mu.Unlock()
	s.applyLive()
}

// GetLines returns builtin + custom lines. GetLinesCustom returns just custom.
func (s *Service) GetLines() []Line {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.allLinesLocked()
}

// SetLines replaces the CUSTOM lines (builtins are ignored/kept).
func (s *Service) SetLines(lines []Line) {
	custom := make([]Line, 0, len(lines))
	for _, l := range lines {
		if l.Builtin || l.ID == "" {
			continue
		}
		custom = append(custom, l)
	}
	s.mu.Lock()
	s.cfg.Lines = custom
	s.save()
	s.mu.Unlock()
	s.applyLive()
}

// GetRuleMode / SetRuleMode manage blacklist vs whitelist.
func (s *Service) GetRuleMode() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cfg.RuleMode
}

func (s *Service) SetRuleMode(mode string) {
	s.mu.Lock()
	s.cfg.RuleMode = mode
	s.save()
	s.mu.Unlock()
	s.applyLive()
}

// GetDefaultLine / SetDefaultLine manage the line for unlisted apps (whitelist).
func (s *Service) GetDefaultLine() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cfg.DefaultLine
}

func (s *Service) SetDefaultLine(id string) {
	s.mu.Lock()
	if id == "" {
		id = LineRule
	}
	s.cfg.DefaultLine = id
	s.save()
	s.mu.Unlock()
	s.applyLive()
}

// applyLive re-applies rule changes to a running engine. If the set of active
// node-lines is unchanged, only the matcher is updated (no dropped connections);
// otherwise the core+engine are restarted to create the new inbounds.
func (s *Service) applyLive() {
	s.mu.Lock()
	eng := s.eng
	if eng == nil {
		// sing-box-native mode (TUN / 应用分流): the app rules live in the core
		// config, so a rule change is applied by regenerating + reloading it.
		running := s.core.Running()
		s.mu.Unlock()
		if running {
			s.Stop()
			if err := s.Start(); err != nil {
				s.log("[service] reload after rule change failed: " + err.Error())
			}
		}
		return
	}
	selected := s.selectedNode()
	plan, err := s.buildRoutingPlan(selected)
	if err != nil {
		s.mu.Unlock()
		return
	}
	// Restart when the active-line topology OR any active line's resolved content
	// (node / mode / rules) changed; otherwise just re-apply the matcher.
	changed := len(plan.fingerprints) != len(s.activeFP)
	for k, fp := range plan.fingerprints {
		if s.activeFP[k] != fp {
			changed = true
		}
	}
	mode := s.cfg.RuleMode
	s.mu.Unlock()

	if changed {
		// Line topology changed -> restart to (re)create inbounds.
		s.Stop()
		if err := s.Start(); err != nil {
			s.log("[service] restart after rule change failed: " + err.Error())
		}
		return
	}
	eng.Matcher().SetRules(plan.engineRules, mode, plan.defaultTarget)
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
	sub := Sub{ID: subID(url), Name: name, URL: url, AutoUpdate: autoUpdate}
	s.mu.Lock()
	for _, e := range s.cfg.Subs {
		if e.ID == sub.ID {
			s.mu.Unlock()
			return fmt.Errorf("subscription already exists")
		}
	}
	s.cfg.Subs = append(s.cfg.Subs, sub)
	s.mu.Unlock()
	return s.UpdateSub(sub.ID)
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
	via := ""
	if s.core.Running() && s.core.Port() > 0 {
		via = fmt.Sprintf("127.0.0.1:%d", s.core.Port())
	}
	s.mu.Unlock()
	if !found {
		return fmt.Errorf("subscription not found")
	}

	list, err := subs.Fetch(url, via)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// Drop old nodes from this sub, then merge fresh ones.
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
		}
	}
	s.save()
	return nil
}

// RemoveSub deletes a subscription and its nodes.
func (s *Service) RemoveSub(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
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
	s.save()
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
func (s *Service) SetRouting(r Routing) {
	if r.Mode == "" {
		r.Mode = core.RouteGlobal
	}
	s.mu.Lock()
	s.cfg.Routing = r
	s.save()
	s.mu.Unlock()
	s.applyLive() // master 分流 switch takes effect live
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
func (s *Service) GetCoreVersion() string { return s.core.Version() }

// UpdateCore downloads the latest sing-box from GitHub (through the running node)
// and replaces the bundled binary. Returns the new version, or "ERR:<msg>".
func (s *Service) UpdateCore() string {
	via := ""
	if s.core.Running() && s.core.Port() > 0 {
		via = fmt.Sprintf("127.0.0.1:%d", s.core.Port())
	}
	v, err := coreupdate.Update(s.binDir, via)
	if err != nil {
		s.log("[core] update failed: " + err.Error())
		return "ERR:" + err.Error()
	}
	s.log(fmt.Sprintf("[core] updated to sing-box %s; restart to apply", v))
	return v
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

func (s *Service) SetSettings(st Settings) {
	s.mu.Lock()
	old := s.cfg.Settings
	s.cfg.Settings = st
	s.save()
	eng := s.eng
	s.mu.Unlock()
	if eng != nil {
		eng.Matcher().SetPrivateDirect(st.PrivateDirect)
	}
	// Switching capture mode (TUN <-> app-split), QUIC policy, LAN sharing or
	// remote DNS changes the core filter/config, so restart if running.
	if s.core.Running() && (old.TunMode != st.TunMode || old.BlockQUIC != st.BlockQUIC ||
		old.LanShare != st.LanShare || old.RemoteDNS != st.RemoteDNS ||
		old.LanPort != st.LanPort || old.LanType != st.LanType || old.LanUser != st.LanUser || old.LanPass != st.LanPass) {
		s.Stop()
		if err := s.Start(); err != nil {
			s.log("[service] restart after settings change failed: " + err.Error())
		}
	}
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

func (s *Service) SetLogLevel(level string) {
	switch level {
	case "trace", "debug", "info", "warn", "error":
	default:
		level = "info"
	}
	s.mu.Lock()
	s.cfg.LogLevel = level
	s.save()
	running := s.core.Running()
	s.mu.Unlock()
	if running {
		s.Stop()
		if err := s.Start(); err != nil {
			s.log("[service] restart after log-level change failed: " + err.Error())
		}
	}
}

// --- Lifecycle ---

// Start resolves the config into per-line inbounds, launches the core, then the
// redirect engine with one upstream dialer per line.
func (s *Service) Start() error {
	s.mu.Lock()
	node := s.selectedNode()
	level := s.cfg.LogLevel
	mode := s.cfg.RuleMode
	set := s.cfg.Settings
	custom := append([]core.RouteRule(nil), s.cfg.CustomRules...)
	// TUN base routing is always rule-based (bypass China); the clash mode overlays
	// 全局/直连 at run time. So 规则 = 智能分流, 全局 = 全走代理, 直连 = 全直连.
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
	s.mu.Unlock()
	clashOptsFor := func(port int) core.Options {
		ctl := ""
		if port > 0 {
			ctl = fmt.Sprintf("127.0.0.1:%d", port)
		}
		return core.Options{RemoteDNS: set.RemoteDNS, GeoDir: s.binDir, ClashController: ctl, ClashSecret: clashSecret, ClashMode: wantMode,
			LanShare: set.LanShare, LanPort: set.LanPort, LanType: set.LanType, LanUser: set.LanUser, LanPass: set.LanPass,
			CustomRules: custom}
	}

	// TUN mode: system-wide via sing-box TUN; no per-app WinDivert engine.
	if set.TunMode {
		if node == nil {
			return fmt.Errorf("no node selected")
		}
		// TUN has no mixed inbound, so the clash port can't collide with one.
		clashPort, _ := core.FreePort()
		s.mu.Lock()
		s.clashPort = clashPort
		s.mu.Unlock()
		if err := s.core.StartTUN(node, level, tunRoute, nil, clashOptsFor(clashPort)); err != nil {
			return fmt.Errorf("core(TUN): %w", err)
		}
		s.mu.Lock()
		s.eng = nil
		s.startedAt = time.Now()
		s.activeFP = nil
		s.mu.Unlock()
		s.applySystemProxyOnStart()
		s.log(fmt.Sprintf("[service] started — 全局 TUN 模式 (%s), 节点 %s", tunRoute, node.Name))
		return nil
	}

	// App-split mode: sing-box TUN + per-app process_name routing (no WinDivert).
	// Only the listed programs use the node; every other program is direct.
	if node == nil {
		return fmt.Errorf("no node selected")
	}
	s.mu.Lock()
	activeID := node.ID
	nodeByID := map[string]*nodes.Node{}
	for _, n := range s.cfg.Nodes {
		nodeByID[n.ID] = n
	}
	type gkey struct{ tag, mode string }
	groups := map[gkey][]string{}
	extraByTag := map[string]*nodes.Node{}
	var directApps, blockApps []string
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
		switch r.Line {
		case LineDirect:
			directApps = append(directApps, name)
			continue
		case LineBlock:
			blockApps = append(blockApps, name)
			continue
		}
		mode := "rule"
		if r.Line == LineGlobal {
			mode = "global"
		}
		// Resolve which node this app uses. "" / "active" / the selected node
		// all map to the primary "proxy" outbound; any other existing node id
		// becomes a dedicated extra outbound → per-app 不同节点.
		tag := "proxy"
		if r.Node != "" && r.Node != "active" && r.Node != activeID {
			if n, ok := nodeByID[r.Node]; ok {
				tag = "node-" + r.Node
				extraByTag[tag] = n
			}
		}
		k := gkey{tag, mode}
		groups[k] = append(groups[k], name)
	}
	s.mu.Unlock()

	var splitGroups []core.SplitGroup
	total := 0
	for k, names := range groups {
		splitGroups = append(splitGroups, core.SplitGroup{Names: names, Mode: k.mode, NodeTag: k.tag})
		total += len(names)
	}
	var extraNodes []core.ExtraNode
	for tag, n := range extraByTag {
		extraNodes = append(extraNodes, core.ExtraNode{Tag: tag, Node: n})
	}

	clashPort, _ := core.FreePort()
	s.mu.Lock()
	s.clashPort = clashPort
	s.mu.Unlock()
	opts := clashOptsFor(clashPort)
	opts.Split = true
	opts.SplitWhitelist = mode != "blacklist"
	opts.SplitGroups = splitGroups
	opts.SplitDirect, opts.SplitBlock = directApps, blockApps
	opts.ExtraNodes = extraNodes
	if err := s.core.StartTUN(node, level, tunRoute, nil, opts); err != nil {
		return fmt.Errorf("core(应用分流 TUN): %w", err)
	}

	s.mu.Lock()
	s.eng = nil // no WinDivert engine in the sing-box-native split model
	s.startedAt = time.Now()
	s.activeFP = nil
	s.mu.Unlock()

	s.applySystemProxyOnStart()
	s.log(fmt.Sprintf("[service] started — 应用分流 (TUN+进程名), 代理 %d / 直连 %d / 拦截 %d 个程序, 额外节点 %d, 主节点 %s",
		total, len(directApps), len(blockApps), len(extraNodes), node.Name))
	return nil
}

// Stop stops the engine and the core.
func (s *Service) Stop() {
	s.mu.Lock()
	eng := s.eng
	s.eng = nil
	s.startedAt = time.Time{}
	s.activeFP = nil
	clearSysProxy := s.sysProxyOn
	s.mu.Unlock()
	if eng != nil {
		eng.Stop()
	}
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
	eng := s.eng
	sel := s.cfg.SelectedID
	mode := s.cfg.RuleMode
	started := s.startedAt
	s.mu.Unlock()

	st := Status{
		CoreRunning:   s.core.Running(),
		CorePort:      s.core.Port(),
		SelectedID:    sel,
		RuleMode:      mode,
		EngineRunning: eng != nil && eng.Running(),
	}
	if node != nil {
		st.NodeName = node.Name
	}
	if eng != nil {
		st.Stats = eng.Stats()
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
