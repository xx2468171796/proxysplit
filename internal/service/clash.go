package service

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

// clashModes are the runtime routing modes exposed via sing-box's clash_api.
// "rule" honours the per-line/route rules, "global" forces everything through
// the node, "direct" forces everything direct — switchable without a restart.
var clashModes = map[string]bool{"rule": true, "global": true, "direct": true}

// genSecret returns a random bearer token for the clash_api controller.
func genSecret() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "proxysplit"
	}
	return hex.EncodeToString(b)
}

// GetClashMode returns the current runtime mode (rule|global|direct).
func (s *Service) GetClashMode() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.clashMode == "" {
		return "rule"
	}
	return s.clashMode
}

// SetClashMode switches the runtime routing mode live (no restart) and persists
// it so it survives restarts. When the core is running it PATCHes clash_api
// immediately; otherwise the mode is stored and baked into the next Start's
// config (experimental.clash_api.default_mode).
func (s *Service) SetClashMode(mode string) error {
	if !clashModes[mode] {
		return fmt.Errorf("invalid mode %q", mode)
	}
	s.mu.Lock()
	s.clashMode = mode
	s.cfg.ClashMode = mode
	s.save()
	port := s.clashPort
	secret := s.clashSecret
	running := s.core.Running()
	s.mu.Unlock()

	if !running || port == 0 {
		// Not running: the mode is stored and applied when the core next starts.
		return nil
	}
	if err := putClashMode(port, secret, mode); err != nil {
		return fmt.Errorf("switch mode: %w", err)
	}
	s.log(fmt.Sprintf("[clash] mode -> %s", mode))
	return nil
}

// putClashMode issues the clash_api PATCH /configs {"mode":...} call.
func putClashMode(port int, secret, mode string) error {
	body, _ := json.Marshal(map[string]string{"mode": mode})
	url := fmt.Sprintf("http://127.0.0.1:%d/configs", port)
	req, err := http.NewRequest(http.MethodPatch, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}
	cl := &http.Client{Timeout: 3 * time.Second}
	resp, err := cl.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("clash_api status %d", resp.StatusCode)
	}
	return nil
}

// clashTraffic reads the cumulative byte counters maintained by sing-box's
// Clash API. The UI polls Status once per second and calculates the current
// upload/download rate from the difference between two snapshots.
func clashTraffic(port int, secret string) (Stats, error) {
	if port <= 0 {
		return Stats{}, fmt.Errorf("clash_api is not running")
	}
	return clashTrafficURL(fmt.Sprintf("http://127.0.0.1:%d/connections", port), secret)
}

