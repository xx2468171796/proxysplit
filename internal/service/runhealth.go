package service

import (
	"time"

	"proxysplit/internal/capture"
)

// Run phases (Status.RunState).
const (
	RunStopped = "stopped"
	RunRunning = "running"
)

// Capture states of 仅接管选中程序 (Status.CaptureState; "" = not in use).
const (
	CaptureOK         = "ok"
	CaptureRestarting = "restarting" // the watchdog stopped the engine, one automatic restart is running
)

// Run event kinds (RunEvent.Kind).
const (
	EventCaptureRestarted = "capture-restarted" // the capture engine stalled and was restarted
	EventCaptureFailed    = "capture-failed"    // it could not be kept alive: the proxy was stopped
)

// RunEvent tells the UI that the proxy changed state by itself (nobody clicked).
type RunEvent struct {
	Kind    string `json:"kind"`
	Message string `json:"message"`
}

// captureRestartWindow: a second watchdog stop this soon after an automatic
// restart means the engine cannot run on this PC — stop instead of looping.
const captureRestartWindow = 10 * time.Minute

// captureEngine is what the service needs from capture.Engine (tests fake it).
type captureEngine interface {
	SetRoutes(*capture.Routes)
	ProgramFor(port uint16) string
	Stop()
}

// runHealth is the service's own view of the running proxy: whether it should
// be up, why it is not, and how the capture engine is doing. Guarded by s.mu.
type runHealth struct {
	phase        string
	stopReason   string // why the proxy stopped by itself; cleared by the next start / stop
	capture      string
	capGen       uint64          // generation of the engine in s.capEng (stale failure callbacks are ignored)
	capRoutes    *capture.Routes // what the engine currently routes by (for the automatic restart)
	capRestartAt time.Time       // last automatic capture restart
	sink         func(RunEvent)
}

// allowCaptureRestart reports whether a watchdog stop at now may be answered
// with an automatic restart, and records that restart.
func (h *runHealth) allowCaptureRestart(now time.Time) bool {
	if !h.capRestartAt.IsZero() && now.Sub(h.capRestartAt) < captureRestartWindow {
		return false
	}
	h.capRestartAt = now
	return true
}

// SetRunEventSink registers the callback for self-initiated state changes
// (capture restarted / proxy stopped by itself). The same text is always
// written to the log as well.
func (s *Service) SetRunEventSink(fn func(RunEvent)) {
	s.mu.Lock()
	s.health.sink = fn
	s.mu.Unlock()
}

// emitRun logs a self-initiated state change and hands it to the event sink.
func (s *Service) emitRun(kind, msg string) {
	s.log("[service] " + msg)
	s.mu.Lock()
	fn := s.health.sink
	s.mu.Unlock()
	if fn != nil {
		fn(RunEvent{Kind: kind, Message: msg})
	}
}

// failRun stops a proxy that can no longer do its job and records why, so the
// UI shows "stopped" with the reason instead of a running proxy that leaks.
// Caller holds lifecycleMu.
func (s *Service) failRun(kind, reason string) {
	s.stopLocked()
	s.mu.Lock()
	s.health.stopReason = reason
	s.mu.Unlock()
	s.emitRun(kind, reason)
}

// onCaptureFail runs (async) when the capture watchdog stopped engine gen: its
// handles are closed, so selected programs are going direct. One automatic
// restart is tried; when that fails, or the engine stalls again right after
// one, the whole proxy is stopped — a core that keeps running without capture
// would show "running" while nothing is proxied.
func (s *Service) onCaptureFail(gen uint64, msg string) {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	s.mu.Lock()
	current := s.capEng != nil && s.health.capGen == gen
	routes := s.health.capRoutes
	retry := current && s.health.allowCaptureRestart(time.Now())
	if current {
		s.health.capture = CaptureRestarting
	}
	s.mu.Unlock()
	if !current {
		return // stopped or replaced since
	}
	s.stopCapture() // waits for the failed engine to release the driver
	if !retry {
		s.failRun(EventCaptureFailed, "「仅接管选中程序」重启后又卡住，已停止代理（选中的程序现在是直连）。请在设置里改用「整机虚拟网卡」后再启动")
		return
	}
	if err := s.startCaptureRoutes(routes); err != nil {
		s.failRun(EventCaptureFailed, "「仅接管选中程序」卡住后重启失败，已停止代理（选中的程序现在是直连）："+err.Error())
		return
	}
	s.emitRun(EventCaptureRestarted, "「仅接管选中程序」处理卡住，已自动重启接管（期间选中的程序短暂直连）")
}
