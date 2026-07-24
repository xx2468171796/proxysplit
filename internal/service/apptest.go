package service

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"proxysplit/internal/engine"
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
		return 0
	case LineBlock:
		return -2
	}
	node, err := resolveLineNode(line, selected, nodeList)
	if err != nil || node == nil {
		return -1
	}
	snap := *node
	return s.measureNode(&snap, 8*time.Second).Latency
}

// ExportAll returns the entire config as pretty JSON for backup/migration.
func (s *Service) ExportAll() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := json.MarshalIndent(&s.cfg, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// validateImportedConfigLocked preflights all cross references before a backup
// can replace live state. Caller holds s.mu.
func (s *Service) validateImportedConfigLocked(cfg *Config) error {
	if cfg.RuleMode == "" {
		cfg.RuleMode = engine.ModeBlacklist
	}
	if cfg.RuleMode != engine.ModeBlacklist && cfg.RuleMode != engine.ModeWhitelist {
		return fmt.Errorf("invalid app split mode: %s", cfg.RuleMode)
	}
	if cfg.DefaultLine == "" {
		cfg.DefaultLine = LineRule
	}
	if cfg.Settings.Theme == "" {
		cfg.Settings = defaultSettings()
	}
	cfg.RuleSets = normalizeRuleSetConfig(cfg.RuleSets)

	seenNodes := make(map[string]bool, len(cfg.Nodes))
	for i, n := range cfg.Nodes {
		if n == nil || strings.TrimSpace(n.ID) == "" {
			return fmt.Errorf("node %d is missing an ID", i+1)
		}
		if seenNodes[n.ID] {
			return fmt.Errorf("duplicate node ID: %s", n.ID)
		}
		seenNodes[n.ID] = true
	}
	if cfg.SelectedID != "" && !seenNodes[cfg.SelectedID] {
		cfg.SelectedID = ""
	}
	if cfg.SelectedID == "" && len(cfg.Nodes) > 0 {
		cfg.SelectedID = cfg.Nodes[0].ID
	}

	// Existing validators resolve references through s.cfg. Install the candidate
	// briefly, then always restore the current configuration.
	previous := s.cfg
	s.cfg = *cfg
	defer func() { s.cfg = previous }()
	lines, err := s.normalizeCustomLinesLocked(s.cfg.Lines)
	if err != nil {
		return fmt.Errorf("invalid custom lines: %w", err)
	}
	s.cfg.Lines = lines
	rules, err := s.normalizeAppRulesLocked(s.cfg.Rules)
	if err != nil {
		return fmt.Errorf("invalid app rules: %w", err)
	}
	s.cfg.Rules = rules
	custom, err := normalizeRouteRules(s.cfg.CustomRules)
	if err != nil {
		return fmt.Errorf("invalid global rules: %w", err)
	}
	s.cfg.CustomRules = custom
	if lineByID(s.allLinesLocked(), s.cfg.DefaultLine) == nil {
		return fmt.Errorf("default line does not exist: %s", s.cfg.DefaultLine)
	}
	*cfg = s.cfg
	return nil
}

// ImportAll restores the full user snapshot transactionally. It rejects the
// generated sing-box runtime file, validates before touching live memory, and
// writes a recovery copy before reporting success.
func (s *Service) ImportAll(data string) error {
	if isCoreConfig([]byte(data)) {
		return fmt.Errorf("the selected file is a sing-box runtime config, not a ProxySplit backup")
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal([]byte(data), &raw); err != nil || len(raw) == 0 {
		return fmt.Errorf("backup must be a non-empty ProxySplit JSON object")
	}
	var cfg Config
	if err := json.Unmarshal([]byte(data), &cfg); err != nil {
		return fmt.Errorf("backup format cannot be read: %w", err)
	}

	s.mu.Lock()
	if err := s.validateImportedConfigLocked(&cfg); err != nil {
		s.mu.Unlock()
		return err
	}
	old := s.cfg
	s.cfg = cfg
	if err := s.persistLocked(); err != nil {
		s.cfg = old
		s.mu.Unlock()
		return fmt.Errorf("backup could not be saved: %w", err)
	}
	s.mu.Unlock()
	s.log("[store] imported configuration backup")
	s.applyLive()
	return nil
}
