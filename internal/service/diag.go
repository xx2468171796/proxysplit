package service

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"

	"proxysplit/internal/core"
)

// Self-diagnostics for AI / remote troubleshooting (exposed through the local
// control API and MCP): a redacted state snapshot, a buffer of recent log lines,
// and real route tests (routetest.go).

const logRingSize = 4000

// logRing keeps the most recent log lines with a running sequence number, so a
// test can read exactly the lines produced while it ran.
type logRing struct {
	mu    sync.Mutex
	lines []string
	next  uint64 // sequence number of the next line
}

func (r *logRing) add(line string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.lines) >= logRingSize {
		copy(r.lines, r.lines[len(r.lines)-logRingSize/2:])
		r.lines = r.lines[:logRingSize/2]
	}
	r.lines = append(r.lines, line)
	r.next++
}

// mark returns the sequence number of the next line to be added.
func (r *logRing) mark() uint64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.next
}

// since returns the lines added at or after seq (those still buffered).
func (r *logRing) since(seq uint64) []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	first := r.next - uint64(len(r.lines))
	if seq < first {
		seq = first
	}
	return append([]string(nil), r.lines[seq-first:]...)
}

var ansiRe = regexp.MustCompile(`\x1b\[[0-9;]*m`)

// RecentLogs returns up to n recent log lines (ANSI colours stripped), newest
// last, keeping only lines containing filter (case-insensitive) when set.
func (s *Service) RecentLogs(n int, filter string) []string {
	if n <= 0 || n > logRingSize {
		n = 300
	}
	filter = strings.ToLower(strings.TrimSpace(filter))
	all := s.logs.since(0)
	out := make([]string, 0, n)
	for i := len(all) - 1; i >= 0 && len(out) < n; i-- {
		l := ansiRe.ReplaceAllString(all[i], "")
		if filter == "" || strings.Contains(strings.ToLower(l), filter) {
			out = append(out, l)
		}
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}

// DiagNode is a node without credentials.
type DiagNode struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	Server   string `json:"server"`
	Port     int    `json:"port"`
	Official bool   `json:"official,omitempty"` // POWER云 node
	Egress   string `json:"egress,omitempty"`   // POWER云 access scope: ai_only / deny-list
	Selected bool   `json:"selected,omitempty"`
}

// DiagSnapshot is everything needed to understand how traffic is routed now.
type DiagSnapshot struct {
	Running     bool                `json:"running"`
	ClashMode   string              `json:"clashMode"` // 代理策略 rule|global|direct
	SplitMode   string              `json:"splitMode"` // whitelist=只代理列出的, blacklist=默认全走代理
	TunMode     bool                `json:"tunMode"`   // 整机全局 (app rules ignored)
	DefaultLine string              `json:"defaultLine"`
	LogLevel    string              `json:"logLevel"`
	CoreVersion string              `json:"coreVersion"`
	Node        string              `json:"node"`
	Nodes       []DiagNode          `json:"nodes"`
	Apps        []AppRule           `json:"apps"`
	Lines       []Line              `json:"lines"`
	CustomRules []core.RouteRule    `json:"customRules"`
	RuleSets    []RuleSetInfo       `json:"ruleSets"`
	Settings    Settings            `json:"settings"`
	AppLists    map[string][]string `json:"appLists,omitempty"` // live per-app rule-set files
	CoreConfig  json.RawMessage     `json:"coreConfig,omitempty"`
	Security    []string            `json:"security,omitempty"` // running security products (火绒、360 …)
	Hints       []string            `json:"hints,omitempty"`
}

