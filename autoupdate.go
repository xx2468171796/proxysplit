package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"proxysplit/internal/shortcut"
)

// Automatic updates: the client installs new signed releases by itself, no
// prompt. A release marked mandatory (强制更新) installs even when the user has
// turned automatic updates off. If the proxy was running it is started again
// after the new version launches, so an update never silently drops the proxy.
//
// If an install fails (the install helper restores and relaunches the old
// version, e.g. because antivirus quarantined the new exe), that release is not
// installed automatically again for failedUpdateBackoff, so a broken release
// cannot make the client quit and come back every few minutes. The manual
// update button keeps working.

const (
	autoUpdateFirstDelay = 20 * time.Second
	autoUpdateInterval   = 6 * time.Hour
	resumeFileName       = "resume-after-update.json"
	resumeMaxAge         = 10 * time.Minute
	failedUpdateFileName = "update-failed.json"
	failedUpdateBackoff  = 24 * time.Hour
)

type resumeState struct {
	ProxyRunning bool      `json:"proxyRunning"`
	From         string    `json:"from"`
	To           string    `json:"to,omitempty"`
	At           time.Time `json:"at"`
}

type failedUpdate struct {
	Version string    `json:"version"`
	At      time.Time `json:"at"`
}

func resumePath() string       { return filepath.Join(dataDir(), resumeFileName) }
func failedUpdatePath() string { return filepath.Join(dataDir(), failedUpdateFileName) }

// autoUpdateLoop checks shortly after launch and then periodically.
func (a *App) autoUpdateLoop() {
	<-a.ready
	if a.initErr != nil || a.upd == nil || !a.upd.Enabled() {
		return
	}
	time.Sleep(autoUpdateFirstDelay)
	for {
		a.tryAutoUpdate()
		time.Sleep(autoUpdateInterval)
	}
}

func (a *App) tryAutoUpdate() {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	st := a.upd.Check(ctx)
	cancel()
	if !st.Available || st.Release == nil {
		return
	}
	if !st.Release.Mandatory && !a.svc.GetSettings().AutoUpdateApp {
		return
	}
	if data, err := os.ReadFile(failedUpdatePath()); err == nil && recentlyFailed(data, st.Release.Version, time.Now()) {
		runtime.LogWarning(a.ctx, "auto update: v"+st.Release.Version+" failed to install recently, waiting for a manual update")
		return
	}
	runtime.LogInfo(a.ctx, "auto update: installing v"+st.Release.Version)
	runtime.EventsEmit(a.ctx, "app-update-auto", st)
	if msg := a.InstallAppUpdate(*st.Release); msg != "" {
		runtime.LogError(a.ctx, "auto update failed: "+msg)
		runtime.EventsEmit(a.ctx, "app-update-failed", msg)
	}
}

// recentlyFailed reports whether version failed to install within the backoff.
func recentlyFailed(data []byte, version string, now time.Time) bool {
	var f failedUpdate
	if json.Unmarshal(data, &f) != nil || f.Version != version {
		return false
	}
	age := now.Sub(f.At)
	return age >= 0 && age < failedUpdateBackoff
}

// rememberProxyForUpdate records, right before the app quits to install
// version to, whether the proxy is running, so the new version can bring it
// back (and the old one can tell that the install failed).
func (a *App) rememberProxyForUpdate(to string) {
	if a.svc == nil {
		return
	}
	data, _ := json.Marshal(resumeState{ProxyRunning: a.svc.Status().CoreRunning, From: appVersion, To: to, At: time.Now()})
	_ = os.WriteFile(resumePath(), data, 0o600)
}

// resumeAfterUpdate runs once at startup. It restarts the proxy if it was
// running when the previous process quit to install an update, and records a
// failed install when the version that comes back up is the one that quit.
// The marker is single-use and short-lived.
func (a *App) resumeAfterUpdate() {
	data, err := os.ReadFile(resumePath())
	if err != nil {
		return
	}
	_ = os.Remove(resumePath())
	st, fresh := parseResume(data, time.Now())
	if !fresh {
		return
	}
	if installFailed(st, appVersion) {
		f, _ := json.Marshal(failedUpdate{Version: st.To, At: time.Now()})
		_ = os.WriteFile(failedUpdatePath(), f, 0o600)
		runtime.LogError(a.ctx, "update to v"+st.To+" did not start; still running v"+appVersion)
	}
	if !st.ProxyRunning {
		return
	}
	if err := a.startService(); err != nil {
		runtime.LogError(a.ctx, "resume proxy after update: "+err.Error())
		return
	}
	runtime.LogInfo(a.ctx, "proxy resumed after update (was v"+st.From+")")
}

// parseResume decodes a resume marker and reports whether it is fresh; a stale
// one from an update that never completed must not start the proxy days later.
func parseResume(data []byte, now time.Time) (resumeState, bool) {
	var st resumeState
	if json.Unmarshal(data, &st) != nil {
		return st, false
	}
	age := now.Sub(st.At)
	return st, age >= 0 && age <= resumeMaxAge
}

// installFailed: the process that wrote the marker quit to install st.To, yet
// the same version started again (the helper rolled the install back).
func installFailed(st resumeState, running string) bool {
	return st.To != "" && st.To != running && st.From == running
}

// ensureDesktopShortcut keeps a desktop shortcut to this executable on every
// launch (recreated if the user deleted it, corrected if the exe moved).
// Development builds skip it so they don't take over the real shortcut.
func (a *App) ensureDesktopShortcut() {
	if appVersion == "dev" {
		return
	}
	exe, err := os.Executable()
	if err != nil {
		return
	}
	if err := shortcut.EnsureDesktop("ProxySplit", exe); err != nil {
		runtime.LogWarning(a.ctx, "desktop shortcut: "+err.Error())
	}
}
