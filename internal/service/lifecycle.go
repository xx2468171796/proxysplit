package service

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"proxysplit/internal/core"
	"proxysplit/internal/coreupdate"
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
	s.mu.Lock()
	guard := s.startGuard
	// Before the license check: with no node, every click used to call the
	// license server too and soon hit its rate limit.
	picked, auto := s.ensureSelectedLocked()
	s.mu.Unlock()
	if picked == nil {
		return errNoNode
	}
	if auto {
		s.log("[service] 还没选节点，已自动选中「" + picked.Name + "」")
	}
	if guard != nil {
		if err := guard(); err != nil {
			return fmt.Errorf("授权校验失败：%w", err)
		}
	}
	s.mu.Lock()
	node := s.chainLocked(s.selectedNode())
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
		return core.Options{RemoteDNS: set.RemoteDNS, DNS: set.Net.coreDNS(), TunMTU: set.Net.TunMTU, StrictRouteOff: set.Net.StrictRouteOff, GeoDir: s.binDir, ClashController: ctl, ClashSecret: clashSecret, ClashMode: wantMode,
			LanShare: set.LanShare, LanPort: set.LanPort, LanType: set.LanType, LanUser: set.LanUser, LanPass: set.LanPass,
			CustomRules: custom, RuleSets: &ruleSets, DirectDomains: s.directDomains(),
			ProxyPrivate: !set.PrivateDirect, BlockQUIC: set.BlockQUIC, SelfProcess: selfProcess(set.ExcludeSelf), PortProcessPath: s.portProcessPath(),
			AccelPort: accelPort, RealityHybrid: realityHybrid,
			// Off by itself while the AI guard is active (core/dnscache.go).
			DNSOptimistic: true, DNSCacheFile: filepath.Join(s.dataDir, dnsCacheFile)}
	}

	// System-wide mode: sing-box TUN routes the whole machine.
	if set.TunMode {
		if node == nil {
			return errNoNode
		}
		// TUN has no mixed inbound, so the clash port can't collide with one.
		clashPort, _ := core.FreePort()
		s.mu.Lock()
		s.clashPort = clashPort
		s.trafficStats = Stats{}
		s.mu.Unlock()
		tunOpts := clashOptsFor(clashPort)
		tunOpts.AccelOutbound = "proxy" // 整机全局：Claude Code 也走主节点
		s.mu.Lock()
		extra := map[string]*nodes.Node{}
		s.applyAIGuardLocked(&tunOpts, node.ID, extra)
		for tag, n := range extra {
			tunOpts.ExtraNodes = append(tunOpts.ExtraNodes, core.ExtraNode{Tag: tag, Node: s.chainLocked(n)})
		}
		s.mu.Unlock()
		tunOpts.ServerIPs = s.serverIPs(startNodes(node, &tunOpts))
		if err := s.core.StartTUN(node, level, tunRoute, nil, tunOpts); err != nil {
			return s.withSecurityHint(fmt.Errorf("core(TUN): %w", err))
		}
		s.mu.Lock()
		s.accelOut = tunOpts.AccelOutbound
		s.noteAIGuardStartedLocked(&tunOpts)
		s.mu.Unlock()
		s.mu.Lock()
		s.startedAt = time.Now()
		s.activeFP = nil
		s.run = nil
		s.mu.Unlock()
		s.applySystemProxyOnStart()
		s.startWarm(node, tunOpts, clashPort, clashSecret)
		s.log(fmt.Sprintf("[service] started — 全局 TUN 模式 (%s), 节点 %s", tunRoute, node.Name))
		return nil
	}

	// App-split mode: sing-box TUN + per-app routing. The per-app lists live in
	// rule-set files, so later app add/remove can apply without a restart.
	if node == nil {
		return errNoNode
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
	// Kept in base too, so hot app-list reloads rebuild the same outbounds.
	opts.ServerIPs = s.serverIPs(startNodes(node, &opts))
	base.ServerIPs = opts.ServerIPs
	if err := s.prepareProcessCapture(set, &opts, nil); err != nil {
		return err
	}
	if err := s.core.StartTUN(node, level, tunRoute, nil, opts); err != nil {
		return s.withSecurityHint(fmt.Errorf("core(应用分流 TUN): %w", err))
	}
	if err := s.startCapture(opts); err != nil {
		// The driver will not open (security software, a clashing WinDivert,
		// no kernel resources): never fail the start, run this one on the TUN.
		_ = s.core.Stop()
		s.wdBroken.Store(true)
		s.wdNote.Store(s.captureFallbackNote())
		s.log("[capture] " + err.Error() + "；本次改用整机虚拟网卡，重启软件后再试「仅接管选中程序」")
		s.log("[capture] 驱动诊断：" + s.captureDiag())
		opts.Process = nil
		if err := s.core.StartTUN(node, level, tunRoute, nil, opts); err != nil {
			return s.withSecurityHint(fmt.Errorf("core(应用分流 TUN): %w", err))
		}
	}

	s.mu.Lock()
	s.startedAt = time.Now()
	s.activeFP = nil
	s.run = &runState{node: node, level: level, route: tunRoute, base: base, targets: sum.targets, procPorts: processPorts(opts)}
	s.accelOut = opts.AccelOutbound
	s.noteAIGuardStartedLocked(&opts)
	s.mu.Unlock()

	s.applySystemProxyOnStart()
	s.startWarm(node, opts, clashPort, clashSecret)
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

// stopLocked stops the core; caller holds lifecycleMu.
func (s *Service) stopLocked() {
	s.mu.Lock()
	s.startedAt = time.Time{}
	s.activeFP = nil
	s.run = nil
	s.trafficStats = Stats{}
	clearSysProxy := s.sysProxyOn
	s.mu.Unlock()
	s.stopCapture() // before the core: captured apps must not hit dead inbounds
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
