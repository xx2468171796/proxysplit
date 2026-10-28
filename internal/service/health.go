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

// healthLoop periodically probes each line's node so the UI can show live
// reachability. A direct TCP connect measures whether the node server is up.
func (s *Service) healthLoop() {
	s.refreshHealth()
	t := time.NewTicker(10 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-s.quit:
			return
		case <-t.C:
			s.refreshHealth()
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
