package service

import (
	"fmt"
	"strings"

	"proxysplit/internal/appid"
	"proxysplit/internal/core"
	"proxysplit/internal/nodes"
)

// Built-in line IDs.
const (
	LineDirect = "direct"
	LineBlock  = "block"
	LineGlobal = "global"
	LineRule   = "rule"
)

// Line is a named routing target: an exit node plus an in-line routing policy.
type Line struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	Node    string  `json:"node"`    // "active" | node id | "direct"
	Routing Routing `json:"routing"` // {mode, rules}; unused for direct/block builtins
	Builtin bool    `json:"builtin"`
}

// AppRule maps an application to a line.
type AppRule struct {
	Match   string `json:"match"`
	Path    string `json:"path"`
	Line    string `json:"line"`
	Node    string `json:"node,omitempty"` // node id for rule/global apps; "" = active/selected node
	Enabled bool   `json:"enabled"`

	// Optional target scoping (Proxifier-style per-rule destination match). When
	// any is non-empty the rule applies ONLY to this app's traffic to the given
	// targets; the app's other traffic follows the default. Empty = whole app.
	Domains []string `json:"domains,omitempty"` // domain suffix, e.g. "google.com" (matches *.google.com)
	IPs     []string `json:"ips,omitempty"`     // ip / CIDR, e.g. "1.1.1.1/32", "10.0.0.0/8"
	Ports   []string `json:"ports,omitempty"`   // port or range, e.g. "443", "8000-9000"

	// Legacy fields (migrated to Line on load).
	Action string `json:"action,omitempty"`
	Follow *bool  `json:"follow,omitempty"`
}

// Scoped reports whether this rule is narrowed to specific targets.
func (r AppRule) Scoped() bool {
	return len(r.Domains) > 0 || len(r.IPs) > 0 || len(r.Ports) > 0
}

// builtinLines are always present and cannot be edited/deleted.
func builtinLines() []Line {
	return []Line{
		{ID: LineDirect, Name: "直连", Node: "direct", Builtin: true},
		{ID: LineGlobal, Name: "全局", Node: "active", Routing: Routing{Mode: core.RouteGlobal}, Builtin: true},
		{ID: LineRule, Name: "规则", Node: "active", Routing: Routing{Mode: core.RouteBypassCN}, Builtin: true},
		{ID: LineBlock, Name: "拦截", Node: "block", Builtin: true},
	}
}

func lineByID(all []Line, id string) *Line {
	for i := range all {
		if all[i].ID == id {
			return &all[i]
		}
	}
	return nil
}

// allLinesLocked returns builtin + custom lines (caller holds the lock).
func (s *Service) allLinesLocked() []Line {
	return append(builtinLines(), s.cfg.Lines...)
}

func validCustomLineID(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	for _, ch := range id {
		if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
			(ch >= '0' && ch <= '9') || ch == '-' || ch == '_' || ch == '.') {
			return false
		}
	}
	return true
}

// normalizeCustomLinesLocked validates custom lines as one atomic update.
// Caller holds s.mu so node and line references cannot change mid-validation.
func (s *Service) normalizeCustomLinesLocked(lines []Line) ([]Line, error) {
	nodeIDs := map[string]bool{}
	for _, node := range s.cfg.Nodes {
		nodeIDs[node.ID] = true
	}
	reserved := map[string]bool{LineDirect: true, LineBlock: true, LineGlobal: true, LineRule: true}
	seenID, seenName := map[string]bool{}, map[string]bool{}
	out := make([]Line, 0, len(lines))
	for i, raw := range lines {
		if raw.Builtin {
			continue
		}
		line := raw
		line.ID = strings.TrimSpace(line.ID)
		line.Name = strings.TrimSpace(line.Name)
		line.Node = strings.TrimSpace(line.Node)
		line.Routing.Mode = strings.ToLower(strings.TrimSpace(line.Routing.Mode))
		if !validCustomLineID(line.ID) || reserved[strings.ToLower(line.ID)] {
			return nil, fmt.Errorf("第 %d 条线路 ID 无效或为系统保留值: %s", i+1, line.ID)
		}
		if line.Name == "" || len([]rune(line.Name)) > 40 {
			return nil, fmt.Errorf("第 %d 条线路名称不能为空且最多 40 个字符", i+1)
		}
		idKey, nameKey := strings.ToLower(line.ID), strings.ToLower(line.Name)
		if seenID[idKey] {
			return nil, fmt.Errorf("线路 ID 重复: %s", line.ID)
		}
		if seenName[nameKey] {
			return nil, fmt.Errorf("线路名称重复: %s", line.Name)
		}
		seenID[idKey], seenName[nameKey] = true, true
		if line.Node == "" {
			line.Node = "active"
		}
		if line.Node != "active" && line.Node != LineDirect && !nodeIDs[line.Node] {
			return nil, fmt.Errorf("线路“%s”引用了不存在的节点: %s", line.Name, line.Node)
		}
		switch line.Routing.Mode {
		case "":
			line.Routing.Mode = core.RouteGlobal
			line.Routing.Rules = nil
		case core.RouteGlobal, core.RouteBypassCN:
			line.Routing.Rules = nil
		case core.RouteCustom:
			rules, err := normalizeRouteRules(line.Routing.Rules)
			if err != nil {
				return nil, fmt.Errorf("线路“%s”: %w", line.Name, err)
			}
			line.Routing.Rules = rules
		default:
			return nil, fmt.Errorf("线路“%s”的分流模式无效: %s", line.Name, line.Routing.Mode)
		}
		line.Builtin = false
		out = append(out, line)
	}
	return out, nil
}

