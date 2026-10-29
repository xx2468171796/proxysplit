package main

import "proxysplit/internal/service"

// GetLinkStatus is the 标题栏 / 概览 route summary (node, Google latency, live ping).
func (a *App) GetLinkStatus() service.LinkStatus { return a.svc.LinkStatus() }
