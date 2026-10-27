package service

import (
	"fmt"
	"path/filepath"
	"strings"

	"proxysplit/internal/capture"
	"proxysplit/internal/core"
)

// Capture modes (Settings.CaptureMode).
const (
	CaptureTUN     = "tun"     // 整机虚拟网卡：sing-box TUN 收全部流量（默认）
	CaptureProcess = "process" // 仅接管选中程序：WinDivert 只接管名单里的程序
)

// streamPreset are live-streaming programs sent direct by default (推流程序默认
// 直连) unless the user lists them anywhere; upload-heavy pushes must never sit
// behind the tunnel. Exe names to verify on a real install: 抖音直播伴侣,
// 快手直播伴侣, 哔哩哔哩直播姬, OBS.
var streamPreset = []string{
	"直播伴侣.exe", "mediasdk_server.exe", // 抖音直播伴侣 + its push engine
	"obs64.exe", "obs32.exe",
	"快手直播伴侣.exe", "kwailive.exe",
	"livehime.exe", // 哔哩哔哩直播姬
}

// streamPresetApps returns the preset programs the user has not routed.
func streamPresetApps(targets map[string]string) []string {
	var out []string
	for _, n := range streamPreset {
		if _, listed := targets[strings.ToLower(n)]; !listed {
			out = append(out, n)
		}
	}
	return out
}

// prepareProcessCapture switches opts to process capture when the user chose
// it. The AI lock needs every program's DNS and traffic, so it keeps the TUN.
// reuse keeps the running core's ports (hot app-list changes compare configs).
func (s *Service) prepareProcessCapture(set Settings, opts *core.Options, reuse map[string]int) error {
	if set.CaptureMode != CaptureProcess {
		return nil
	}
	if opts.AIGuardActive() {
		s.log("[capture] AI 强制走线路需要整机虚拟网卡，本次仍用 TUN 接管")
		return nil
	}
	ports := map[string]int{}
	for _, tag := range core.ProcessInbounds(*opts) {
		if p := reuse[tag]; p > 0 {
			ports[tag] = p
			continue
		}
		p, err := core.FreePort()
		if err != nil {
			return fmt.Errorf("分配本机端口失败: %w", err)
		}
		ports[tag] = p
	}
	opts.Process = &core.ProcessCapture{Ports: ports}
	return nil
}

func processPorts(opts core.Options) map[string]int {
	if opts.Process == nil {
		return nil
	}
	return opts.Process.Ports
}

// startCapture starts the WinDivert engine after the core is up.
func (s *Service) startCapture(opts core.Options) error {
	if opts.Process == nil {
		return nil
	}
	exclude := []string{filepath.Join(s.binDir, "sing-box.exe")}
	if p := s.portProcessPath(); p != "" {
		exclude = append(exclude, p)
	}
	eng, err := capture.Start(capture.Options{
		DLLPath: filepath.Join(s.binDir, "WinDivert.dll"),
		Exclude: exclude,
		Log:     s.log,
	}, core.ProcessRoutes(opts))
	if err != nil {
		return fmt.Errorf("仅接管选中程序启动失败（可在设置里改回「整机虚拟网卡」）: %w", err)
	}
	s.mu.Lock()
	s.capEng = eng
	s.mu.Unlock()
	return nil
}

// updateCaptureRoutes applies a hot app-list change to the running engine.
func (s *Service) updateCaptureRoutes(opts core.Options) {
	s.mu.Lock()
	eng := s.capEng
	s.mu.Unlock()
	if eng != nil && opts.Process != nil {
		eng.SetRoutes(core.ProcessRoutes(opts))
	}
}

// stopCapture closes the engine (driver handles) if running.
func (s *Service) stopCapture() {
	s.mu.Lock()
	eng := s.capEng
	s.capEng = nil
	s.mu.Unlock()
	if eng != nil {
		eng.Stop()
	}
}
