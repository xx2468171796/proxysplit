package service

import (
	"fmt"
	"time"

	"proxysplit/internal/capture"
)

// Run phases (Status.RunState).
const (
	RunStopped    = "stopped"
	RunRunning    = "running"
	RunRestarting = "restarting" // a changed config is being swapped in
	RunRecovering = "recovering" // the core died by itself: automatic restart in progress
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
	EventCoreRestarting   = "core-restarting"   // the core exited by itself, restarting it
	EventCoreRestarted    = "core-restarted"    // ... and it is back
	EventCoreFailed       = "core-failed"       // ... and it would not come back: the proxy was stopped
)

// RunEvent tells the UI that the proxy changed state by itself (nobody clicked).
type RunEvent struct {
	Kind    string `json:"kind"`
	Message string `json:"message"`
}

// captureRestartWindow: a second watchdog stop this soon after an automatic
// restart means the engine cannot run on this PC — stop instead of looping.
const captureRestartWindow = 10 * time.Minute

// coreRestartBackoff are the waits before each automatic core restart; after
// the last one fails the proxy is stopped. A crash loop shares one budget: the
// count only resets once a restarted core has stayed up for coreStableAfter.
var coreRestartBackoff = []time.Duration{time.Second, 5 * time.Second, 15 * time.Second}

const coreStableAfter = 2 * time.Minute

// captureEngine is what the service needs from capture.Engine (tests fake it).
type captureEngine interface {
	SetRoutes(*capture.Routes)
	SetHold(bool)
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

	coreRestarts  int             // automatic core restarts used from the budget
	recoverCancel chan struct{}   // identifies the running recovery; closed when it is called off
	backoff       []time.Duration // nil = coreRestartBackoff (tests shorten it)
	restartCore   func() error    // nil = restartCoreLocked (tests fake it)
}

// endRecoveryLocked calls off a running recovery. Caller holds s.mu.
func (h *runHealth) endRecoveryLocked() {
	if h.recoverCancel != nil {
		close(h.recoverCancel)
		h.recoverCancel = nil
	}
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

// beginRecovery turns an unexpected core exit into a recovery: it returns the
// recovery's cancel channel, or nil when the proxy was not up (a core that
// dies while starting is the starter's business).
func (s *Service) beginRecovery() chan struct{} {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.health.phase != RunRunning {
		return nil
	}
	if time.Since(s.startedAt) > coreStableAfter {
		s.health.coreRestarts = 0
	}
	s.health.phase = RunRecovering
	s.health.recoverCancel = make(chan struct{})
	return s.health.recoverCancel
}

// recovering reports whether the recovery identified by cancel is still on
// (a user stop / start ends it).
func (s *Service) recovering(cancel chan struct{}) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.health.phase == RunRecovering && s.health.recoverCancel == cancel
}

// recoverCore restarts a core that exited by itself, with backoff. Until it is
// back the capture engine holds selected programs (no direct fallback); when
// the budget is used up the proxy is stopped with the reason.
func (s *Service) recoverCore(cancel chan struct{}) {
	lastErr := "内核反复退出"
	for {
		s.mu.Lock()
		n := s.health.coreRestarts
		s.health.coreRestarts++
		backoff := s.health.backoff
		restart := s.health.restartCore
		s.mu.Unlock()
		if backoff == nil {
			backoff = coreRestartBackoff
		}
		if n >= len(backoff) {
			break
		}
		select {
		case <-cancel:
			return
		case <-s.quit:
			return
		case <-time.After(backoff[n]):
		}
		s.lifecycleMu.Lock()
		if !s.recovering(cancel) {
			s.lifecycleMu.Unlock()
			return
		}
		s.log(fmt.Sprintf("[service] 内核意外退出，正在自动重启（第 %d / %d 次）", n+1, len(backoff)))
		if restart == nil {
			restart = s.restartCoreLocked
		}
		err := restart()
		s.lifecycleMu.Unlock()
		if err == nil {
			s.emitRun(EventCoreRestarted, "内核意外退出后已自动重启，代理恢复正常")
			return
		}
		lastErr = err.Error()
		s.log("[service] 自动重启内核失败: " + lastErr)
	}
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	if s.recovering(cancel) {
		s.failRun(EventCoreFailed, "内核意外退出，自动重启没有成功，已停止代理（选中的程序现在是直连）："+lastErr)
	}
}

// restartCoreLocked starts the core again after it exited by itself, keeping
// the (held) capture engine. Caller holds lifecycleMu.
func (s *Service) restartCoreLocked() error {
	s.stopCoreLocked()
	return s.startLocked()
}
