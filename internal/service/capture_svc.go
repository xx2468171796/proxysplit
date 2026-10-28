package service

import (
	"fmt"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"proxysplit/internal/capture"
	"proxysplit/internal/core"
	"proxysplit/internal/coreupdate"
)

// Capture modes (Settings.CaptureMode).
const (
	CaptureTUN     = "tun"     // 整机虚拟网卡：sing-box TUN 收全部流量（须显式选择）
	CaptureProcess = "process" // 仅接管选中程序：WinDivert 只接管名单里的程序（默认，含未设置）
)

// ProcessCapture reports 仅接管选中程序, the default (业主 2026-10-28: the
// product is per-program capture; unlisted programs must not pass through us).
// Only an explicit "tun" picks 整机虚拟网卡.
// WinDivert exists only on Windows: elsewhere the TUN with per-app rules is
// the capture.
func (st Settings) ProcessCapture() bool {
	return runtime.GOOS == "windows" && st.CaptureMode != CaptureTUN
}

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
	if !set.ProcessCapture() {
		return nil
	}
	if opts.AIGuardActive() {
		s.log("[capture] AI 强制走线路需要整机虚拟网卡，本次仍用 TUN 接管")
		return nil
	}
	if s.wdBroken.Load() {
		s.log("[capture] 「仅接管选中程序」的驱动本次打不开，继续用整机虚拟网卡")
		return nil
	}
	if !s.winDivertReady() {
		// First start after install / update: never fail it, use the TUN this
		// once while the driver downloads.
		s.prefetchWinDivert()
		s.log("[capture] 「仅接管选中程序」的驱动还在下载，本次先用整机虚拟网卡，下次启动自动切换")
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

// captureFallbackNote tells the user why 仅接管选中程序 is on the TUN this run
// and how to get it back.
func (s *Service) captureFallbackNote() string {
	msg := "「仅接管选中程序」的驱动被这台电脑拦下了，本次已自动改用「整机虚拟网卡」，代理照常可用。"
	if sec := DetectSecuritySoftware(); len(sec) > 0 {
		return msg + "多半是" + strings.Join(sec, "、") + "拦的：在它的「信任区」里添加 proxysplit.exe 所在目录和 " + s.binDir + "，再重启 ProxySplit 即可恢复。"
	}
	return msg + "常见原因是安全软件或别的软件装了另一个版本的同类驱动；重启电脑后再试。"
}

// winDivertReady reports the driver files are in place (tests stub it).
func (s *Service) winDivertReady() bool {
	if s.wdReady != nil {
		return s.wdReady()
	}
	return coreupdate.WinDivertReady(s.binDir)
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
	// Every core we run shares these two binaries: the main / 端口代理 / probe
	// sing-box and every xray sidecar (main, per port, latency probe) run from
	// binDir, so excluding by image path covers all of them. Capturing them in
	// 默认全走代理 would loop their upstream traffic back into sing-box.
	exclude := []string{s.singBoxPath(), core.XrayBinPath(s.singBoxPath())}
	if p := s.portProcessPath(); p != "" {
		exclude = append(exclude, p)
	}
	if !coreupdate.WinDivertReady(s.binDir) {
		// Never download under lifecycleMu: Start / SetSettings fetch it first.
		s.prefetchWinDivert()
		return fmt.Errorf("仅接管选中程序需要的驱动还没下载好，正在后台下载，请稍后再启动（或在设置里改回「整机虚拟网卡」）")
	}
	eng, err := capture.Start(capture.Options{
		DLLPath: filepath.Join(s.binDir, "WinDivert.dll"),
		Exclude: exclude,
		Log:     s.log, // the watchdog's stall message lands in the log as well
	}, core.ProcessRoutes(opts))
	if err != nil {
		return fmt.Errorf("仅接管选中程序启动失败（可在设置里改回「整机虚拟网卡」）: %w", err)
	}
	s.mu.Lock()
	s.capEng = eng
	s.mu.Unlock()
	return nil
}

// winDivertWait bounds how long Start / SetSettings wait for the driver
// download before giving up (the download itself keeps going in background).
const winDivertWait = 60 * time.Second

// prefetchWinDivert starts (at most one) background download of the WinDivert
// files and returns a channel closed when it ends.
func (s *Service) prefetchWinDivert() <-chan struct{} {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.wdFetch != nil {
		return s.wdFetch
	}
	done := make(chan struct{})
	s.wdFetch = done
	go func() {
		err := coreupdate.EnsureWinDivert(s.binDir)
		if err != nil {
			s.log("[capture] 下载 WinDivert 驱动失败: " + err.Error())
		}
		s.mu.Lock()
		s.wdFetch = nil
		s.mu.Unlock()
		close(done)
	}()
	return done
}

// ensureWinDivertUnlocked makes sure the driver files are present before the
// core starts in 仅接管选中程序 mode. Callers must NOT hold lifecycleMu: a slow
// mirror may take up to winDivertWait, and start/stop must stay responsive.
func (s *Service) ensureWinDivertUnlocked() {
	s.mu.Lock()
	proc := s.cfg.Settings.ProcessCapture()
	s.mu.Unlock()
	if !proc || coreupdate.WinDivertReady(s.binDir) {
		return
	}
	s.log("[capture] 正在下载「仅接管选中程序」需要的 WinDivert 驱动…")
	select {
	case <-s.prefetchWinDivert():
	case <-time.After(winDivertWait):
		s.log("[capture] WinDivert 驱动下载超过 60 秒，继续在后台下载")
	}
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
