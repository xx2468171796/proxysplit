package service

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"proxysplit/internal/coreupdate"
)

// Core follow (公司规定：面板发布新的标准内核后，所有装好的客户端自动跟上).
//
// A background loop asks the POWER云 panel for the published core (signed,
// GET /api/client/core) 30 s after start, then every hour, and right after a
// POWER云 login. A newer build is downloaded and verified (coreupdate), then
// applied: if the proxy is running it is restarted on the new core under the
// lifecycle lock (stop + start, the same path as any settings restart); if the
// new core does not come up the previous file is put back and the proxy
// started again, and that version is not installed automatically again for
// coreFailedHold. A stopped proxy just picks up the new file on its next start.
// The manual 更新内核 button runs the same check; only one runs at a time.

const (
	coreFollowFirstDelay = 30 * time.Second
	coreFollowInterval   = time.Hour
	coreFollowRetryBase  = 2 * time.Minute // first retry after a failed round, doubling up to the interval
	coreFailedHold       = 24 * time.Hour  // a version that failed to start is not auto-installed again for this long
)

// errCoreFollowBusy: another check (automatic or the button) is running.
var errCoreFollowBusy = errors.New("正在检查内核更新，请稍候再试")

type coreFollowOutcome int

const (
	coreCurrent   coreFollowOutcome = iota // installed core is the published one (or newer)
	coreSkipped                            // nothing done this round (busy, previous core locked, version on hold)
	coreInstalled                          // new core installed; proxy not running, applies on next start
	coreApplied                            // new core installed and the running proxy restarted on it
	coreFailed                             // check / download / install / restart failed
)

type coreFollowResult struct {
	Outcome coreFollowOutcome
	Version string // installed version after the round
	Err     error
}

// coreFollowDeps are the side effects of one round, injected so the decision
// logic is tested without network, files or a real core.
type coreFollowDeps struct {
	latest    func(ctx context.Context) (coreupdate.Release, error) // signed panel release
	installed func() string                                         // full version of the installed core
	// install downloads, verifies and swaps in r, keeping the previous core for
	// rollback. coreupdate.ErrBackupBusy = a leftover backup is still locked.
	install func(r coreupdate.Release) error
	// apply restarts a running proxy on the new core, rolling back to the kept
	// previous core when that start fails. restarted=false: not running (or
	// not allowed to start), nothing restarted. rolledBack=true: the new core
	// failed to start and the previous one was put back (err says how it went).
	apply       func() (restarted, rolledBack bool, err error)
	clearBackup func() error // drop the kept previous core (best effort)
	log         func(string)
	now         func() time.Time
}

type coreFollower struct {
	deps coreFollowDeps
	busy atomic.Bool

	mu       sync.Mutex
	failures int       // consecutive failed automatic rounds (back-off)
	held     string    // version that failed to start
	heldAt   time.Time // when it failed
}

func newCoreFollower(d coreFollowDeps) *coreFollower {
	if d.log == nil {
		d.log = func(string) {}
	}
	if d.now == nil {
		d.now = time.Now
	}
	return &coreFollower{deps: d}
}

// check runs one round. manual = the 更新内核 button: it ignores the hold on a
// version that failed to start and does not change the automatic back-off.
func (f *coreFollower) check(ctx context.Context, manual bool) coreFollowResult {
	if !f.busy.CompareAndSwap(false, true) {
		return coreFollowResult{Outcome: coreSkipped, Err: errCoreFollowBusy}
	}
	defer f.busy.Store(false)
	res := f.round(ctx, manual)
	if !manual {
		f.mu.Lock()
		if res.Outcome == coreFailed {
			f.failures++
		} else {
			f.failures = 0
		}
		f.mu.Unlock()
	}
	return res
}

