package service

import (
	"cmp"

	"proxysplit/internal/aiguard"
	"proxysplit/internal/core"
	"proxysplit/internal/nodes"
)

// AI 强制走线路（AI 编程官网客户）：内核里 AI 服务的域名 / 地址排在所有应用名单和代理策略前面，
// 一律走我们自己的线路（POWER云 节点）；没有可用线路时直接拦掉，绝不用客户本机（国内）IP 出去。
// 开关由 App 决定（中转站渠道 + 已登录），系统 DNS 锁（aiguard NRPT）也由 App 装 / 撤。

// SetAIGuard turns the guard on / off; a running core restarts when it changes.
func (s *Service) SetAIGuard(on bool) error {
	s.mu.Lock()
	changed := s.aiGuard != on
	s.aiGuard = on
	s.mu.Unlock()
	if !changed {
		return nil
	}
	if on {
		s.log("[AI] 已开启：AI 服务一律走 POWER云 线路")
	} else {
		s.log("[AI] 已关闭 AI 强制走线路")
	}
	return s.applyLive()
}

// AIGuardOn reports whether the guard is wanted.
func (s *Service) AIGuardOn() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.aiGuard
}

// AIGuardLine describes the running core's AI route: running = the core is up
// with the guard in its config; node = the line's name ("" = no line of ours,
// AI is blocked).
func (s *Service) AIGuardLine() (running bool, node string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.aiGuardOut == "" || !s.core.Running() {
		return false, ""
	}
	if s.aiGuardOut == "reject" {
		return true, ""
	}
	if n := s.aiNodeLocked(""); n != nil {
		return true, n.Name
	}
	if n := s.activeNodeLocked(""); n != nil {
		return true, n.Name
	}
	return true, ""
}

// AIGuardOfficial: the running core sends AI through a POWER云 node.
func (s *Service) AIGuardOfficial() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.aiGuardOut != "" && s.aiGuardOut != "reject" && s.core.Running() && s.aiNodeLocked("") != nil
}

// activeNodeLocked is the selected node (any source); nil = none.
func (s *Service) activeNodeLocked(activeID string) *nodes.Node {
	return s.nodeByID(cmp.Or(activeID, s.cfg.SelectedID))
}

// StartIfStopped starts the core unless it is already running (checked under
// the lifecycle lock, so it cannot race a resume-after-update start).
func (s *Service) StartIfStopped() (started bool, err error) {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	if s.core.Running() {
		return false, nil
	}
	return true, s.startLocked()
}

// HasNodes reports whether any node is configured (the proxy can start).
func (s *Service) HasNodes() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.cfg.Nodes) > 0
}

// aiNodeLocked picks the line for AI: the active node when it is one of ours
// (POWER云, signed profile), else the first of ours in the list; nil = none.
func (s *Service) aiNodeLocked(activeID string) *nodes.Node {
	if activeID == "" {
		activeID = s.cfg.SelectedID
	}
	for _, n := range s.cfg.Nodes {
		if n.ID == activeID && n.Official {
			return n
		}
	}
	for _, n := range s.cfg.Nodes {
		if n.Official {
			return n
		}
	}
	return nil
}

// applyAIGuardLocked sets opts.AIGuard for a core start / hot apply (another
// node of ours is registered in extra) and points the Claude Code accelerator
// at the same line. Caller holds s.mu.
func (s *Service) applyAIGuardLocked(opts *core.Options, activeID string, extra map[string]*nodes.Node) {
	opts.AIGuard = nil
	// No POWER云 line (any user may turn the guard on in 设置, owner 2026-10-23):
	// AI goes through the active node — still never direct. Only a config
	// without any node leaves AI blocked.
	out, official := "reject", false
	if n := s.aiNodeLocked(activeID); n != nil {
		out, official = "proxy", true
		if n.ID != activeID {
			out = "node-" + n.ID
			extra[out] = n
		}
	} else if s.activeNodeLocked(activeID) != nil {
		out = "proxy"
	}
	opts.AIProxy = s.aiProxyLocked(out)
	if !s.aiGuard {
		return
	}
	if official {
		opts.AccelOutbound = out
	}
	opts.AIGuard = &core.AIGuard{DomainSuffixes: aiguard.DomainSuffixes(), Domains: aiguard.Domains(), IPCIDRs: aiguard.IPCIDRs(), STUNProcesses: aiguard.WebRTCProcesses(),
		Outbound: out}
}

// noteAIGuardStartedLocked records what the started core uses for AI, starts
// the AI lock's warm-up / probe (ailock.go) and drops DNS failures Windows
// cached while the core was down.
func (s *Service) noteAIGuardStartedLocked(opts *core.Options) {
	s.noteAIProxyLocked(opts.AIProxy)
	g := opts.AIGuard
	s.aiGuardOut = ""
	if g == nil {
		return
	}
	s.aiGuardOut = g.Outbound
	aiguard.FlushCache()
	s.startAILockWatchLocked()
}

// flushAIDNSOnStop runs once the core is gone (stop, restart, crash): the AI
// lock goes back to the dead loopback server — synchronously, so quitting the
// app leaves it locked — and the Windows DNS cache is emptied, since AI
// addresses resolved through the line must not be reused while nothing is
// tunnelling (the lock only holds for fresh lookups).
func (s *Service) flushAIDNSOnStop() {
	s.mu.Lock()
	guarded := s.aiGuard || s.aiGuardOut != ""
	s.noteAIProxyLocked(nil) // the AI proxy is gone with the core
	s.endAILockWatchLocked()
	s.mu.Unlock()
	if guarded {
		s.SyncAILock()
		aiguard.FlushCache()
	}
}
