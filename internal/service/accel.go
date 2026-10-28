package service

import (
	"fmt"
	"slices"
	"strings"

	"proxysplit/internal/core"
)

// Claude Code 加速：内置编码端（internal/accel）经本机专用入口 accel-in 连落地机中继，
// 走的线路 = Claude Code 自己所走的线路（见 docs/Claude加速-网关切换.md）。

// claudeProcesses 是 Claude Code 的进程名：原生版 / VS Code 插件都是 claude.exe；npm 版跑在 node.exe 里
var claudeProcesses = []string{"claude.exe", "node.exe"}

// claudeOutbound 按分流规则算出 Claude Code 走的出站：列了它的线路用那条线路的节点；
// 直连 / 拦截 → direct（加速连不上中继，自动留在官方默认）；没列它时按白名单 / 黑名单的默认行为。
func claudeOutbound(opts *core.Options) string {
	for _, proc := range claudeProcesses {
		for _, g := range opts.SplitGroups {
			if slices.ContainsFunc(g.Names, func(n string) bool { return strings.EqualFold(n, proc) }) {
				return g.NodeTag
			}
		}
		in := func(list []string) bool {
			return slices.ContainsFunc(list, func(n string) bool { return strings.EqualFold(n, proc) })
		}
		if in(opts.SplitDirect) || in(opts.SplitBlock) {
			return "direct"
		}
	}
	if opts.SplitWhitelist {
		return "direct"
	}
	if opts.SplitDefault != nil {
		return opts.SplitDefault.NodeTag
	}
	return "proxy"
}

func (s *Service) accelPortLocked() int {
	if s.accelPort == 0 {
		s.accelPort, _ = core.FreePort()
	}
	return s.accelPort
}

// AccelSocks 返回加速专用的本机代理入口（内核在跑且功能开着时），否则 ""
func (s *Service) AccelSocks() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	// A direct line never reaches a relay (accel.powervpn.internal only
	// resolves behind our landing nodes): no probe, Claude Code stays official.
	if s.cfg.Settings.ClaudeAccelOff || s.accelPort == 0 || !s.core.Running() || s.accelOut == "" || s.accelOut == "direct" {
		return ""
	}
	return fmt.Sprintf("127.0.0.1:%d", s.accelPort)
}

// AccelLine 标识 Claude Code 当前所走的线路（主节点 + 出站）；变了 = 用户换了线路
func (s *Service) AccelLine() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cfg.SelectedID + "|" + s.accelOut
}

// AccelSettings 返回（功能关闭, 自动切换关闭）
func (s *Service) AccelSettings() (off, autoOff bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cfg.Settings.ClaudeAccelOff, s.cfg.Settings.ClaudeAccelAutoOff
}

// Log 把加速模块的日志写进同一条日志流（界面「日志」页可见）
func (s *Service) Log(line string) { s.log(line) }
