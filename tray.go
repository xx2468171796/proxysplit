package main

import (
	"context"
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

// showWindow brings the main window back to the foreground.
func (a *App) showWindow() {
	if a.ctx == nil {
		return
	}
	runtime.WindowShow(a.ctx)
	runtime.WindowUnminimise(a.ctx)
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

// beforeClose hides the window to the tray instead of quitting when 关闭到托盘 is
// enabled. Returning true prevents the window from closing.
func (a *App) beforeClose(ctx context.Context) bool {
	if a.forceQuit || a.svc == nil {
		return false
	}
	// Never trap a user who can't use the app yet (not signed in / no valid
	// membership) in the tray: on the login/购买 gate, closing the window quits.
	if a.lic == nil || !a.lic.Status().Authenticated {
		return false
	}
	// Only hide to the tray if the tray icon actually came up — otherwise the
	// window would vanish with no way to bring it back.
	if a.trayUp && a.svc.GetSettings().TrayClose {
		runtime.WindowHide(ctx)
		return true
	}
	return false
}
