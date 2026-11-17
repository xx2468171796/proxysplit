package service

import (
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"proxysplit/internal/capture"
	"proxysplit/internal/core"
)

// fakeEngine stands in for the WinDivert engine.
type fakeEngine struct {
	mu      sync.Mutex
	stopped bool
	hold    []bool
	routes  []*capture.Routes
}

func (f *fakeEngine) SetRoutes(r *capture.Routes) {
	f.mu.Lock()
	f.routes = append(f.routes, r)
	f.mu.Unlock()
}
func (f *fakeEngine) SetHold(on bool) {
	f.mu.Lock()
	f.hold = append(f.hold, on)
	f.mu.Unlock()
}
func (f *fakeEngine) ProgramFor(uint16) string { return "" }
func (f *fakeEngine) Stop() {
	f.mu.Lock()
	f.stopped = true
	f.mu.Unlock()
}

// captureHarness is a stopped service whose capture engine is faked: every
// start is recorded together with the OnFail callback the service installed.
type captureHarness struct {
	s       *Service
	engines []*fakeEngine
	onFail  []func(string)
	events  []RunEvent
	failAt  int // fail the Nth engine start (1-based; 0 = never)
}

func newCaptureHarness(t *testing.T) *captureHarness {
	t.Helper()
	dir := t.TempDir()
	h := &captureHarness{}
	h.s = &Service{onLog: func(string) {}, dataDir: dir, binDir: dir, wdReady: func() bool { return true },
		core: core.NewManager(filepath.Join(dir, "no-core"), dir, nil)}
	h.s.capStart = func(o capture.Options, _ *capture.Routes) (captureEngine, error) {
		if h.failAt == len(h.engines)+1 {
			h.engines = append(h.engines, nil)
			return nil, errors.New("WinDivertOpen: 1450")
		}
		e := &fakeEngine{}
		h.engines = append(h.engines, e)
		h.onFail = append(h.onFail, o.OnFail)
		return e, nil
	}
	h.s.SetRunEventSink(func(ev RunEvent) { h.events = append(h.events, ev) })
	return h
}

// startProcessRun puts the service in "running with 仅接管选中程序".
func (h *captureHarness) startProcessRun(t *testing.T) {
	t.Helper()
	if err := h.s.startCaptureRoutes(&capture.Routes{}); err != nil {
		t.Fatal(err)
	}
	h.s.mu.Lock()
	h.s.run = &runState{procPorts: map[string]int{"in": 1}}
	h.s.health.phase = RunRunning
	h.s.mu.Unlock()
}

func (h *captureHarness) kinds() []string {
	var out []string
	for _, ev := range h.events {
		out = append(out, ev.Kind)
	}
	return out
}

// The watchdog closing the engine must not leave "running" with nothing
// captured: one automatic restart brings the capture back.
func TestCaptureStallRestartsEngineOnce(t *testing.T) {
	h := newCaptureHarness(t)
	h.startProcessRun(t)
	h.onFail[0](capture.StallMessage)

	if len(h.engines) != 2 || !h.engines[0].stopped || h.engines[1].stopped {
		t.Fatalf("want the stalled engine stopped and a new one started, got %d engines", len(h.engines))
	}
	st := h.s.Status()
	if st.CaptureState != CaptureOK || st.RunState != RunRunning || st.StopReason != "" {
		t.Fatalf("after an automatic restart: %+v", st)
	}
	if got := h.kinds(); len(got) != 1 || got[0] != EventCaptureRestarted {
		t.Fatalf("events = %v", got)
	}
}

// A second stall right after the automatic restart, or a restart that fails,
// stops the proxy and says why.
func TestCaptureStallStopsProxyWhenRestartDoesNotHold(t *testing.T) {
	for name, failAt := range map[string]int{"stalls again": 0, "restart fails": 2} {
		t.Run(name, func(t *testing.T) {
			h := newCaptureHarness(t)
			h.failAt = failAt
			h.startProcessRun(t)
			h.onFail[0](capture.StallMessage)
			if failAt == 0 {
				h.onFail[1](capture.StallMessage)
			}
			st := h.s.Status()
			if st.RunState != RunStopped || st.StopReason == "" || st.EngineRunning || st.CaptureState != "" {
				t.Fatalf("proxy must be stopped with a reason: %+v", st)
			}
			if got := h.kinds(); got[len(got)-1] != EventCaptureFailed {
				t.Fatalf("events = %v", got)
			}
			h.s.mu.Lock()
			eng := h.s.capEng
			h.s.mu.Unlock()
			if eng != nil {
				t.Fatal("no engine may stay registered after the proxy stopped")
			}
		})
	}
}

// A failure callback from an engine that was already replaced or stopped (user
// clicked 停止 meanwhile) must not restart anything.
func TestStaleCaptureFailureIsIgnored(t *testing.T) {
	h := newCaptureHarness(t)
	h.startProcessRun(t)
	h.s.Stop()
	h.onFail[0](capture.StallMessage)
	if len(h.engines) != 1 || len(h.events) != 0 {
		t.Fatalf("stale failure acted: %d engines, events %v", len(h.engines), h.kinds())
	}
}

// 仅接管选中程序 with no engine is not "engine running", whatever the core says.
func TestEngineUpNeedsCaptureEngine(t *testing.T) {
	cases := []struct{ core, process, engine, want bool }{
		{true, false, false, true}, // TUN capture: the core is the engine
		{true, true, true, true},
		{true, true, false, false}, // capture gone: nothing is proxied
		{false, true, true, false},
	}
	for _, c := range cases {
		if got := engineUp(c.core, c.process, c.engine); got != c.want {
			t.Fatalf("engineUp(%v,%v,%v) = %v", c.core, c.process, c.engine, got)
		}
	}
}

