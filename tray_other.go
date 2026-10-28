//go:build !windows

package main

// No tray icon on macOS yet: energye/systray needs the main-thread run loop
// that Wails owns. trayUp stays false, so closing the window quits (which
// stops the core and clears the system proxy).
func (a *App) initTray() {}

func (a *App) quitTray() {}
