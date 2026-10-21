package service

import (
	"fmt"
	"net"
	"time"

	"proxysplit/internal/sysproxy"
)

// setOSProxy applies the OS system proxy to server and records it as OUR marker
// (persisted) so a later launch can tell our leftover apart from another proxy
// tool's setting and only self-heal our own.
func (s *Service) setOSProxy(server string) error {
	if err := sysproxy.Set(server); err != nil {
		return err
	}
	s.mu.Lock()
	s.sysProxyOn = true
	s.cfg.SysProxyLast = server
	s.save()
	s.mu.Unlock()
	return nil
}

// clearOSProxy turns the OS system proxy off and forgets our marker.
func (s *Service) clearOSProxy() error {
	err := sysproxy.Clear()
	s.mu.Lock()
	s.sysProxyOn = false
	s.cfg.SysProxyLast = ""
	s.save()
	s.mu.Unlock()
	return err
}

// SetSystemProxy turns the Windows system HTTP proxy on or off. Turning it on
// records the intent AND, if the core is running, points the system proxy at its
// mixed inbound now; the intent is re-applied (with the fresh port) on every
// Start so a settings/rule restart doesn't silently drop it.
func (s *Service) SetSystemProxy(on bool) error {
	if on {
		s.mu.Lock()
		running := s.core.Running()
		port := s.core.Port()
		s.mu.Unlock()

		if running && port == 0 {
			return fmt.Errorf("无需系统代理:应用分流和整机全局都由虚拟网卡接管流量")
		}
		s.mu.Lock()
		s.sysProxyWant = true
		s.mu.Unlock()
		if !running {
			s.log("[sysproxy] 已开启(将在启动代理后生效)")
			return nil // intent recorded; applied on next Start
		}
		if err := s.setOSProxy(fmt.Sprintf("127.0.0.1:%d", port)); err != nil {
			return err
		}
		s.log(fmt.Sprintf("[sysproxy] on -> 127.0.0.1:%d", port))
		return nil
	}

	s.mu.Lock()
	s.sysProxyWant = false
	s.mu.Unlock()
	if err := s.clearOSProxy(); err != nil {
		return err
	}
	s.log("[sysproxy] off")
	return nil
}

// applySystemProxyOnStart re-points the OS proxy at the freshly-started core when
// the user has system proxy enabled. No-op in TUN mode (no local port) or when
// the user hasn't asked for it. Called at the end of a successful Start.
func (s *Service) applySystemProxyOnStart() {
	s.mu.Lock()
	want := s.sysProxyWant
	port := s.core.Port()
	s.mu.Unlock()
	if !want || port == 0 {
		return
	}
	if err := s.setOSProxy(fmt.Sprintf("127.0.0.1:%d", port)); err != nil {
		s.log(fmt.Sprintf("[sysproxy] re-apply on start failed: %v", err))
		return
	}
	s.log(fmt.Sprintf("[sysproxy] re-applied -> 127.0.0.1:%d", port))
}

// onCoreExit is invoked from the core manager when sing-box exits for ANY reason.
// If it died while the system proxy still pointed at its port (e.g. a crash that
// skipped Stop), clear the OS proxy so the user's HTTP isn't black-holed. The
// intent (sysProxyWant) is kept so a manual restart re-applies it.
func (s *Service) onCoreExit() {
	s.flushAIDNSOnStop() // core gone: no cached AI address may outlive the tunnel
	s.mu.Lock()
	on := s.sysProxyOn
	s.mu.Unlock()
	if !on {
		return
	}
	if err := s.clearOSProxy(); err == nil {
		s.log("[sysproxy] 内核退出,已清理系统代理(避免流量黑洞)")
	}
}

// healStaleSystemProxy clears a leftover Windows system proxy from a crash/force
// -kill that skipped Stop(). It only clears the proxy when the OS setting EXACTLY
// matches our persisted marker (the ephemeral 127.0.0.1:<port> we last set) AND
// that port is dead — so a live proxy, or another tool's proxy, is never touched.
func (s *Service) healStaleSystemProxy() {
	enabled, server := sysproxy.Get()
	s.mu.Lock()
	marker := s.cfg.SysProxyLast
	s.mu.Unlock()
	if !enabled || server == "" || server != marker {
		return
	}
	if c, err := net.DialTimeout("tcp", server, 400*time.Millisecond); err == nil {
		c.Close() // still alive — leave it alone
		return
	}
	if err := s.clearOSProxy(); err == nil {
		s.log("[sysproxy] 已清理残留的系统代理(端口已失效)")
	}
}

// GetSystemProxy reports whether the user has the system proxy enabled.
func (s *Service) GetSystemProxy() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sysProxyWant
}
