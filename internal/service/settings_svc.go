package service

import (
	"fmt"

	"proxysplit/internal/core"
	"proxysplit/internal/coreupdate"
	"proxysplit/internal/geoupdate"
)

// GetRouting returns the current routing config.
func (s *Service) GetRouting() Routing {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Routing{Enabled: s.cfg.Routing.Enabled, Mode: s.cfg.Routing.Mode, Rules: append([]core.RouteRule{}, s.cfg.Routing.Rules...)}
}

// SetRouting replaces the routing config. It takes effect on the next Start (a
// core config regeneration), so the caller should restart if running.
func (s *Service) SetRouting(r Routing) string {
	if r.Mode == "" {
		r.Mode = core.RouteGlobal
	}
	s.mu.Lock()
	s.cfg.Routing = r
	s.save()
	s.mu.Unlock()
	return restartMsg(s.applyLive()) // master 分流 switch takes effect live
}

// GetCoreVersion returns the bundled sing-box version.
func (s *Service) GetCoreVersion() string {
	if v := coreupdate.InstalledVersion(s.binDir); v != "" {
		return v
	}
	return s.core.Version()
}

// UpdateRuleSets refreshes the bundled geosite/geoip rule-sets from the Shenzhen
// mirror, falling back to upstream through the running node when the core is up
// (raw.githubusercontent is blocked behind the GFW). Returns a status string for
// the UI.
func (s *Service) UpdateRuleSets() string {
	via := ""
	if s.core.Running() && s.core.Port() > 0 {
		via = fmt.Sprintf("127.0.0.1:%d", s.core.Port())
	}
	res, err := geoupdate.Update(s.binDir, via)
	if err != nil {
		s.log(fmt.Sprintf("[geo] update failed: %v", err))
		return err.Error()
	}
	s.log(fmt.Sprintf("[geo] %d rule-set(s) current, %d replaced (%d from upstream)", res.Current, res.Changed, res.Upstream))
	return ""
}

func (s *Service) GetSettings() Settings {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cfg.Settings
}

func (s *Service) SetSettings(st Settings) string {
	st.LogDays = st.LogRetentionDays() // 1–30 (logfiles.go)
	s.mu.Lock()
	old := s.cfg.Settings
	s.cfg.Settings = st
	s.save()
	s.mu.Unlock()
	if st.LogDays != old.LogRetentionDays() {
		s.files.PruneNow()
	}
	if st.ProcessCapture() && !old.ProcessCapture() {
		s.ensureWinDivertUnlocked() // fetch the driver before restart takes lifecycleMu
	}
	// Switching capture mode (TUN <-> app-split), QUIC policy, LAN sharing or
	// remote DNS changes the core filter/config, so restart if running.
	if s.core.Running() && (old.TunMode != st.TunMode || old.BlockQUIC != st.BlockQUIC ||
		old.LanShare != st.LanShare || old.RemoteDNS != st.RemoteDNS ||
		old.LanPort != st.LanPort || old.LanType != st.LanType || old.LanUser != st.LanUser || old.LanPass != st.LanPass ||
		old.PrivateDirect != st.PrivateDirect || old.ExcludeSelf != st.ExcludeSelf ||
		old.ClaudeAccelOff != st.ClaudeAccelOff || old.ProcessCapture() != st.ProcessCapture() || old.StreamDirectOff != st.StreamDirectOff || st.Net.changed(old.Net)) {
		if err := s.restart(); err != nil {
			s.log("[service] restart after settings change failed: " + err.Error())
			return restartMsg(err)
		}
	}
	return ""
}

// GetLogLevel / SetLogLevel control the core's log verbosity. Changing it takes
// effect on the next core start (a config regeneration), so restart if running.
func (s *Service) GetLogLevel() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cfg.LogLevel == "" {
		return "info"
	}
	return s.cfg.LogLevel
}

func (s *Service) SetLogLevel(level string) string {
	switch level {
	case "trace", "debug", "info", "warn", "error":
	default:
		level = "info"
	}
	s.mu.Lock()
	s.cfg.LogLevel = level
	s.save()
	s.mu.Unlock()
	if err := s.restart(); err != nil {
		s.log("[service] restart after log-level change failed: " + err.Error())
		return restartMsg(err)
	}
	return ""
}
