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

const (
	autoUpdateFirstDelay = 20 * time.Second
	autoUpdateInterval   = 6 * time.Hour
	resumeFileName       = "resume-after-update.json"
	resumeMaxAge         = 10 * time.Minute
)

type resumeState struct {
	ProxyRunning bool      `json:"proxyRunning"`
	From         string    `json:"from"`
	At           time.Time `json:"at"`
}

func resumePath() string { return filepath.Join(dataDir(), resumeFileName) }

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
	runtime.LogInfo(a.ctx, "auto update: installing v"+st.Release.Version)
	runtime.EventsEmit(a.ctx, "app-update-auto", st)
	if msg := a.InstallAppUpdate(*st.Release); msg != "" {
		runtime.LogError(a.ctx, "auto update failed: "+msg)
		runtime.EventsEmit(a.ctx, "app-update-failed", msg)
	}
}

// rememberProxyForUpdate records whether the proxy is running right before the
// app quits for an update, so the new version can bring it back.
func (a *App) rememberProxyForUpdate() {
	if a.svc == nil {
		return
	}
	data, _ := json.Marshal(resumeState{ProxyRunning: a.svc.Status().CoreRunning, From: appVersion, At: time.Now()})
	_ = os.WriteFile(resumePath(), data, 0o600)
}

// resumeAfterUpdate restarts the proxy once if it was running when the previous
// version quit to install this one. The marker is single-use and short-lived.
func (a *App) resumeAfterUpdate() {
	data, err := os.ReadFile(resumePath())
	if err != nil {
		return
	}
	_ = os.Remove(resumePath())
	st, ok := shouldResume(data, time.Now())
	if !ok {
		return
	}
	if err := a.startService(); err != nil {
		runtime.LogError(a.ctx, "resume proxy after update: "+err.Error())
		return
	}
	runtime.LogInfo(a.ctx, "proxy resumed after updating from v"+st.From)
}

// shouldResume reports whether a resume marker asks to restart the proxy: only
// when it was running, and only for a fresh marker (a stale one from an update
// that never completed must not start the proxy days later).
func shouldResume(data []byte, now time.Time) (resumeState, bool) {
	var st resumeState
	if json.Unmarshal(data, &st) != nil || !st.ProxyRunning {
		return st, false
	}
	age := now.Sub(st.At)
	return st, age >= 0 && age <= resumeMaxAge
}

// ensureDesktopShortcut keeps a desktop shortcut to this executable on every
// launch (recreated if the user deleted it, corrected if the exe moved).
func (a *App) ensureDesktopShortcut() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	if err := shortcut.EnsureDesktop("ProxySplit", exe); err != nil {
		runtime.LogWarning(a.ctx, "desktop shortcut: "+err.Error())
	}
}
