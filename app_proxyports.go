package main

import "proxysplit/internal/service"

// 端口代理（指纹浏览器 / 局域网客户端）：每个端口独立内核进程，可同时开多个。

// GetProxyPorts lists every proxy port with its live state and clients.
func (a *App) GetProxyPorts() []service.ProxyPortStatus { return a.svc.ListProxyPorts() }

// SaveProxyPort adds (empty id) or updates a port; "" on success.
func (a *App) SaveProxyPort(p service.ProxyPort) string {
	_, err := a.svc.SaveProxyPort(p)
	return errStr(err)
}

// DeleteProxyPort stops and removes a port.
func (a *App) DeleteProxyPort(id string) { a.svc.DeleteProxyPort(id) }

// SetProxyPortEnabled starts / stops one port.
func (a *App) SetProxyPortEnabled(id string, on bool) string {
	return errStr(a.svc.SetProxyPortEnabled(id, on))
}

// SetProxyPortMode switches one port between rule / global / direct live.
func (a *App) SetProxyPortMode(id, mode string) string {
	return errStr(a.svc.SetProxyPortMode(id, mode))
}

// GetProxyPortDetail returns connections, access log and core log of a port
// (client = source IP to narrow to one client, "" = all).
func (a *App) GetProxyPortDetail(id, client string) service.PortDetail {
	return a.svc.ProxyPortDetail(id, client)
}