func (f *coreFollower) round(ctx context.Context, manual bool) coreFollowResult {
	d := f.deps
	r, err := d.latest(ctx)
	if err != nil {
		return coreFollowResult{Outcome: coreFailed, Version: d.installed(), Err: fmt.Errorf("查询面板内核失败：%w", err)}
	}
	cur := d.installed()
	need, err := coreupdate.NeedsRelease(cur, r.Version)
	if err != nil {
		return coreFollowResult{Outcome: coreFailed, Version: cur, Err: err}
	}
	if !need {
		return coreFollowResult{Outcome: coreCurrent, Version: cur}
	}
	if !manual && f.onHold(r.Version) {
		return coreFollowResult{Outcome: coreSkipped, Version: cur}
	}
	if err := d.install(r); err != nil {
		if errors.Is(err, coreupdate.ErrBackupBusy) && !manual {
			// The previous core is still running from the backup file; try again
			// next round rather than counting it as a failure.
			d.log("[core] 旧内核文件仍被占用，本轮跳过自动更新")
			return coreFollowResult{Outcome: coreSkipped, Version: cur}
		}
		return coreFollowResult{Outcome: coreFailed, Version: cur, Err: err}
	}
	d.log(fmt.Sprintf("[core] 已安装内核 sing-box %s（原 %s）", r.Version, displayVersion(cur)))
	restarted, rolledBack, err := d.apply()
	if rolledBack {
		f.hold(r.Version)
		return coreFollowResult{Outcome: coreFailed, Version: d.installed(), Err: err}
	}
	_ = d.clearBackup() // still locked? cleaned before the next install / at startup
	if err != nil {
		// Not restarted for a reason unrelated to the core (e.g. authorization):
		// the new file stays and applies on the next start.
		d.log("[core] 新内核下次启动生效：" + err.Error())
		return coreFollowResult{Outcome: coreInstalled, Version: r.Version}
	}
	if restarted {
		d.log(fmt.Sprintf("[core] 已切换到新内核 sing-box %s", r.Version))
		return coreFollowResult{Outcome: coreApplied, Version: r.Version}
	}
	d.log(fmt.Sprintf("[core] 新内核 sing-box %s 下次启动生效", r.Version))
	return coreFollowResult{Outcome: coreInstalled, Version: r.Version}
}

func displayVersion(v string) string {
	if v == "" {
		return "未知"
	}
	return v
}

func (f *coreFollower) hold(version string) {
	f.mu.Lock()
	f.held, f.heldAt = version, f.deps.now()
	f.mu.Unlock()
}

func (f *coreFollower) onHold(version string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.held != version {
		return false
	}
	age := f.deps.now().Sub(f.heldAt)
	return age >= 0 && age < coreFailedHold
}

// nextDelay is the wait before the next automatic round: the interval, or an
// exponential back-off after consecutive failures, never above the interval.
func (f *coreFollower) nextDelay(interval time.Duration) time.Duration {
	f.mu.Lock()
	n := f.failures
	f.mu.Unlock()
	if n <= 0 {
		return interval
	}
	d := coreFollowRetryBase
	for i := 1; i < n && d < interval; i++ {
		d *= 2
	}
	if d > interval {
		d = interval
	}
	return d
}

// loop runs automatic rounds until stop closes: the first after first, then
// after nextDelay, and at once when trigger fires. enabled is read every
// round so the setting applies without restarting.
func (f *coreFollower) loop(stop <-chan struct{}, trigger <-chan struct{}, enabled func() bool, first, interval time.Duration) {
	timer := time.NewTimer(first)
	defer timer.Stop()
	for {
		select {
		case <-stop:
			return
		case <-timer.C:
		case <-trigger:
		}
		if enabled() {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
			res := f.check(ctx, false)
			cancel()
			if res.Outcome == coreFailed && res.Err != nil {
				f.deps.log("[core] 自动更新内核失败：" + res.Err.Error())
			}
		}
		timer.Reset(f.nextDelay(interval))
	}
}

// --- Service wiring ---

