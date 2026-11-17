package service

import (
	"testing"
	"time"
)

// Nothing is measured for a stopped proxy, and less while no window shows it.
func TestBackgroundPollCadence(t *testing.T) {
	if healthEvery(false, true) != 0 || healthEvery(false, false) != 0 || appMonitorEvery(false, true) != 0 {
		t.Fatal("a stopped proxy must pause the background polls")
	}
	if healthEvery(true, true) != healthEveryVisible || healthEvery(true, false) <= healthEveryVisible {
		t.Fatal("line health: normal cadence when visible, slower when hidden")
	}
	if appMonitorEvery(true, true) != appMonitorEveryVisible || appMonitorEvery(true, false) <= appMonitorEveryVisible {
		t.Fatal("app monitor: normal cadence when visible, slower when hidden")
	}
}

func TestPollGate(t *testing.T) {
	start := time.Unix(1_700_000_000, 0)
	g := pollGate{last: start}
	at := func(d time.Duration) time.Time { return start.Add(d) }

	if g.due(at(time.Hour), 0, false, false) {
		t.Fatal("paused: never due")
	}
	if g.due(at(time.Hour), 0, false, true) {
		t.Fatal("paused: not even when the window comes back")
	}
	if !g.due(at(time.Hour+time.Second), healthEveryVisible, true, false) {
		t.Fatal("the proxy just started: poll at once")
	}
	if g.due(at(time.Hour+5*time.Second), healthEveryVisible, true, false) {
		t.Fatal("not due before the cadence")
	}
	if !g.due(at(time.Hour+11*time.Second), healthEveryVisible, true, false) {
		t.Fatal("due after the cadence")
	}
	if g.due(at(time.Hour+70*time.Second), healthEveryHidden, true, false) {
		t.Fatal("hidden: the slow cadence applies")
	}
	if !g.due(at(time.Hour+71*time.Second), healthEveryHidden, true, true) {
		t.Fatal("the window came back: refresh at once")
	}
}

func TestSetUIVisible(t *testing.T) {
	s := &Service{}
	if !s.UIVisible() {
		t.Fatal("visible until told otherwise (the app may not wire it)")
	}
	s.SetUIVisible(false)
	if s.UIVisible() || s.uiWake.Load() {
		t.Fatal("hiding must not wake anything")
	}
	s.SetUIVisible(true)
	if !s.UIVisible() || !s.uiWake.Load() {
		t.Fatal("showing the window must ask for an immediate refresh")
	}
}
