package main

import (
	_ "embed"

	"github.com/energye/systray"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed build/windows/icon.ico
var trayIcon []byte

// initTray starts the system-tray icon in a background goroutine. A tray failure
// must never take down the app, so it recovers from any panic.
func (a *App) initTray() {
	defer func() { _ = recover() }()
	systray.Run(a.trayReady, func() {})
}

func (a *App) trayReady() {
	if len(trayIcon) > 0 {
		systray.SetIcon(trayIcon)
	}
	systray.SetTitle("ProxySplit")
	systray.SetTooltip("ProxySplit — 应用分流代理")

	mShow := systray.AddMenuItem("显示主界面", "")
	mToggle := systray.AddMenuItem("启动 / 停止代理", "")
	mReset := systray.AddMenuItem("清除与重置…", "清缓存、修网络、恢复默认")
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("退出", "")

	mShow.Click(a.showWindow)
	mReset.Click(func() { // 打开主界面并跳到设置「清除与重置」（frontend use-app-lifecycle）
		a.showWindow()
		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, "open-settings", "reset")
		}
	})
	systray.SetOnClick(func(systray.IMenu) { a.showWindow() }) // left-click the icon
	mToggle.Click(func() {
		if a.svc == nil {
			return
		}
		if a.svc.Status().CoreRunning {
			a.svc.Stop()
		} else {
			_ = a.startService()
		}
	})
	mQuit.Click(func() {
		a.forceQuit = true
		if a.ctx != nil {
			runtime.Quit(a.ctx)
		}
	})
	a.trayUp = true // tray is live — hide-to-tray is now safe
}

// quitTray removes the tray icon on shutdown.
func (a *App) quitTray() { systray.Quit() }
