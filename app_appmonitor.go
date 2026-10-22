package main

import (
	"proxysplit/internal/appid"
	"proxysplit/internal/service"
)

// 应用库（内置模拟器等 + 自定义）与逐应用监测的前端绑定。

// GetAppCatalog returns built-in and custom applications (一个应用 = 多个进程).
func (a *App) GetAppCatalog() []appid.App { return a.svc.AppCatalog() }

// SetCustomApps saves the user's own applications.
func (a *App) SetCustomApps(apps []appid.App) string { return a.svc.SetCustomApps(apps) }

// GetAppStats returns per-process monitoring summaries for the given names.
func (a *App) GetAppStats(names []string) []appid.Stat { return a.svc.AppStats(names) }

// GetAppMonitorDetail returns one process's stats, access log and related core errors.
func (a *App) GetAppMonitorDetail(process string) service.AppDetail {
	return a.svc.AppMonitorDetail(process)
}

// ResetAppMonitor clears one process's statistics.
func (a *App) ResetAppMonitor(process string) { a.svc.ResetAppMonitor(process) }

// AppRouteTest sends a real request as the given program and reports its route.
func (a *App) AppRouteTest(process, url string) service.RouteTestResult {
	return a.svc.RouteTest(process, url)
}
