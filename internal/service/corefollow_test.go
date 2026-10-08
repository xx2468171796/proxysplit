package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"proxysplit/internal/coreupdate"
)

// fakeCore is an in-memory core install for the follow decision logic.
type fakeCore struct {
	mu         sync.Mutex
	installed  string
	offered    string
	latestErr  error
	installErr error
	running    bool
	startFails bool // the new core fails to start (rollback)
	backup     string
	installs   int
	applies    int
	cleared    int
	block      chan struct{} // when set, install waits on it
}

func (c *fakeCore) deps(now *time.Time) coreFollowDeps {
	return coreFollowDeps{
		latest: func(context.Context) (coreupdate.Release, error) {
			c.mu.Lock()
			defer c.mu.Unlock()
			if c.latestErr != nil {
				return coreupdate.Release{}, c.latestErr
			}
			return coreupdate.Release{Version: c.offered, URL: "http://panel/core.exe", SHA256: strings.Repeat("a", 64)}, nil
		},
		installed: func() string {
			c.mu.Lock()
			defer c.mu.Unlock()
			return c.installed
		},
		install: func(r coreupdate.Release) error {
			c.mu.Lock()
			block := c.block
			c.installs++
			c.mu.Unlock()
			if block != nil {
				<-block
			}
			c.mu.Lock()
			defer c.mu.Unlock()
			if c.installErr != nil {
				return c.installErr
			}
			c.backup, c.installed = c.installed, r.Version
			return nil
		},
		apply: func() (bool, bool, error) {
			c.mu.Lock()
			defer c.mu.Unlock()
			c.applies++
			if !c.running {
				return false, false, nil
			}
			// The real restart sequence, with a start that fails on the new core.
			first := true
			rb, err := restartWithRollback(func() {}, func() error {
				if first {
					first = false
					if c.startFails {
						return errors.New("bad core")
					}
				}
				return nil
			}, func() error {
				c.installed, c.backup = c.backup, ""
				return nil
			})
			return true, rb, err
		},
		clearBackup: func() error {
			c.mu.Lock()
			c.cleared++
			c.backup = ""
			c.mu.Unlock()
			return nil
		},
		now: func() time.Time { return *now },
	}
}

func newFake(installed, offered string) (*fakeCore, *coreFollower, *time.Time) {
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	c := &fakeCore{installed: installed, offered: offered, running: true}
	return c, newCoreFollower(c.deps(&now)), &now
}

func TestCoreFollowSkipsWhenCurrentOrNewer(t *testing.T) {
	for _, tc := range []struct{ installed, offered string }{
		{"1.14.2-relayops.15", "1.14.2-relayops.15"},
		{"1.14.2-relayops.16", "1.14.2-relayops.15"}, // never downgrade
	} {
		c, f, _ := newFake(tc.installed, tc.offered)
		res := f.check(context.Background(), false)
		if res.Outcome != coreCurrent || res.Err != nil || res.Version != tc.installed {
			t.Fatalf("%s vs %s: got %+v", tc.installed, tc.offered, res)
		}
		if c.installs != 0 || c.applies != 0 {
			t.Fatalf("%s vs %s: installed anyway", tc.installed, tc.offered)
		}
	}
}

func TestCoreFollowInstallsAndRestartsWhenNewer(t *testing.T) {
	c, f, _ := newFake("1.14.2-relayops.9", "1.14.2-relayops.15")
	res := f.check(context.Background(), false)
	if res.Outcome != coreApplied || res.Err != nil || res.Version != "1.14.2-relayops.15" {
		t.Fatalf("got %+v", res)
	}
	if c.installs != 1 || c.applies != 1 || c.cleared != 1 || c.backup != "" {
		t.Fatalf("installs=%d applies=%d cleared=%d backup=%q", c.installs, c.applies, c.cleared, c.backup)
	}
	// Next round: nothing to do.
	if res := f.check(context.Background(), false); res.Outcome != coreCurrent || c.installs != 1 {
		t.Fatalf("second round: %+v installs=%d", res, c.installs)
	}
}

func TestCoreFollowStoppedProxyJustInstalls(t *testing.T) {
	c, f, _ := newFake("1.14.2-relayops.9", "1.14.2-relayops.15")
	c.running = false
	res := f.check(context.Background(), false)
	if res.Outcome != coreInstalled || res.Err != nil || c.installed != "1.14.2-relayops.15" || c.cleared != 1 {
		t.Fatalf("got %+v installed=%s cleared=%d", res, c.installed, c.cleared)
	}
}