func clashTrafficURL(url, secret string) (Stats, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return Stats{}, err
	}
	if secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}
	resp, err := (&http.Client{Timeout: 600 * time.Millisecond}).Do(req)
	if err != nil {
		return Stats{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1024))
		return Stats{}, fmt.Errorf("clash_api status %d", resp.StatusCode)
	}
	var payload struct {
		DownloadTotal int64             `json:"downloadTotal"`
		UploadTotal   int64             `json:"uploadTotal"`
		Connections   []json.RawMessage `json:"connections"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&payload); err != nil {
		return Stats{}, err
	}
	return Stats{
		Running:     true,
		ActiveConns: int64(len(payload.Connections)),
		TotalConns:  int64(len(payload.Connections)),
		Tracked:     len(payload.Connections),
		UpBytes:     payload.UploadTotal,
		DownBytes:   payload.DownloadTotal,
	}, nil
}

// closeProcessConnections closes the live connections opened by the given
// programs (lower-case exe names), so an app whose route just changed reconnects
// under the new route instead of keeping its old tunnel open. Best effort:
// returns how many were closed.
func closeProcessConnections(port int, secret string, names map[string]bool) int {
	if port <= 0 || len(names) == 0 {
		return 0
	}
	do := func(method, path string) (*http.Response, error) {
		req, err := http.NewRequest(method, fmt.Sprintf("http://127.0.0.1:%d%s", port, path), nil)
		if err != nil {
			return nil, err
		}
		if secret != "" {
			req.Header.Set("Authorization", "Bearer "+secret)
		}
		return (&http.Client{Timeout: 2 * time.Second}).Do(req)
	}
	resp, err := do(http.MethodGet, "/connections")
	if err != nil {
		return 0
	}
	var payload struct {
		Connections []struct {
			ID       string `json:"id"`
			Metadata struct {
				Process     string `json:"process"`
				ProcessPath string `json:"processPath"`
			} `json:"metadata"`
		} `json:"connections"`
	}
	err = json.NewDecoder(io.LimitReader(resp.Body, 16<<20)).Decode(&payload)
	resp.Body.Close()
	if err != nil {
		return 0
	}
	closed := 0
	for _, c := range payload.Connections {
		proc := c.Metadata.Process
		if proc == "" {
			proc = baseName(c.Metadata.ProcessPath)
		}
		if c.ID == "" || !names[strings.ToLower(proc)] {
			continue
		}
		if r, err := do(http.MethodDelete, "/connections/"+c.ID); err == nil {
			r.Body.Close()
			if r.StatusCode < 300 {
				closed++
			}
		}
	}
	return closed
}

// ConnInfo is one live connection surfaced to the diagnostics view: which
// process opened it, where it is heading, which routing rule it matched and
// which outbound (exit) sing-box finally used. This is exactly the "命中了哪条
// 规则 / 走了哪个出口" answer that raw logs only hint at — sourced from the same
// Clash API /connections snapshot that already feeds the traffic counters.
type ConnInfo struct {
	Process  string `json:"process"`        // exe basename, e.g. chrome.exe
	Path     string `json:"path,omitempty"` // full exe path (tells same-named programs apart)
	Host     string `json:"host"`           // target host (or destination IP)
	Dest     string `json:"dest"`           // ip:port
	Network  string `json:"network"`        // tcp | udp
	Rule     string `json:"rule"`           // matched rule, e.g. "process_name chrome.exe"
	OutTag   string `json:"outTag"`         // raw outbound tag (proxy|direct|reject|node-<id>)
	Outbound string `json:"outbound"`       // friendly exit label (直连/拦截/<节点名>)
	Upload   int64  `json:"upload"`
	Download int64  `json:"download"`
	ID       string `json:"id,omitempty"`     // clash connection id
	Source   string `json:"source,omitempty"` // client ip (proxy-port inbounds)
	Start    string `json:"start,omitempty"`  // RFC3339 start time
}

func baseName(p string) string {
	if i := strings.LastIndexAny(p, `/\`); i >= 0 {
		return p[i+1:]
	}
	return p
}

// clashConnections fetches and parses the live connection list from sing-box's
// Clash API. Unlike clashTraffic (which only counts them) it keeps each
// connection's process / target / rule / outbound-chain.
func clashConnections(port int, secret string) ([]ConnInfo, error) {
	if port <= 0 {
		return nil, fmt.Errorf("clash_api is not running")
	}
	url := fmt.Sprintf("http://127.0.0.1:%d/connections", port)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	if secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}
	resp, err := (&http.Client{Timeout: 800 * time.Millisecond}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("clash_api status %d", resp.StatusCode)
	}
	var payload struct {
		Connections []struct {
			Metadata struct {
				Network         string `json:"network"`
				Host            string `json:"host"`
				DestinationIP   string `json:"destinationIP"`
				DestinationPort string `json:"destinationPort"`
				Process         string `json:"process"`
				ProcessPath     string `json:"processPath"`
				SourceIP        string `json:"sourceIP"`
			} `json:"metadata"`
			Upload      int64    `json:"upload"`
			Download    int64    `json:"download"`
			Chains      []string `json:"chains"`
			Rule        string   `json:"rule"`
			RulePayload string   `json:"rulePayload"`
			ID          string   `json:"id"`
			Start       string   `json:"start"`
		} `json:"connections"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 16<<20)).Decode(&payload); err != nil {
		return nil, err
	}
	out := make([]ConnInfo, 0, len(payload.Connections))
	for _, c := range payload.Connections {
		proc := c.Metadata.Process
		if proc == "" {
			proc = baseName(c.Metadata.ProcessPath)
		}
		host := c.Metadata.Host
		if host == "" {
			host = c.Metadata.DestinationIP
		}
		dest := c.Metadata.DestinationIP
		if c.Metadata.DestinationPort != "" && c.Metadata.DestinationIP != "" {
			dest = net.JoinHostPort(c.Metadata.DestinationIP, c.Metadata.DestinationPort)
		}
		rule := c.Rule
		if c.RulePayload != "" {
			rule = strings.TrimSpace(c.Rule + " " + c.RulePayload)
		}
		// The last element of the chain is the real outbound sing-box used.
		tag := ""
		if n := len(c.Chains); n > 0 {
			tag = c.Chains[n-1]
		}
		out = append(out, ConnInfo{
			Process: proc, Path: c.Metadata.ProcessPath, Host: host, Dest: dest, Network: c.Metadata.Network,
			Rule: rule, OutTag: tag, Upload: c.Upload, Download: c.Download,
			ID: c.ID, Source: c.Metadata.SourceIP, Start: c.Start,
		})
	}
	return out, nil
}

// Connections returns the live per-connection routing trace (process → target →
// matched rule → exit) for the diagnostics view. Empty when the core / clash_api
// is not running.
func (s *Service) Connections() []ConnInfo {
	s.mu.Lock()
	port, secret := s.clashPort, s.clashSecret
	labels := s.outboundLabelsLocked()
	s.mu.Unlock()
	conns, err := clashConnections(port, secret)
	if err != nil {
		return []ConnInfo{}
	}
	for i := range conns {
		conns[i].Outbound = labelOutbound(conns[i].OutTag, labels)
	}
	return conns
}

// outboundLabelsLocked maps outbound tags to friendly node names: "proxy" = the
// active node, "node-<id>" = that specific node. Caller holds s.mu.
func (s *Service) outboundLabelsLocked() map[string]string {
	m := make(map[string]string, len(s.cfg.Nodes)+1)
	for _, n := range s.cfg.Nodes {
		if n == nil {
			continue
		}
		if n.ID == s.cfg.SelectedID {
			m["proxy"] = n.Name
		}
		m["node-"+n.ID] = n.Name
	}
	return m
}

// labelOutbound turns a raw outbound tag into a user-facing exit label.
func labelOutbound(tag string, labels map[string]string) string {
	switch tag {
	case "", "final":
		return "—"
	case "direct":
		return "直连"
	case "block", "reject":
		return "拦截"
	case "dns", "dns-out":
		return "DNS"
	}
	if name := labels[tag]; name != "" {
		return name
	}
	if tag == "proxy" {
		return "节点"
	}
	return tag
}
