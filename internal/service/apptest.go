package service

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"proxysplit/internal/latency"
	"proxysplit/internal/nodes"
)

// TestApp measures connectivity for a single app rule (found by its match or
// path). It resolves the app's line to a node and tests reachability + latency.
// Returns round-trip ms, or: -1 not-found/unreachable, 0 direct (no proxy),
// -2 blocked.
func (s *Service) TestApp(match string) int {
	s.mu.Lock()
	all := s.allLinesLocked()
	var line *Line
	for _, r := range s.cfg.Rules {
		if strings.EqualFold(r.Match, match) || strings.EqualFold(r.Path, match) {
			line = lineByID(all, r.Line)
			break
		}
	}
	selected := s.selectedNode()
	nodeList := append([]*nodes.Node(nil), s.cfg.Nodes...)
	s.mu.Unlock()

	if line == nil {
		return -1
	}
	switch line.Node {
	case LineDirect:
		return 0 // 直连 — no proxy path to test
	case LineBlock:
		return -2 // 拦截
	}
	node, err := resolveLineNode(line, selected, nodeList)
	if err != nil || node == nil {
		return -1
	}
	snap := *node
	return latency.Measure(&snap, "", 5*time.Second).Latency
}

// ExportAll returns the entire config as pretty JSON (for backup/migration).
func (s *Service) ExportAll() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := json.MarshalIndent(&s.cfg, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// ImportAll replaces the entire config from a JSON backup and re-applies it.
func (s *Service) ImportAll(data string) error {
	var cfg Config
	if err := json.Unmarshal([]byte(data), &cfg); err != nil {
		return fmt.Errorf("配置格式无法识别: %w", err)
	}
	if len(cfg.Nodes) == 0 && len(cfg.Rules) == 0 && len(cfg.Lines) == 0 {
		return fmt.Errorf("备份里没有可导入的内容")
	}
	s.mu.Lock()
	s.cfg = cfg
	s.save() // persist the imported config to disk first...
	s.load() // ...then read it back so defaults + migrations are applied
	s.mu.Unlock()
	s.log("[store] 已从备份导入配置")
	s.applyLive()
	return nil
}
