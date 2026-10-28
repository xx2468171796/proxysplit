package main

import (
	"context"
	_ "embed"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// showWindow brings the main window back to the foreground.
func (a *App) showWindow() {
	if a.ctx == nil {
		return
	}
	runtime.WindowShow(a.ctx)
	runtime.WindowUnminimise(a.ctx)
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
