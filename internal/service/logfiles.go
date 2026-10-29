package service

import (
	"fmt"
	"net"
	"path/filepath"
	"time"

	"proxysplit/internal/logfile"
)

// Daily log files (docs/memory/logs.md): every Service.log line is also written
// to <dataDir>/logs/proxysplit-YYYY-MM-DD.log, plus a once-a-minute record of
// new connections (process → exit → target).

const (
	connLogEvery   = 60 * time.Second
	connLogMaxTick = 500
)

// LogDir is the folder holding the day files.
func (s *Service) LogDir() string { return filepath.Join(s.dataDir, "logs") }

// LogRetentionDays is the effective retention (1–30, unset = 7).
func (st Settings) LogRetentionDays() int { return logfile.ClampDays(st.LogDays) }

func (s *Service) logRetentionDays() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cfg.Settings.LogRetentionDays()
}

// openLogFiles starts the file writer (called first in New; connLogLoop starts at its end).
func (s *Service) openLogFiles() {
	s.files = logfile.Open(s.LogDir(), s.logRetentionDays)
}

func (s *Service) closeLogFiles() {
	if s.files != nil {
		s.files.Close()
	}
}

func (s *Service) connLogLoop() {
	t := time.NewTicker(connLogEvery)
	defer t.Stop()
	var seen map[string]bool
	for {
		select {
		case <-s.quit:
			return
		case <-t.C:
		}
		if !s.core.Running() {
			seen = nil
			continue
		}
		var lines []string
		lines, seen = connLogLines(s.Connections(), seen, connLogMaxTick)
		for _, l := range lines {
			s.files.Write(l) // file only: one line per connection would flood the UI and upload
		}
	}
}

// connLogLines formats the connections not present in the previous tick (by
// clash id) and returns the current id set for the next tick. At most max lines
// are produced, followed by one summary line for the rest.
func connLogLines(conns []ConnInfo, prev map[string]bool, max int) ([]string, map[string]bool) {
	cur := make(map[string]bool, len(conns))
	var lines []string
	skipped := 0
	for _, c := range conns {
		key := c.ID
		if key == "" {
			key = c.Process + "|" + c.Dest + "|" + c.SrcPort + "|" + c.Start
		}
		if cur[key] {
			continue
		}
		cur[key] = true
		if prev[key] {
			continue
		}
		if len(lines) >= max {
			skipped++
			continue
		}
		lines = append(lines, formatConnLine(c))
	}
	if skipped > 0 {
		lines = append(lines, fmt.Sprintf("[conn] 本轮还有 %d 条新连接未逐条记录（每分钟最多 %d 条）", skipped, max))
	}
	return lines, cur
}

// formatConnLine renders "[conn] chrome.exe → 香港 01 → www.google.com:443 rule=…".
func formatConnLine(c ConnInfo) string {
	proc := c.Process
	if proc == "" {
		proc = "未知进程"
	}
	out := c.Outbound
	if out == "" {
		out = c.OutTag
	}
	target := c.Host
	if _, port, err := net.SplitHostPort(c.Dest); err == nil && target != "" {
		target = net.JoinHostPort(target, port)
	} else if target == "" {
		target = c.Dest
	}
	rule := c.Rule
	if rule == "" {
		rule = "-"
	}
	line := fmt.Sprintf("[conn] %s → %s → %s rule=%s", proc, out, target, rule)
	if c.Network != "" && c.Network != "tcp" {
		line += " net=" + c.Network
	}
	return line
}