func TestCoreFollowBackoffOnFailure(t *testing.T) {
	c, f, _ := newFake("1.14.2-relayops.9", "1.14.2-relayops.15")
	c.latestErr = errors.New("panel unreachable")
	want := []time.Duration{2 * time.Minute, 4 * time.Minute, 8 * time.Minute, 16 * time.Minute, 32 * time.Minute, time.Hour, time.Hour}
	for i, w := range want {
		if res := f.check(context.Background(), false); res.Outcome != coreFailed || res.Err == nil {
			t.Fatalf("round %d: %+v", i, res)
		}
		if got := f.nextDelay(coreFollowInterval); got != w {
			t.Fatalf("after %d failures delay = %v, want %v", i+1, got, w)
		}
	}
	// A manual click neither resets nor grows the automatic back-off.
	f.check(context.Background(), true)
	if got := f.nextDelay(coreFollowInterval); got != time.Hour {
		t.Fatalf("manual changed back-off: %v", got)
	}
	c.latestErr = nil
	if res := f.check(context.Background(), false); res.Outcome != coreApplied {
		t.Fatalf("recovery: %+v", res)
	}
	if got := f.nextDelay(coreFollowInterval); got != coreFollowInterval {
		t.Fatalf("success did not reset back-off: %v", got)
	}
	// Install failures back off too.
	c.offered, c.installErr = "1.14.2-relayops.16", errors.New("sha mismatch")
	if res := f.check(context.Background(), false); res.Outcome != coreFailed || f.nextDelay(coreFollowInterval) != coreFollowRetryBase {
		t.Fatalf("install failure: %+v", res)
	}
}

func TestCoreFollowLockedBackupSkipsQuietly(t *testing.T) {
	c, f, _ := newFake("1.14.2-relayops.9", "1.14.2-relayops.15")
	c.installErr = fmt.Errorf("%w: access denied", coreupdate.ErrBackupBusy)
	res := f.check(context.Background(), false)
	if res.Outcome != coreSkipped || res.Err != nil || f.nextDelay(coreFollowInterval) != coreFollowInterval {
		t.Fatalf("got %+v delay %v", res, f.nextDelay(coreFollowInterval))
	}
	// The button reports it.
	if res := f.check(context.Background(), true); res.Err == nil {
		t.Fatal("manual check hid the locked backup")
	}
}

func TestCoreFollowNoConcurrentRuns(t *testing.T) {
	c, f, _ := newFake("1.14.2-relayops.9", "1.14.2-relayops.15")
	c.block = make(chan struct{})
	done := make(chan coreFollowResult)
	go func() { done <- f.check(context.Background(), false) }()
	waitFor(t, func() bool {
		c.mu.Lock()
		defer c.mu.Unlock()
		return c.installs == 1
	})
	var busy atomic.Int32
	var wg sync.WaitGroup
	for _, manual := range []bool{false, true, true} {
		wg.Add(1)
		go func(manual bool) {
			defer wg.Done()
			if res := f.check(context.Background(), manual); res.Outcome == coreSkipped && errors.Is(res.Err, errCoreFollowBusy) {
				busy.Add(1)
			}
		}(manual)
	}
	wg.Wait()
	close(c.block)
	if res := <-done; res.Outcome != coreApplied {
		t.Fatalf("first run: %+v", res)
	}
	if busy.Load() != 3 || c.installs != 1 {
		t.Fatalf("busy=%d installs=%d", busy.Load(), c.installs)
	}
}

