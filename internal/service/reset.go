package service

import "proxysplit/internal/engine"

// ResetConfig restores settings, app rules, custom lines and routing mode to
// factory defaults while KEEPING your nodes and subscriptions (servers are
// painful to re-add). Takes effect live.
func (s *Service) ResetConfig() {
	s.mu.Lock()
	def := defaultSettings()
	s.cfg = Config{
		Nodes:       s.cfg.Nodes,      // keep servers
		Subs:        s.cfg.Subs,       // keep subscriptions
		SelectedID:  s.cfg.SelectedID, // keep the active node
		Settings:    def,
		RuleMode:    engine.ModeWhitelist,
		DefaultLine: LineRule,
		LogLevel:    "info",
		ClashMode:   "rule",
		// Rules / Lines / Routing intentionally cleared to defaults.
	}
	s.clashMode = "rule"
	s.save()
	s.mu.Unlock()
	s.log("[store] 已重置为默认配置(保留了节点与订阅)")
	s.applyLive()
}
