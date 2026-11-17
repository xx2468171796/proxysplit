package service

import (
	"cmp"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"proxysplit/internal/core"
	"proxysplit/internal/nodes"
)

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
	// CaptureNote: 仅接管选中程序 could not load its driver, so the TUN is in use.
	CaptureNote string `json:"captureNote,omitempty"`
	// RunState is the service's own view (runhealth.go): stopped | running |
	// restarting (a changed config is being swapped in) | recovering (the core
	// died by itself and is being restarted).
	RunState string `json:"runState"`
	// StopReason: why the proxy stopped by itself (until the next start / stop).
	StopReason string `json:"stopReason,omitempty"`
	// CaptureState of 仅接管选中程序: ok | restarting ("" = TUN capture / stopped).
	CaptureState string `json:"captureState,omitempty"`
}

// applyLive makes a saved change (nodes, subscriptions, lines, rules) take
// effect on the running core. The new config is generated first: when it is
// byte-identical to the running one nothing is restarted (a scheduled
// subscription refresh that changed nothing used to reset every connection);
// otherwise it is validated and only then swapped in. No-op when stopped.
func (s *Service) applyLive() error {
	err := s.reload(false)
	if err != nil {
		s.log("[service] reload after rule change failed: " + err.Error())
	}
	return err
}

// restart always replaces a running core (changed binary, rule files, network
// reset), still validating the new config before the old core is stopped.
// No-op when stopped.
func (s *Service) restart() error { return s.reload(true) }

// reload runs under one lifecycle lock, so a Stop from the user cannot slip in
// between and be undone by the Start, and concurrent changes go one after the
// other.
func (s *Service) reload(force bool) error {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	if !s.core.Running() {
		return nil
	}
	if _, err := s.pickNode(); err != nil {
		s.stopLocked() // nothing left to run (the last node was deleted)
		return err
	}
	plan, err := s.planStart(s.liveReuse())
	if err != nil {
		s.stopLocked()
		return err
	}
	return reloadSteps(force, reloadOps{
		unchanged: func() bool { return s.applyUnchanged(plan) },
		check:     func() error { return s.core.CheckTUN(plan.node, plan.level, plan.route, plan.opts) },
		swap:      s.swapCoreLocked,
	})
}

// reloadOps are the three steps of a reload (tests fake them).
type reloadOps struct {
	unchanged func() bool  // the running core already runs the new config
	check     func() error // validate the new config; the old core keeps running
	swap      func() error // stop the old core, start the new one
}

// reloadSteps is the reload rule: never restart for an identical config, and
// never stop a working core for a config that does not validate.
func reloadSteps(force bool, ops reloadOps) error {
	if !force && ops.unchanged() {
		return nil
	}
	if err := ops.check(); err != nil {
		return fmt.Errorf("新配置没有通过内核校验，代理仍按原来的配置运行：%w", err)
	}
	return ops.swap()
}

// liveReuse returns the running core's per-run values for planStart.
func (s *Service) liveReuse() *planReuse {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := &planReuse{clashPort: s.clashPort, clashSecret: s.clashSecret, serverIPs: s.liveIPs}
	if s.run != nil {
		r.procPorts = s.run.procPorts
	}
	return r
}

// applyUnchanged reports whether the running core already runs p's config. In
// 应用分流 the app lists live outside the config: they are brought up to date
// here (rule-set files, capture routes), as a hot app-rule change does.
func (s *Service) applyUnchanged(p *startPlan) bool {
	if !p.split {
		same, err := s.core.RunningConfigIs(p.node, p.level, p.route, p.opts)
		return err == nil && same
	}
	same, err := s.core.ApplySplitLists(p.node, p.level, p.route, nil, p.opts)
	if err != nil || !same {
		return false
	}
	s.finishHotApply(p.opts, p.sum.targets)
	return true
}

// swapCoreLocked replaces the running core. The capture engine stays, holding
// the selected programs (refused, not direct) until the new core is up; if
// that fails the proxy ends stopped with the reason. Caller holds lifecycleMu.
func (s *Service) swapCoreLocked() error {
	s.mu.Lock()
	s.health.phase = RunRestarting // an exit while the new core starts is ours, not a crash
	eng := s.capEng
	s.mu.Unlock()
	if eng != nil {
		eng.SetHold(true)
	}
	s.stopCoreLocked()
	err := s.startLocked()
	if err != nil {
		s.failRun(EventCoreFailed, "重新加载配置后内核没有启动成功，代理已停止："+err.Error())
	}
	return err
}

// Start resolves the config into per-line inbounds, launches the core, then the
// redirect engine with one upstream dialer per line.
func (s *Service) Start() error {
	s.ensureWinDivertUnlocked() // may download: before lifecycleMu
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	return s.startLocked()
}

