package service

import (
	"encoding/json"
	"fmt"
)

// rulesBundle is the export/import envelope: the app-split rules together with
// the custom lines they reference (a rule points at a line by id, so the lines
// must travel with the rules to stay meaningful on another machine).
type rulesBundle struct {
	Rules []AppRule `json:"rules"`
	Lines []Line    `json:"lines"`
}

// ExportAppRules serialises the current app rules and custom lines into an
// indented JSON string suitable for saving to a file.
func (s *Service) ExportAppRules() (string, error) {
	s.mu.Lock()
	bundle := rulesBundle{
		Rules: append([]AppRule(nil), s.cfg.Rules...),
		Lines: append([]Line(nil), s.cfg.Lines...),
	}
	s.mu.Unlock()

	data, err := json.MarshalIndent(bundle, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// ImportAppRules parses a previously exported bundle, replacing the app rules
// and merging in any custom lines not already present, then applies the result
// to a running core.
func (s *Service) ImportAppRules(data string) error {
	var bundle rulesBundle
	if err := json.Unmarshal([]byte(data), &bundle); err != nil {
		return fmt.Errorf("规则格式无法识别: %w", err)
	}
	if len(bundle.Rules) == 0 && len(bundle.Lines) == 0 {
		return fmt.Errorf("没有可导入的规则")
	}

	s.mu.Lock()
	s.cfg.Rules = bundle.Rules
	// Merge custom lines, deduping by id so an existing line is never duplicated.
	existing := map[string]bool{}
	for _, l := range s.cfg.Lines {
		existing[l.ID] = true
	}
	for _, l := range bundle.Lines {
		if existing[l.ID] {
			continue
		}
		s.cfg.Lines = append(s.cfg.Lines, l)
		existing[l.ID] = true
	}
	s.save()
	s.mu.Unlock()

	s.applyLive()
	s.log(fmt.Sprintf("[rules] 已导入 %d 条规则", len(bundle.Rules)))
	return nil
}
