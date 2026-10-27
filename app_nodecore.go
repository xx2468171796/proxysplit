package main

import (
	"time"

	"proxysplit/internal/telemetry"
)

// SetNodeCore sets which core carries a node: "" / "auto" (自动), "sing-box"
// or "xray". Returns "" or a Chinese error for the UI; the core restarts when
// the node is in use.
func (a *App) SetNodeCore(id, core string) string {
	start := time.Now()
	ch, err := a.svc.SetNodeCore(id, core)
	msg := ""
	if err != nil {
		msg = err.Error()
	}
	return tmText(telemetry.NodeCoreChange, start, map[string]any{
		"nodeType": ch.NodeType, "transport": ch.Transport, "from": ch.From, "to": ch.To, "choice": core,
	}, msg)
}