// startLocked starts the core; caller holds lifecycleMu.
func (s *Service) startLocked() error {
	if s.core.Running() {
		// A second start (auto-start racing 启动 / resume-after-update) must not
		// overwrite the running core's clash port, secret and stats.
		return nil
	}
	// Before the license check: with no node, every click used to call the
	// license server too and soon hit its rate limit.
	guard, err := s.pickNode()
	if err != nil {
		return err
	}
	if guard != nil {
		if err := guard(); err != nil {
			return fmt.Errorf("授权校验失败：%w", err)
		}
	}
	plan, err := s.planStart(nil)
	if err != nil {
		return err
	}
	return s.launch(plan)
}

// pickNode makes sure a node is selected (the first one when the selected node
// is gone) and returns the start guard.
func (s *Service) pickNode() (guard func() error, err error) {
	s.mu.Lock()
	guard = s.startGuard
	picked, auto := s.ensureSelectedLocked()
	s.mu.Unlock()
	if picked == nil {
		return nil, errNoNode
	}
	if auto {
		s.log("[service] 还没选节点，已自动选中「" + picked.Name + "」")
	}
	return guard, nil
}

// runState is what the running app-split core was started with, so an app-rule
// change can rebuild the identical config and hot-swap only the app lists.
type runState struct {
	node    *nodes.Node
	level   string
	route   string
	base    core.Options      // everything except the per-app fields
	targets map[string]string // app name (lower) -> where it is routed
	// procPorts: inbound tag -> port of 仅接管选中程序 (nil = TUN capture)
	procPorts map[string]int
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
		if IsDirRule(r.Match) { // whole install folder (appid): every program under it
			name = core.DirPrefix + r.Match
		}
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
	// 推流程序默认直连 only in 仅接管选中程序: in TUN it would silently move
	// existing users who stream abroad through the proxy (OBS → YouTube) to direct.
	if s.cfg.Settings.ProcessCapture() && !s.cfg.Settings.StreamDirectOff {
		directApps = append(directApps, streamPresetApps(sum.targets)...)
	}
	sort.Strings(directApps)
	sort.Strings(blockApps)
	opts.SplitDirect, opts.SplitBlock = directApps, blockApps
	opts.SplitScoped = scopedRules
	sum.direct, sum.blocked = len(directApps), len(blockApps)
	opts.AccelOutbound = claudeOutbound(opts)
	s.applyAIGuardLocked(opts, activeID, extraByTag) // may add the AI line as an extra node
	extraTags := make([]string, 0, len(extraByTag))
	for tag := range extraByTag {
		extraTags = append(extraTags, tag)
	}
	sort.Strings(extraTags)
	opts.ExtraNodes = nil
	for _, tag := range extraTags {
		opts.ExtraNodes = append(opts.ExtraNodes, core.ExtraNode{Tag: tag, Node: s.chainLocked(extraByTag[tag])})
	}
	return sum
}

// Stop stops the engine and the core.
func (s *Service) Stop() {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	s.lockAIBeforeStop()
	s.stopLocked()
}

// stopLocked stops the proxy for good (capture engine and core) and calls off
// any automatic recovery; caller holds lifecycleMu.
func (s *Service) stopLocked() {
	s.mu.Lock()
	s.health.phase, s.health.stopReason = RunStopped, ""
	s.health.endRecoveryLocked()
	s.mu.Unlock()
	s.stopCapture() // before the core: captured apps must not hit dead inbounds
	s.stopCoreLocked()
}

// stopCoreLocked stops the core and clears the run state but leaves the
// capture engine alone (a restart keeps it, holding the selected programs);
// caller holds lifecycleMu.
func (s *Service) stopCoreLocked() {
	s.mu.Lock()
	s.startedAt = time.Time{}
	s.activeFP = nil
	s.run = nil
	s.liveIPs = nil
	s.trafficStats = Stats{}
	clearSysProxy := s.sysProxyOn
	s.mu.Unlock()
	s.stopWarm()
	s.core.Stop()
	s.flushAIDNSOnStop()
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

// engineUp reports whether traffic is actually being taken: the core alone in
// TUN capture; in 仅接管选中程序 the capture engine must be alive as well (a
// core without it proxies nothing).
func engineUp(coreRunning, processCapture, engine bool) bool {
	return coreRunning && (!processCapture || engine)
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
	health := s.health
	processCapture, engine := s.run != nil && s.run.procPorts != nil, s.capEng != nil
	s.mu.Unlock()

	running := s.core.Running()
	st := Status{
		CoreRunning:   running,
		CorePort:      s.core.Port(),
		SelectedID:    sel,
		RuleMode:      mode,
		EngineRunning: engineUp(running, processCapture, engine),
		RunState:      cmp.Or(health.phase, RunStopped),
		StopReason:    health.stopReason,
		CaptureState:  health.capture,
	}
	if note, _ := s.wdNote.Load().(string); running && note != "" {
		st.CaptureNote = note
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
