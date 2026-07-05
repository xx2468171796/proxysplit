package service

import (
	"fmt"
	"sort"

	"proxysplit/internal/core"
	"proxysplit/internal/engine"
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
	Enabled bool   `json:"enabled"`

	// Legacy fields (migrated to Line on load).
	Action string `json:"action,omitempty"`
	Follow *bool  `json:"follow,omitempty"`
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

// routingPlan is the fully-resolved routing derived from the current config: the
// per-line core inbounds, the engine's upstream map + rules, and the default
// target for unlisted apps.
type routingPlan struct {
	coreLines     []core.LineConfig
	upstreams     map[string]string // engine key -> "127.0.0.1:port"
	engineRules   []engine.Rule
	defaultTarget string
	fingerprints  map[string]string // line id -> resolved-content fingerprint (change detection)
	clashPort     int               // clash_api controller port, allocated with the inbound ports
}

// buildRoutingPlan resolves the config into concrete lines/inbounds. Called with
// the lock held. selected is the active node. It allocates a distinct free port
// per node-line actually used, ordering the active-node line first (so
// core.Port() / DNS detour are deterministic and point at the active node).
func (s *Service) buildRoutingPlan(selected *nodes.Node) (*routingPlan, error) {
	all := s.allLinesLocked()
	// Per-app splitting is always built; the runtime master control is the clash
	// mode (规则/全局/直连), which overlays this at run time without a restart.
	masterSplit := true

	// effTarget maps a rule's line id to an engine target: TargetDirect,
	// TargetBlock, or a node-line id (the upstream key). When the master 分流
	// switch is off, every node-line collapses to LineGlobal (proxy-all).
	effTarget := func(lineID string) string {
		l := lineByID(all, lineID)
		if l == nil {
			l = lineByID(all, LineGlobal) // unknown line -> global
		}
		switch l.Node {
		case "direct":
			return engine.TargetDirect
		case "block":
			return engine.TargetBlock
		}
		if !masterSplit {
			return LineGlobal
		}
		return l.ID
	}

	// Collect the distinct node-line ids used by enabled rules + (whitelist) the
	// default line, so each gets exactly one inbound.
	used := map[string]bool{}
	markUsed := func(t string) {
		if t != engine.TargetDirect && t != engine.TargetBlock {
			used[t] = true
		}
	}
	for _, r := range s.cfg.Rules {
		if r.Enabled {
			markUsed(effTarget(r.Line))
		}
	}
	defaultTarget := engine.TargetDirect
	if s.cfg.RuleMode == engine.ModeWhitelist {
		defaultTarget = effTarget(s.cfg.DefaultLine)
		markUsed(defaultTarget)
	}
	if len(used) == 0 {
		used[LineGlobal] = true // always at least one inbound so the core boots
	}

	// Resolve each used line to (line, node), then order deterministically:
	// active-node lines first, then by id.
	type item struct {
		id   string
		line *Line
		node *nodes.Node
	}
	var items []item
	for id := range used {
		l := lineByID(all, id)
		if l == nil {
			continue
		}
		node, err := resolveLineNode(l, selected, s.cfg.Nodes)
		if err != nil {
			return nil, err
		}
		items = append(items, item{id: id, line: l, node: node})
	}
	sort.Slice(items, func(i, j int) bool {
		si := selected != nil && items[i].node.ID == selected.ID
		sj := selected != nil && items[j].node.ID == selected.ID
		if si != sj {
			return si // active-node lines first
		}
		return items[i].id < items[j].id
	})

	// One extra port for the clash_api controller, allocated in the same batch so
	// it is guaranteed distinct from every inbound port (FreePorts keeps all probe
	// listeners open until every port is chosen).
	ports, err := core.FreePorts(len(items) + 1)
	if err != nil {
		return nil, err
	}

	plan := &routingPlan{upstreams: map[string]string{}, fingerprints: map[string]string{}, clashPort: ports[len(items)]}
	for i, it := range items {
		port := ports[i]
		plan.coreLines = append(plan.coreLines, core.LineConfig{
			Key:         it.id,
			InboundPort: port,
			Node:        it.node,
			RouteMode:   it.line.Routing.Mode,
			RouteRules:  it.line.Routing.Rules,
		})
		plan.upstreams[it.id] = fmt.Sprintf("127.0.0.1:%d", port)
		plan.fingerprints[it.id] = fmt.Sprintf("%s|%s|%v", it.node.ID, it.line.Routing.Mode, it.line.Routing.Rules)
	}

	for _, r := range s.cfg.Rules {
		plan.engineRules = append(plan.engineRules, engine.Rule{
			Match: r.Match, Path: r.Path, Target: effTarget(r.Line), Enabled: r.Enabled,
		})
	}
	plan.defaultTarget = defaultTarget
	return plan, nil
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