// normalizeAppRulesLocked validates application mappings against the current
// custom lines and nodes. Caller holds s.mu.
func (s *Service) normalizeAppRulesLocked(rules []AppRule) ([]AppRule, error) {
	allLines := s.allLinesLocked()
	lineMap := make(map[string]Line, len(allLines))
	for _, line := range allLines {
		lineMap[line.ID] = line
	}
	nodeIDs := map[string]bool{}
	for _, node := range s.cfg.Nodes {
		nodeIDs[node.ID] = true
	}
	seen := map[string]bool{}
	out := make([]AppRule, 0, len(rules))
	for i, raw := range rules {
		rule := raw
		rule.Match = strings.TrimSpace(rule.Match)
		rule.Path = strings.TrimSpace(rule.Path)
		rule.Line = strings.TrimSpace(rule.Line)
		rule.Node = strings.TrimSpace(rule.Node)
		if rule.Match == "" {
			return nil, fmt.Errorf("第 %d 条应用规则缺少程序名称", i+1)
		}
		if len([]rune(rule.Match)) > 260 {
			return nil, fmt.Errorf("第 %d 条应用规则名称过长", i+1)
		}
		key := strings.ToLower(rule.Match)
		if seen[key] {
			return nil, fmt.Errorf("应用规则重复: %s", rule.Match)
		}
		seen[key] = true
		if IsDirRule(rule.Match) { // whole folder: never the system, a shared root or ProxySplit itself
			dir, err := appid.CheckDir(rule.Match)
			if err != nil {
				return nil, err
			}
			rule.Match, rule.Path = dir, dir
		}
		if rule.Path == "" {
			rule.Path = rule.Match
		}
		if rule.Line == "" {
			rule.Line = LineRule
		}
		line, ok := lineMap[rule.Line]
		if !ok {
			return nil, fmt.Errorf("应用“%s”引用了不存在的线路: %s", rule.Match, rule.Line)
		}
		if line.ID == LineDirect || line.ID == LineBlock || !line.Builtin {
			// Direct/block do not use a node; custom lines own their node and must
			// not be silently overridden by an app-level stale selection.
			rule.Node = ""
		} else if rule.Node != "" && rule.Node != "active" && !nodeIDs[rule.Node] {
			// Subscription providers may remove or rename a node between
			// refreshes. A stale optional app override must not make every
			// subsequent rule edit fail; fall back to the active node.
			rule.Node = ""
		}
		rule.Action, rule.Follow = "", nil
		out = append(out, rule)
	}
	return out, nil
}

// healDanglingNodeRefsLocked repairs persisted references after a subscription
// refresh or an upgrade from a version that generated different node IDs.
// Caller holds s.mu (or calls it during single-threaded load).
func (s *Service) healDanglingNodeRefsLocked() bool {
	nodeIDs := make(map[string]bool, len(s.cfg.Nodes))
	for _, node := range s.cfg.Nodes {
		if node != nil {
			nodeIDs[node.ID] = true
		}
	}
	changed := false
	if s.cfg.SelectedID != "" && s.cfg.SelectedID != AutoNodeID && !nodeIDs[s.cfg.SelectedID] {
		s.cfg.SelectedID = ""
		if len(s.cfg.Nodes) > 0 && s.cfg.Nodes[0] != nil {
			s.cfg.SelectedID = s.cfg.Nodes[0].ID
		}
		changed = true
	}
	for _, node := range s.cfg.Nodes {
		if node != nil && node.Via != "" && !nodeIDs[node.Via] {
			node.Via = "" // front node deleted: dial directly again
			changed = true
		}
	}
	for i := range s.cfg.Rules {
		nodeID := s.cfg.Rules[i].Node
		if nodeID != "" && nodeID != "active" && !nodeIDs[nodeID] {
			s.cfg.Rules[i].Node = ""
			changed = true
		}
	}
	for i := range s.cfg.Lines {
		nodeID := s.cfg.Lines[i].Node
		if nodeID != "" && nodeID != "active" && nodeID != "direct" && !nodeIDs[nodeID] {
			s.cfg.Lines[i].Node = "active"
			changed = true
		}
	}
	return changed
}

// resolveLineNode resolves a node-line's Node field to a concrete node.
func resolveLineNode(l *Line, selected *nodes.Node, all []*nodes.Node) (*nodes.Node, error) {
	switch l.Node {
	case "active", "":
		if selected == nil {
			return nil, fmt.Errorf("线路 %q 需要一个活动节点，但未选择节点", l.Name)
		}
		return selected, nil
	default:
		for _, n := range all {
			if n.ID == l.Node {
				return n, nil
			}
		}
		// Node was deleted; fall back to the active node.
		if selected == nil {
			return nil, fmt.Errorf("线路 %q 的节点不存在且无活动节点", l.Name)
		}
		return selected, nil
	}
}

// migrateRuleLocked upgrades a legacy rule (action/follow) to a line. Returns
// true if it changed.
func migrateRuleLocked(r *AppRule, oldRouting Routing) bool {
	if r.Line != "" {
		return false
	}
	switch r.Action {
	case "direct":
		r.Line = LineDirect
	case "block":
		r.Line = LineBlock
	default: // proxy or empty
		if oldRouting.Enabled && oldRouting.Mode == core.RouteBypassCN {
			r.Line = LineRule
		} else {
			r.Line = LineGlobal
		}
	}
	r.Action, r.Follow = "", nil
	return true
}