// waitEvent blocks until the harness has seen an event of kind (the recovery
// runs in its own goroutine).
func waitEvent(t *testing.T, ch <-chan RunEvent, kind string) {
	t.Helper()
	for {
		select {
		case ev := <-ch:
			if ev.Kind == kind {
				return
			}
		case <-time.After(10 * time.Second):
			t.Fatalf("no %s event", kind)
		}
	}
}

// recoveryHarness is a "running" service whose core restart is faked.
func recoveryHarness(t *testing.T, restart func(s *Service) error) (*captureHarness, <-chan RunEvent, *atomic.Int32) {
	t.Helper()
	h := newCaptureHarness(t)
	h.startProcessRun(t)
	events := make(chan RunEvent, 16)
	h.s.SetRunEventSink(func(ev RunEvent) { events <- ev })
	attempts := &atomic.Int32{}
	h.s.mu.Lock()
	h.s.startedAt = time.Now()
	h.s.health.backoff = []time.Duration{0, 0, 0}
	h.s.health.restartCore = func() error {
		attempts.Add(1)
		return restart(h.s)
	}
	h.s.mu.Unlock()
	return h, events, attempts
}

// markRestarted is what a successful launch records.
func markRestarted(s *Service) error {
	s.mu.Lock()
	s.startedAt = time.Now()
	s.health.phase, s.health.recoverCancel = RunRunning, nil
	s.mu.Unlock()
	return nil
}

// A core that exits by itself is restarted; meanwhile the capture engine holds
// the selected programs instead of being closed (closed = they go direct).
func TestCoreExitHoldsCaptureAndRestarts(t *testing.T) {
	h, events, attempts := recoveryHarness(t, markRestarted)
	h.s.onCoreExit()
	waitEvent(t, events, EventCoreRestarted)

	eng := h.engines[0]
	eng.mu.Lock()
	defer eng.mu.Unlock()
	if eng.stopped || len(eng.hold) == 0 || !eng.hold[0] {
		t.Fatalf("engine must be held, not stopped: stopped=%v hold=%v", eng.stopped, eng.hold)
	}
	if attempts.Load() != 1 {
		t.Fatalf("restart attempts = %d", attempts.Load())
	}
}

// When every restart fails the proxy ends up stopped with the reason, and the
// held programs are released (stopped means direct, as after 停止).
func TestCoreExitGivesUpAfterBudget(t *testing.T) {
	h, events, attempts := recoveryHarness(t, func(*Service) error { return errors.New("wintun busy") })
	h.s.onCoreExit()
	waitEvent(t, events, EventCoreFailed)

	st := h.s.Status()
	if attempts.Load() != 3 || st.RunState != RunStopped || !strings.Contains(st.StopReason, "wintun busy") {
		t.Fatalf("attempts=%d status=%+v", attempts.Load(), st)
	}
	h.engines[0].mu.Lock()
	stopped := h.engines[0].stopped
	h.engines[0].mu.Unlock()
	if !stopped {
		t.Fatal("giving up must close the capture engine")
	}
}

// A core that keeps dying right after each restart shares one budget instead
// of restarting forever.
func TestCoreCrashLoopSharesBudget(t *testing.T) {
	h, events, attempts := recoveryHarness(t, markRestarted)
	for range 3 {
		h.s.onCoreExit()
		waitEvent(t, events, EventCoreRestarted)
	}
	h.s.onCoreExit()
	waitEvent(t, events, EventCoreFailed)
	if attempts.Load() != 3 {
		t.Fatalf("restart attempts = %d, want 3", attempts.Load())
	}
}

// 停止 during the backoff calls the recovery off; a core that dies while it is
// still starting (not up yet) never starts one.
func TestRecoveryOnlyWhileWanted(t *testing.T) {
	h, _, attempts := recoveryHarness(t, markRestarted)
	h.s.mu.Lock()
	h.s.health.backoff = []time.Duration{time.Hour}
	h.s.mu.Unlock()
	h.s.onCoreExit()
	if st := h.s.Status(); st.RunState != RunRecovering {
		t.Fatalf("state = %s", st.RunState)
	}
	h.s.mu.Lock()
	cancel := h.s.health.recoverCancel
	h.s.mu.Unlock()
	h.s.Stop()
	select {
	case <-cancel:
	default:
		t.Fatal("停止 must call the recovery off")
	}
	h.s.onCoreExit() // stopped: an exit now is nobody's crash
	if st := h.s.Status(); st.RunState != RunStopped || attempts.Load() != 0 {
		t.Fatalf("state=%s attempts=%d", st.RunState, attempts.Load())
	}
}

// A restart keeps the held engine: it gets the new routes and is released; a
// core that came back on the TUN closes it.
func TestAttachCaptureReleasesKeptEngine(t *testing.T) {
	h := newCaptureHarness(t)
	h.startProcessRun(t)
	opts := core.Options{Split: true, SplitWhitelist: true, Process: &core.ProcessCapture{Ports: map[string]int{}}}
	if err := h.s.attachCapture(opts); err != nil {
		t.Fatal(err)
	}
	eng := h.engines[0]
	if len(h.engines) != 1 || len(eng.routes) != 1 || len(eng.hold) != 1 || eng.hold[0] {
		t.Fatalf("kept engine must get routes and be released: engines=%d routes=%d hold=%v", len(h.engines), len(eng.routes), eng.hold)
	}
	opts.Process = nil
	if err := h.s.attachCapture(opts); err != nil || !eng.stopped {
		t.Fatalf("a TUN core must close the kept engine (err=%v stopped=%v)", err, eng.stopped)
	}
}
