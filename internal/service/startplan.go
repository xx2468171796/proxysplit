package service

import (
	"fmt"
	"path/filepath"
	"time"

	"proxysplit/internal/core"
	"proxysplit/internal/coreupdate"
	"proxysplit/internal/nodes"
)

// startPlan is everything one core start needs, resolved from the saved config:
// the node, the core options and the per-run values (clash controller port and
// secret, process-capture ports). Building it has no effect on a running core,
// so a reload can compare and validate it before the old core is touched.
type startPlan struct {
	node        *nodes.Node
	level       string
	route       string
	split       bool         // 应用分流 (false = 整机全局)
	opts        core.Options // what the core is started with
	base        core.Options // split only: opts without the per-app fields
	sum         splitSummary
	clashPort   int
	clashSecret string
}

// planReuse carries a running core's per-run values into a new plan, so the
// plan builds the byte-identical config when nothing the user controls changed.
type planReuse struct {
	clashPort   int
	clashSecret string
	procPorts   map[string]int    // 仅接管选中程序 inbound tag -> port (nil = TUN)
	serverIPs   map[string]string // node domain -> the IP the running core dials
}

// planStart resolves the saved config into a start plan. reuse is nil for a
// fresh start (new controller port / secret / inbound ports).
func (s *Service) planStart(reuse *planReuse) (*startPlan, error) {
	if reuse == nil {
		reuse = &planReuse{}
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
	if s.clashMode == "" {
		s.clashMode = "rule"
	}
	wantMode := s.clashMode
	accelPort := 0
	if !set.ClaudeAccelOff {
		accelPort = s.accelPortLocked()
	}
	s.mu.Unlock()
	if node == nil {
		return nil, errNoNode
	}
	// 整机全局 base = 全局规则 (bypass China: 大陆直连、境外走节点) — the DEFAULT.
	// The clash mode picks the flavor at run time: 规则=全局规则(智能), 全局=全局
	// 代理(含大陆全走节点), 直连=暂停. So 整机全局 has two sub-modes, default 全局规则.
	p := &startPlan{node: node, level: level, route: core.RouteBypassCN, clashPort: reuse.clashPort, clashSecret: reuse.clashSecret}
	// clash_api controller for live mode switching (全局/直连/规则) + a fresh random
	// secret each run. The selected mode is baked into the config (default_mode) so
	// the core boots in it — no post-start apply window. TUN has no mixed inbound,
	// so the clash port can't collide with one.
	if p.clashSecret == "" {
		p.clashSecret = genSecret()
	}
	if p.clashPort == 0 {
		p.clashPort, _ = core.FreePort()
	}
	// Bundled core with relayops patch 0005: POWER云 Reality outbounds keep the
	// X25519MLKEM768 key share. Cached per core file; stock cores never get it.
	realityHybrid := coreupdate.HasTag(s.binDir, coreupdate.RealityHybridTag)
	ctl := ""
	if p.clashPort > 0 {
		ctl = fmt.Sprintf("127.0.0.1:%d", p.clashPort)
	}
	opts := core.Options{RemoteDNS: set.RemoteDNS, DNS: set.Net.coreDNS(), TunMTU: set.Net.TunMTU, StrictRouteOff: set.Net.StrictRouteOff, GeoDir: s.binDir,
		ClashController: ctl, ClashSecret: p.clashSecret, ClashMode: wantMode,
		LanShare: set.LanShare, LanPort: set.LanPort, LanType: set.LanType, LanUser: set.LanUser, LanPass: set.LanPass,
		CustomRules: custom, RuleSets: &ruleSets, DirectDomains: s.directDomains(),
		ProxyPrivate: !set.PrivateDirect, BlockQUIC: set.BlockQUIC, SelfProcess: selfProcess(set.ExcludeSelf), PortProcessPath: s.portProcessPath(),
		AccelPort: accelPort, RealityHybrid: realityHybrid,
		// Off by itself while the AI guard is active (core/dnscache.go).
		DNSOptimistic: true, DNSCacheFile: filepath.Join(s.dataDir, dnsCacheFile)}

	// System-wide mode: sing-box TUN routes the whole machine.
	if set.TunMode {
		opts.AccelOutbound = "proxy" // 整机全局：Claude Code 也走主节点
		s.mu.Lock()
		extra := map[string]*nodes.Node{}
		s.applyAIGuardLocked(&opts, node.ID, extra)
		for tag, n := range extra {
			opts.ExtraNodes = append(opts.ExtraNodes, core.ExtraNode{Tag: tag, Node: s.chainLocked(n)})
		}
		s.mu.Unlock()
		opts.ServerIPs = s.serverIPsKeeping(startNodes(node, &opts), reuse.serverIPs)
		p.opts = opts
		return p, nil
	}

	// App-split mode: sing-box TUN + per-app routing. The per-app lists live in
	// rule-set files, so later app add/remove can apply without a restart.
	base := opts
	base.Split = true
	base.SplitWhitelist = mode != "blacklist"
	opts = base
	s.mu.Lock()
	p.sum = s.splitOptionsLocked(&opts, node)
	s.mu.Unlock()
	// Kept in base too, so hot app-list reloads rebuild the same outbounds.
	opts.ServerIPs = s.serverIPsKeeping(startNodes(node, &opts), reuse.serverIPs)
	base.ServerIPs = opts.ServerIPs
	if err := s.prepareProcessCapture(set, &opts, reuse.procPorts); err != nil {
		return nil, err
	}
	p.split, p.opts, p.base = true, opts, base
	return p, nil
}

// launch starts the core (and the capture engine) for p and records the run.
// Caller holds lifecycleMu and has checked that the core is stopped. On error
// the core is stopped; a capture engine kept from before (held) is left to
// the caller, one opened here is closed.
func (s *Service) launch(p *startPlan) error {
	s.mu.Lock()
	s.clashSecret, s.clashPort = p.clashSecret, p.clashPort
	s.trafficStats = Stats{}
	kept := s.capEng != nil
	s.mu.Unlock()
	label := "core(TUN)"
	if p.split {
		label = "core(应用分流 TUN)"
	}
	if err := s.core.StartTUN(p.node, p.level, p.route, nil, p.opts); err != nil {
		return s.withSecurityHint(fmt.Errorf("%s: %w", label, err))
	}
	if err := s.attachCapture(p.opts); err != nil {
		// The driver will not open (security software, a clashing WinDivert,
		// no kernel resources): never fail the start, run this one on the TUN.
		_ = s.core.Stop()
		s.wdBroken.Store(true)
		s.wdNote.Store(s.captureFallbackNote())
		s.noteCaptureFailure(err)
		s.log("[capture] " + err.Error() + "；本次改用整机虚拟网卡，重启软件后再试「仅接管选中程序」")
		s.log("[capture] 驱动诊断：" + s.captureDiag())
		p.opts.Process = nil
		if err := s.core.StartTUN(p.node, p.level, p.route, nil, p.opts); err != nil {
			return s.withSecurityHint(fmt.Errorf("%s: %w", label, err))
		}
	}

	s.mu.Lock()
	if !s.core.Running() {
		// It died between coming up and being recorded: onCoreExit saw "not up
		// yet" and left it to us. (Checked under s.mu: an exit after this point
		// finds the phase below and is recovered.)
		s.mu.Unlock()
		s.stopCoreLocked()
		if !kept {
			s.stopCapture()
		}
		return fmt.Errorf("%s: 内核启动后立刻退出了，请查看日志", label)
	}
	s.startedAt = time.Now()
	s.activeFP = nil
	s.run = nil
	if p.split {
		s.run = &runState{node: p.node, level: p.level, route: p.route, base: p.base, targets: p.sum.targets, procPorts: processPorts(p.opts)}
	}
	s.accelOut = p.opts.AccelOutbound
	s.noteAIGuardStartedLocked(&p.opts)
	s.health.phase, s.health.stopReason = RunRunning, ""
	s.health.recoverCancel = nil // a recovery that was waiting sees the phase and ends
	s.mu.Unlock()

	s.applySystemProxyOnStart()
	s.startWarm(p.node, p.opts, p.clashPort, p.clashSecret)
	if p.split {
		s.log(fmt.Sprintf("[service] started — 应用分流 (TUN+进程名), 代理 %d / 直连 %d / 拦截 %d 个程序, 额外节点 %d, 主节点 %s",
			p.sum.proxied, p.sum.direct, p.sum.blocked, len(p.opts.ExtraNodes), p.node.Name))
	} else {
		s.log(fmt.Sprintf("[service] started — 全局 TUN 模式 (%s), 节点 %s", p.route, p.node.Name))
	}
	return nil
}
