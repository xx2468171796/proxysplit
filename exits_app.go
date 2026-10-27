package main

import (
	"context"
	"time"

	"proxysplit/internal/service"
)

// GetExits is the AI page's live exits: this PC, the proxy, the AI line
// (internal/service/exits.go). The page polls it every 3 seconds.
func (a *App) GetExits() service.ExitsReport {
	<-a.ready
	if a.svc == nil {
		return service.ExitsReport{}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	return a.svc.Exits(ctx)
}
