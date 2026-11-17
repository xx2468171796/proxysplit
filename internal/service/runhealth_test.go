package service

import (
	"errors"
	"path/filepath"
	"sync"
	"testing"

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