func TestCoreFollowRollsBackAndHoldsFailedVersion(t *testing.T) {
	c, f, _ := newFake("1.14.2-relayops.9", "1.14.2-relayops.15")
	c.startFails = true
	res := f.check(context.Background(), false)
	if res.Outcome != coreFailed || res.Err == nil || !strings.Contains(res.Err.Error(), "已换回旧内核") {
		t.Fatalf("got %+v", res)
	}
	if c.installed != "1.14.2-relayops.9" || res.Version != "1.14.2-relayops.9" {
		t.Fatalf("not rolled back: installed=%s result=%s", c.installed, res.Version)
	}
	// The failed version is not auto-installed again within the hold ...
	if res := f.check(context.Background(), false); res.Outcome != coreSkipped || c.installs != 1 {
		t.Fatalf("held version retried: %+v installs=%d", res, c.installs)
	}
	// ... but a newer one is.
	c.offered = "1.14.2-relayops.16"
	c.startFails = false
	if res := f.check(context.Background(), false); res.Outcome != coreApplied || c.installs != 2 {
		t.Fatalf("newer after hold: %+v", res)
	}

	// A manual click ignores the hold.
	c2, f2, _ := newFake("1.14.2-relayops.9", "1.14.2-relayops.15")
	c2.startFails = true
	f2.check(context.Background(), false)
	c2.startFails = false
	if res := f2.check(context.Background(), true); res.Outcome != coreApplied {
		t.Fatalf("manual during hold: %+v", res)
	}

	// After the hold the automatic loop tries the same version again.
	c3, f3, now3 := newFake("1.14.2-relayops.9", "1.14.2-relayops.15")
	c3.startFails = true
	f3.check(context.Background(), false)
	*now3 = now3.Add(coreFailedHold + time.Minute)
	c3.startFails = false
	if res := f3.check(context.Background(), false); res.Outcome != coreApplied {
		t.Fatalf("after hold: %+v", res)
	}
}

func TestRestartWithRollback(t *testing.T) {
	var calls []string
	stop := func() { calls = append(calls, "stop") }
	rollback := func() error { calls = append(calls, "rollback"); return nil }
	starts := func(results ...error) func() error {
		return func() error {
			calls = append(calls, "start")
			r := results[0]
			results = results[1:]
			return r
		}
	}

	rb, err := restartWithRollback(stop, starts(nil), rollback)
	if rb || err != nil || strings.Join(calls, ",") != "stop,start" {
		t.Fatalf("ok path: %v %v %v", rb, err, calls)
	}

	calls = nil
	rb, err = restartWithRollback(stop, starts(errors.New("new core crashed"), nil), rollback)
	if !rb || err == nil || !strings.Contains(err.Error(), "已换回旧内核并恢复运行") ||
		strings.Join(calls, ",") != "stop,start,stop,rollback,start" {
		t.Fatalf("rollback path: %v %v %v", rb, err, calls)
	}

	calls = nil
	rb, err = restartWithRollback(stop, starts(errors.New("new"), errors.New("old")), rollback)
	if !rb || err == nil || !strings.Contains(err.Error(), "仍未能启动") {
		t.Fatalf("both fail: %v %v", rb, err)
	}

	calls = nil
	rb, err = restartWithRollback(stop, starts(errors.New("new")), func() error { return errors.New("locked") })
	if !rb || err == nil || !strings.Contains(err.Error(), "换回旧内核也失败") || strings.Join(calls, ",") != "stop,start,stop" {
		t.Fatalf("rollback fails: %v %v %v", rb, err, calls)
	}
}

func TestCoreFollowLoopTriggerAndSetting(t *testing.T) {
	_, f, _ := newFake("1.14.2-relayops.9", "1.14.2-relayops.9")
	var rounds atomic.Int32
	f.deps.latest = func(context.Context) (coreupdate.Release, error) {
		rounds.Add(1)
		return coreupdate.Release{Version: "1.14.2-relayops.9"}, nil
	}
	var on atomic.Bool
	on.Store(true)
	stop := make(chan struct{})
	trigger := make(chan struct{}, 1)
	exited := make(chan struct{})
	go func() { f.loop(stop, trigger, on.Load, time.Hour, time.Hour); close(exited) }()

	trigger <- struct{}{}
	waitFor(t, func() bool { return rounds.Load() == 1 })
	on.Store(false)
	trigger <- struct{}{}
	time.Sleep(50 * time.Millisecond)
	if rounds.Load() != 1 {
		t.Fatal("ran while switched off")
	}
	on.Store(true)
	trigger <- struct{}{}
	waitFor(t, func() bool { return rounds.Load() == 2 })
	close(stop)
	<-exited
}

func TestCoreFollowLoopFirstDelay(t *testing.T) {
	_, f, _ := newFake("1.14.2-relayops.9", "1.14.2-relayops.9")
	var rounds atomic.Int32
	f.deps.latest = func(context.Context) (coreupdate.Release, error) {
		rounds.Add(1)
		return coreupdate.Release{Version: "1.14.2-relayops.9"}, nil
	}
	stop := make(chan struct{})
	defer close(stop)
	go f.loop(stop, nil, func() bool { return true }, 10*time.Millisecond, 20*time.Millisecond)
	waitFor(t, func() bool { return rounds.Load() >= 3 }) // first + periodic rounds
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("timed out")
		}
		time.Sleep(time.Millisecond)
	}
}
