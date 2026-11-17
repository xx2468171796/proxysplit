package service

import (
	"time"

	"proxysplit/internal/latency"
	"proxysplit/internal/nodes"
)

// LineHealth is one line's live reachability for the status panel.
type LineHealth struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Node    string `json:"node"`    // node display name, or 直连 / 拦截
	Latency int    `json:"latency"` // ms; 0 = direct, -1 = unreachable / no node
	OK      bool   `json:"ok"`
}

// Health is the real-time engine + line status the UI polls and displays.
type Health struct {
	Running      bool         `json:"running"`
	Capturing    bool         `json:"capturing"`    // sing-box TUN is running
	CapturedPkts int64        `json:"capturedPkts"` // retained for frontend schema compatibility
	Warning      string       `json:"warning"`      // prominent banner text ("" = none)
	Lines        []LineHealth `json:"lines"`
}

// Health returns the current engine capture state + cached per-line reachability.
func (s *Service) Health() Health {
	s.mu.Lock()
	running := s.core.Running()
	s.mu.Unlock()

	h := Health{Running: running}
	if running {
		// sing-box TUN captures at the virtual adapter in both 应用分流
		// (process_name routing) and 整机全局 modes.
		h.Capturing = true
	}
	if v, ok := s.healthCache.Load().([]LineHealth); ok {
		h.Lines = v
	}
	return h
}

// Background polling follows demand (pollgate below): nothing is measured for
// a stopped proxy, and little while no window is there to show it. They used
// to run flat out for the life of the process — a TCP dial to every node
// server every 10 s and a full /connections fetch every second, in the tray,
// proxy off.
const (
	healthEveryVisible     = 10 * time.Second
	healthEveryHidden      = 2 * time.Minute
	appMonitorEveryVisible = time.Second
	appMonitorEveryHidden  = 5 * time.Second
)

// healthEvery is the line-reachability cadence; 0 = paused.
func healthEvery(running, visible bool) time.Duration {
	switch {
	case !running:
		return 0
	case visible:
		return healthEveryVisible
	}
	return healthEveryHidden
}

// appMonitorEvery is the per-app connection poll cadence; 0 = paused.
func appMonitorEvery(running, visible bool) time.Duration {
	switch {
	case !running:
		return 0
	case visible:
		return appMonitorEveryVisible
	}
	return appMonitorEveryHidden
}

// pollGate decides, tick by tick, whether a background poll is due.
type pollGate struct {
	last       time.Time
	wasRunning bool
}

// due reports whether to poll now: at the cadence every (0 = paused), and at
// once when the proxy has just started or wake is set (the window came back).
func (g *pollGate) due(now time.Time, every time.Duration, running, wake bool) bool {
	started := running && !g.wasRunning
	g.wasRunning = running
	if every == 0 || (!started && !wake && now.Sub(g.last) < every) {
		return false
	}
	g.last = now
	return true
}

// SetUIVisible tells the service whether a window is showing its data. Hidden
// (tray, minimised) slows the background polls down; showing it again
// refreshes at once. Until it is called the UI counts as visible.
func (s *Service) SetUIVisible(visible bool) {
	if s.uiHidden.Swap(!visible) && visible {
		s.uiWake.Store(true)
	}
}

// UIVisible reports the last SetUIVisible value (true before any call).
func (s *Service) UIVisible() bool { return !s.uiHidden.Load() }

// healthLoop probes each line's node while the proxy runs so the UI can show
// live reachability. A direct TCP connect measures whether the node server is up.
func (s *Service) healthLoop() {
	s.refreshHealth() // one pass at launch so the panel is not empty
	gate := pollGate{last: time.Now()}
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		select {
		case <-s.quit:
			return
		case now := <-t.C:
			running, visible := s.core.Running(), s.UIVisible()
			if gate.due(now, healthEvery(running, visible), running, s.uiWake.Swap(false)) {
				s.refreshHealth()
			}
		}
	}
}

func (s *Service) refreshHealth() {
	s.mu.Lock()
	lines := s.allLinesLocked()
	selected := s.selectedNode()
	allNodes := append([]*nodes.Node(nil), s.cfg.Nodes...)
	s.mu.Unlock()

	nodeLat := map[string]int{} // node id -> latency, deduped within this pass
	out := make([]LineHealth, 0, len(lines))
	for i := range lines {
		l := lines[i]
		lh := LineHealth{ID: l.ID, Name: l.Name}
		switch l.Node {
		case LineDirect:
			lh.Node, lh.OK = "直连", true
		case LineBlock:
			lh.Node, lh.OK = "拦截", true
		default:
			node, err := resolveLineNode(&l, selected, allNodes)
			if err != nil || node == nil {
				lh.Node, lh.Latency = "未选节点", -1
			} else {
				lh.Node = node.Name
				lat, done := nodeLat[node.ID]
				if !done {
					snap := *node
					lat = latency.Measure(s.pinned(&snap), "", 4*time.Second).TCPLatency
					nodeLat[node.ID] = lat
				}
				lh.Latency, lh.OK = lat, lat >= 0
			}
		}
		out = append(out, lh)
	}
	s.healthCache.Store(out)
}
