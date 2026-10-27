package service

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"proxysplit/internal/icon"
	"proxysplit/internal/nodes"
	"proxysplit/internal/proc"
)

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
	set := s.cfg.Settings
	s.mu.Unlock()
	if run.procPorts != nil {
		if err := s.prepareProcessCapture(set, &opts, run.procPorts); err != nil {
			s.lifecycleMu.Unlock()
			return s.applyLive()
		}
	}
	ok, err := s.core.ApplySplitLists(run.node, run.level, run.route, nil, opts)
	if err != nil || !ok {
		s.lifecycleMu.Unlock()
		if err != nil {
			s.log("[service] 实时更新应用规则失败,改为重启内核: " + err.Error())
		}
		return s.applyLive()
	}
	s.updateCaptureRoutes(opts)
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