// Diagnose returns a credential-free snapshot of the routing state, including
// the generated core config with secrets redacted.
func (s *Service) Diagnose() DiagSnapshot {
	st := s.Status()
	s.mu.Lock()
	snap := DiagSnapshot{
		Running:     st.CoreRunning,
		ClashMode:   s.clashMode,
		SplitMode:   s.cfg.RuleMode,
		TunMode:     s.cfg.Settings.TunMode,
		DefaultLine: s.cfg.DefaultLine,
		LogLevel:    s.cfg.LogLevel,
		Node:        st.NodeName,
		Apps:        append([]AppRule{}, s.cfg.Rules...),
		Lines:       append([]Line{}, s.cfg.Lines...),
		CustomRules: append([]core.RouteRule{}, s.cfg.CustomRules...),
		Settings:    s.cfg.Settings,
	}
	for _, n := range s.cfg.Nodes {
		if n == nil {
			continue
		}
		d := DiagNode{ID: n.ID, Name: n.Name, Type: n.Type, Server: n.Server, Port: n.Port, Official: n.Official, Selected: n.ID == s.cfg.SelectedID}
		if n.Egress.Active() {
			d.Egress = "deny-list"
			if n.Egress.Restricted() {
				d.Egress = "ai_only"
			}
		}
		snap.Nodes = append(snap.Nodes, d)
	}
	s.mu.Unlock()
	if snap.ClashMode == "" {
		snap.ClashMode = "rule"
	}
	if snap.Settings.LanPass != "" {
		snap.Settings.LanPass = "***"
	}
	snap.CoreVersion = s.core.Version()
	snap.RuleSets = s.GetRuleSets()
	if b, err := os.ReadFile(filepath.Join(s.dataDir, "sing-box.json")); err == nil {
		snap.CoreConfig = redactCoreConfig(b)
	}
	snap.AppLists = readAppLists(filepath.Join(s.dataDir, "rules"))
	snap.Security = DetectSecuritySoftware()
	snap.Hints = diagHints(snap)
	if advice := s.securityAdvice(snap.Security); advice != "" {
		snap.Hints = append(snap.Hints, advice)
	}
	return snap
}

// readAppLists reads the per-app process rule-set files the core is using.
func readAppLists(dir string) map[string][]string {
	files, _ := filepath.Glob(filepath.Join(dir, "*.json"))
	if len(files) == 0 {
		return nil
	}
	out := map[string][]string{}
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		var set struct {
			Rules []struct {
				ProcessName []string `json:"process_name"`
			} `json:"rules"`
		}
		if json.Unmarshal(b, &set) != nil {
			continue
		}
		var names []string
		for _, r := range set.Rules {
			names = append(names, r.ProcessName...)
		}
		sort.Strings(names)
		out[strings.TrimSuffix(filepath.Base(f), ".json")] = names
	}
	return out
}

// secretKeys are core-config fields whose values never leave the machine.
var secretKeys = map[string]bool{
	"password": true, "uuid": true, "private_key": true, "secret": true, "short_id": true,
	"pre_shared_key": true, "auth": true, "auth_str": true, "token": true, "users": true,
	"obfs": true, "headers": true,
}

func redactCoreConfig(b []byte) json.RawMessage {
	var v any
	if json.Unmarshal(b, &v) != nil {
		return nil
	}
	out, _ := json.Marshal(redact(v))
	return out
}

func redact(v any) any {
	switch t := v.(type) {
	case map[string]any:
		for k, val := range t {
			if secretKeys[k] {
				t[k] = "***"
				continue
			}
			t[k] = redact(val)
		}
	case []any:
		for i := range t {
			t[i] = redact(t[i])
		}
	}
	return v
}

// diagHints flags configurations that commonly surprise users.
func diagHints(d DiagSnapshot) []string {
	var hints []string
	if !d.Running {
		hints = append(hints, "代理没有运行：所有流量都不经过 ProxySplit。")
	}
	if d.TunMode {
		hints = append(hints, "当前是「整机全局」：应用规则不生效，整台电脑按代理策略走。")
	}
	if d.ClashMode == "direct" {
		hints = append(hints, "代理策略是「直连」：除单独设为拦截的应用外全部直连，自定义规则不生效。")
	}
	if d.ClashMode == "global" {
		hints = append(hints, "代理策略是「全局」：自定义规则与国内外分流不生效，全部走节点。")
	}
	if !d.TunMode && d.SplitMode == "whitelist" {
		for _, r := range d.CustomRules {
			if r.Action == "proxy" || r.Action == "" {
				hints = append(hints, "「只代理列出的」模式下，「走代理」类自定义规则只对列出的应用生效，没列出的应用仍直连。")
				break
			}
		}
	}
	for _, rs := range d.RuleSets {
		if !rs.Present {
			hints = append(hints, "规则库缺失："+rs.Name)
		} else if !rs.Enabled && rs.Name != "geosite-category-ads-all.srs" {
			hints = append(hints, "规则库已关闭："+rs.Display+"，国内网站可能被送进节点。")
		}
	}
	for _, n := range d.Nodes {
		if n.Selected && n.Egress == "ai_only" {
			hints = append(hints, "当前节点是 POWER云「仅 AI」线路：名单外网站会自动直连，不走节点。")
		}
	}
	return hints
}
