package service

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"time"

	"proxysplit/internal/aiguard"
	"proxysplit/internal/core"
)

// Cache and network-repair actions of the reset center. None of them touches
// the AI hijack switch or its NRPT rules: aiguard.FlushCache only empties the
// Windows resolver cache (DnsFlushResolverCache); NRPT policy is untouched.

// resetCoreDNS empties sing-box's DNS cache through the clash API
// (POST /cache/dns/flush, sing-box ≥ 1.12). The core keeps no cache_file, so
// when the API call fails a restart is the equivalent fallback.
func (s *Service) resetCoreDNS(ctx context.Context) (string, error) {
	s.mu.Lock()
	port, secret := s.clashPort, s.clashSecret
	s.mu.Unlock()
	if !s.core.Running() || port <= 0 {
		return "内核没有运行，没有需要清的缓存", nil
	}
	if err := clashPost(ctx, port, secret, "/cache/dns/flush"); err == nil {
		_ = clashPost(ctx, port, secret, "/cache/fakeip/flush") // only when fake-ip is on; ignore 404
		s.log("[reset] 内核 DNS 缓存已清空")
		return "已清空（未重启内核）", nil
	}
	if err := s.restart(); err != nil {
		return "", fmt.Errorf("清缓存需要重启内核，重启失败：%w", err)
	}
	return "已通过重启内核清空", nil
}

// clashPost issues an authenticated POST to the running core's clash API.
func clashPost(ctx context.Context, port int, secret, path string) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("http://127.0.0.1:%d%s", port, path), nil)
	if err != nil {
		return err
	}
	if secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1024))
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("clash_api %s: status %d", path, resp.StatusCode)
	}
	return nil
}

func (s *Service) resetWindowsDNS(context.Context) (string, error) {
	aiguard.FlushCache()
	s.log("[reset] Windows DNS 缓存已清空")
	return "已清空 Windows DNS 缓存", nil
}

func (s *Service) resetRuleSets(context.Context) (string, error) {
	if msg := s.UpdateRuleSets(); msg != "" {
		return "", fmt.Errorf("规则库更新失败（已保留旧文件）：%s", msg)
	}
	return "规则库已校验为最新", nil
}

func (s *Service) resetSysProxy(context.Context) (string, error) {
	s.mu.Lock()
	s.sysProxyWant = false
	s.mu.Unlock()
	if err := s.clearOSProxy(); err != nil {
		return "", fmt.Errorf("关闭系统代理失败：%w", err)
	}
	return "已关闭 Windows 系统代理", nil
}

// resetStrays stops what we run, kills every orphan of ours (main core, Xray
// sidecars, proxy-port processes, latency probes) and restarts what was
// running. AI guard: the stop → start gap behaves exactly like a normal core
// restart — the NRPT lock stays and AI lookups fail closed meanwhile.
func (s *Service) resetStrays(context.Context) (string, error) {
	ports := s.runningPortIDs()
	for _, id := range ports {
		s.stopPort(id)
	}
	s.lifecycleMu.Lock()
	wasRunning := s.core.Running()
	if wasRunning {
		s.stopLocked()
	}
	bin := filepath.Join(s.binDir, "sing-box.exe")
	s.core.CleanStrays()
	core.KillPortStrays(bin, s.dataDir)
	core.CleanProbeStrays(bin, filepath.Join(s.dataDir, "probes"))
	var startErr error
	if wasRunning {
		startErr = s.startLocked()
	}
	s.lifecycleMu.Unlock()
	failed := s.startPorts(ports)
	s.log("[reset] 已清理残留内核进程")
	switch {
	case startErr != nil:
		return "", fmt.Errorf("残留已清理，但代理重启失败：%w", startErr)
	case failed > 0:
		return fmt.Sprintf("残留已清理；%d 个端口代理重启失败，请到端口代理页查看", failed), nil
	case wasRunning:
		return "残留已清理，代理已重新启动", nil
	}
	return "残留已清理", nil
}

// runningPortIDs lists proxy ports that currently have a runtime.
func (s *Service) runningPortIDs() []string {
	s.ports.mu.Lock()
	defer s.ports.mu.Unlock()
	ids := make([]string, 0, len(s.ports.rt))
	for id := range s.ports.rt {
		ids = append(ids, id)
	}
	return ids
}

// startPorts (re)starts the given ports that are still configured and enabled.
func (s *Service) startPorts(ids []string) (failed int) {
	s.mu.Lock()
	enabled := map[string]bool{}
	for _, p := range s.cfg.ProxyPorts {
		enabled[p.ID] = p.Enabled
	}
	s.mu.Unlock()
	for _, id := range ids {
		if !enabled[id] {
			continue
		}
		if err := s.startPort(id); err != nil {
			s.log(fmt.Sprintf("[port] %s 重启失败：%v", id, err))
			failed++
		}
	}
	return failed
}