func (s *Service) coreFollow() *coreFollower {
	s.followOnce.Do(func() {
		s.follower = newCoreFollower(coreFollowDeps{
			latest:      s.latestCore,
			installed:   s.GetCoreVersion,
			install:     s.installCore,
			apply:       s.applyInstalledCore,
			clearBackup: func() error { return coreupdate.ClearBackup(s.binDir) },
			log:         s.log,
		})
		s.followTrigger = make(chan struct{}, 1)
	})
	return s.follower
}

// StartCoreFollow starts the background core-follow loop (once).
func (s *Service) StartCoreFollow() {
	f := s.coreFollow()
	s.followStart.Do(func() {
		go f.loop(nil, s.followTrigger, func() bool { return !s.GetSettings().AutoUpdateCoreOff }, coreFollowFirstDelay, coreFollowInterval)
	})
}

// TriggerCoreFollow asks the loop for a round now (e.g. after a POWER云 login).
func (s *Service) TriggerCoreFollow() {
	s.coreFollow()
	select {
	case s.followTrigger <- struct{}{}:
	default: // one already pending
	}
}

func (s *Service) latestCore(ctx context.Context) (coreupdate.Release, error) {
	pv := s.powervpnClient()
	if pv == nil {
		return coreupdate.Release{}, errors.New("内核更新服务未初始化")
	}
	cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	info, err := pv.Core(cctx, runtime.GOOS, runtime.GOARCH)
	if err != nil {
		return coreupdate.Release{}, err
	}
	return coreupdate.Release{Version: info.FullVersion(), URL: info.URL, URLs: info.URLs, SHA256: info.SHA256}, nil
}

func (s *Service) installCore(r coreupdate.Release) error {
	s.mu.Lock()
	via := s.proxyViaLocked()
	s.mu.Unlock()
	_, err := coreupdate.InstallRelease(s.binDir, s.GetCoreVersion(), r, via)
	return err
}

// applyInstalledCore restarts a running proxy so a just-installed core takes
// effect, under the lifecycle lock (no Start/Stop can interleave). A start
// that is refused by the authorization gate is not attempted (the core would
// not be at fault); the new file then applies on the next start.
func (s *Service) applyInstalledCore() (restarted, rolledBack bool, err error) {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	if !s.core.Running() {
		return false, false, nil
	}
	s.mu.Lock()
	guard := s.startGuard
	s.mu.Unlock()
	if guard != nil {
		if err := guard(); err != nil {
			return false, false, fmt.Errorf("授权校验未通过，暂不重启：%w", err)
		}
	}
	rolledBack, err = restartWithRollback(s.stopLocked, s.startLocked, func() error { return coreupdate.Rollback(s.binDir) })
	return true, rolledBack, err
}

// restartWithRollback stops the core and starts it on the new file; if that
// fails it puts the previous core back and starts again. rolledBack reports
// that the new core failed (err then says whether the old one came back).
func restartWithRollback(stop func(), start func() error, rollback func() error) (rolledBack bool, err error) {
	stop()
	startErr := start()
	if startErr == nil {
		return false, nil
	}
	stop() // clean up whatever the failed start left behind
	if err := rollback(); err != nil {
		return true, fmt.Errorf("新内核启动失败（%v），换回旧内核也失败：%w", startErr, err)
	}
	if err := start(); err != nil {
		return true, fmt.Errorf("新内核启动失败（%v），换回旧内核后仍未能启动：%w", startErr, err)
	}
	return true, fmt.Errorf("新内核启动失败，已换回旧内核并恢复运行：%w", startErr)
}

// UpdateCore is the manual 更新内核 button: the same round as the automatic
// follow (shared single-flight). Returns the installed version or "ERR:<msg>".
func (s *Service) UpdateCore() string {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	res := s.coreFollow().check(ctx, true)
	if res.Err != nil {
		s.log("[core] update failed: " + res.Err.Error())
		return "ERR:" + res.Err.Error()
	}
	return res.Version
}
