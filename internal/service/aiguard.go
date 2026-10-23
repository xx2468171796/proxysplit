package service

import (
	"net"

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

// activeNodeLocked is the selected node (any source); nil = none.
func (s *Service) activeNodeLocked(activeID string) *nodes.Node {
	if activeID == "" {
		activeID = s.cfg.SelectedID
	}
	for _, n := range s.cfg.Nodes {
		if n.ID == activeID {
			return n
		}
	}
	return nil
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
	if !s.aiGuard {
		return
	}
	// No POWER云 line (any user may turn the guard on in 设置, owner 2026-10-23):
	// AI goes through the active node — still never direct. Only a config
	// without any node leaves AI blocked.
	out := "reject"
	if n := s.aiNodeLocked(activeID); n != nil {
		out = "proxy"
		if n.ID != activeID {
			out = "node-" + n.ID
			extra[out] = n
		}
		opts.AccelOutbound = out
	} else if s.activeNodeLocked(activeID) != nil {
		out = "proxy"
	}
	// The running core keeps its listener (a hot apply must build the same
	// config); a fresh start checks the loopback port is free first, so a
	// taken port 53 leaves AI unresolvable (locked) instead of failing the start.
	listen := s.aiDNSListen
	if !s.core.Running() {
		listen = aiguard.DNSServer
		err := loopbackDNSFree(listen)
		if err != nil {
			s.core.CleanStrays() // an orphaned core of ours may still hold the port
			err = loopbackDNSFree(listen)
		}
		if err != nil {
			listen = ""
			s.log("[AI] 本机 DNS 端口被占用（多半是别的代理软件），AI 网站会打不开：" + err.Error())
		}
	}
	opts.AIGuard = &core.AIGuard{DomainSuffixes: aiguard.DomainSuffixes(), Domains: aiguard.Domains(), IPCIDRs: aiguard.IPCIDRs(),
		Outbound: out, DNSListen: listen}
}

// noteAIGuardStartedLocked records what the started core uses for AI and
// drops DNS failures Windows cached while the core was down.
func (s *Service) noteAIGuardStartedLocked(g *core.AIGuard) {
	s.aiGuardOut, s.aiDNSListen = "", ""
	if g == nil {
		return
	}
	s.aiGuardOut, s.aiDNSListen = g.Outbound, g.DNSListen
	aiguard.FlushCache()
}

// flushAIDNSOnStop empties the Windows DNS cache once the core is gone (stop,
// restart, crash): AI addresses resolved through the line must not be reused
// while nothing is tunnelling — the lock only holds for fresh lookups.
func (s *Service) flushAIDNSOnStop() {
	s.mu.Lock()
	guarded := s.aiGuard || s.aiGuardOut != ""
	s.mu.Unlock()
	if guarded {
		aiguard.FlushCache()
	}
}

// AIDNSListening: the running core answers the AI lock's DNS queries.
func (s *Service) AIDNSListening() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.aiDNSListen != "" && s.core.Running()
}

func loopbackDNSFree(ip string) error {
	addr := net.JoinHostPort(ip, "53")
	pc, err := net.ListenPacket("udp", addr)
	if err != nil {
		return err
	}
	pc.Close()
	l, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	return l.Close()
}
