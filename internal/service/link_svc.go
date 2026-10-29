package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"
)

// LinkStatus is the 概览 / 标题栏 summary of the current route: which node,
// the Google latency through it and the live ping to it. The exit IP comes
// from GetExits (AI page and 概览 share that cache).
type LinkStatus struct {
	Running  bool   `json:"running"`
	NodeID   string `json:"nodeId"`
	NodeName string `json:"nodeName"`
	NodeType string `json:"nodeType"`
	Core     string `json:"core"`     // sing-box | xray (the core carrying this node)
	GoogleMs int    `json:"googleMs"` // 0 = not measured yet, -1 = failed
	PingMs   int    `json:"pingMs"`   // last keep-alive TCP RTT to the node, 0 = none, -1 = failed
	PingP50  int    `json:"pingP50"`
	Conns    int    `json:"conns"`
}

const (
	googleProbeEvery = 10 * time.Second
	googleProbeURL   = "https://www.google.com/generate_204"
)

type googleProbe struct {
	mu   sync.Mutex
	node string
	at   time.Time
	ms   int
	busy bool
}

// LinkStatus reads cheap state only; the Google latency is refreshed in the
// background at most every googleProbeEvery (the caller polls every second).
func (s *Service) LinkStatus() LinkStatus {
	s.mu.Lock()
	node := s.selectedNode()
	port, secret := s.clashPort, s.clashSecret
	conns := s.trafficStats.ActiveConns
	s.mu.Unlock()
	st := LinkStatus{Running: s.coreRunning(), Conns: int(conns)}
	if node == nil {
		return st
	}
	st.NodeID, st.NodeName, st.NodeType = node.ID, node.Name, node.Type
	st.Core = "sing-box"
	if node.Core == "xray" || (node.Core == "" && node.NeedsXray()) {
		st.Core = "xray"
	}
	if !st.Running {
		return st
	}
	for _, h := range s.NodeHealth() {
		if h.Key == node.ID {
			st.PingMs, st.PingP50 = h.LastRttMs, h.P50Ms
		}
	}
	g := &s.google
	g.mu.Lock()
	if g.node != node.ID { // switched node: the old number is about another line
		g.node, g.ms, g.at = node.ID, 0, time.Time{}
	}
	st.GoogleMs = g.ms
	due := !g.busy && time.Since(g.at) >= googleProbeEvery && port > 0
	if due {
		g.busy = true
	}
	g.mu.Unlock()
	if due {
		go func(id string) {
			ms := clashDelay(port, secret, "proxy", googleProbeURL)
			g.mu.Lock()
			if g.node == id {
				g.ms, g.at = ms, time.Now()
			}
			g.busy = false
			g.mu.Unlock()
		}(node.ID)
	}
	return st
}

// clashDelay asks the core to time one HTTP request through outbound tag
// (clash API /proxies/{tag}/delay). Works in every capture mode, because the
// core dials it itself. -1 on failure.
func clashDelay(port int, secret, tag, target string) int {
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	u := fmt.Sprintf("http://127.0.0.1:%d/proxies/%s/delay?timeout=5000&url=%s", port, url.PathEscape(tag), url.QueryEscape(target))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return -1
	}
	if secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return -1
	}
	defer resp.Body.Close()
	var body struct {
		Delay int `json:"delay"`
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&body) != nil || body.Delay <= 0 {
		return -1
	}
	return body.Delay
}
