package service

import (
	"encoding/json"
	"fmt"

	"proxysplit/internal/core"
)

const rulesSchemaVersion = 2

// rulesBundle is a versioned, portable snapshot of the complete routing layer.
// Schema 0/1 bundles from older versions (rules + lines only) remain importable.
type rulesBundle struct {
	SchemaVersion int              `json:"schemaVersion"`
	Rules         []AppRule        `json:"rules"`
	Lines         []Line           `json:"lines"`
	CustomRules   []core.RouteRule `json:"customRules,omitempty"`
	RuleSets      map[string]bool  `json:"ruleSets,omitempty"`
	RuleMode      string           `json:"ruleMode,omitempty"`
	DefaultLine   string           `json:"defaultLine,omitempty"`
}

// RuleImportPreview lets the UI show exactly what an import will change before
// the user confirms it. Import remains all-or-nothing after confirmation.
type RuleImportPreview struct {
	SchemaVersion int    `json:"schemaVersion"`
	RuleCount     int    `json:"ruleCount"`
	LineAdded     int    `json:"lineAdded"`
	LineSkipped   int    `json:"lineSkipped"`
	CustomRules   int    `json:"customRules"`
	Summary       string `json:"summary"`
	Error         string `json:"error,omitempty"`
}

func parseRulesBundle(data string) (rulesBundle, error) {
	var bundle rulesBundle
	if err := json.Unmarshal([]byte(data), &bundle); err != nil {
		return bundle, fmt.Errorf("????????: %w", err)
	}
	if bundle.SchemaVersion < 0 || bundle.SchemaVersion > rulesSchemaVersion {
		return bundle, fmt.Errorf("????????: %d", bundle.SchemaVersion)
	}
	if len(bundle.Rules) == 0 && len(bundle.Lines) == 0 && bundle.CustomRules == nil && bundle.RuleSets == nil {
		return bundle, fmt.Errorf("????????")
	}
	return bundle, nil
}

// ExportAppRules serialises the complete routing layer into a versioned JSON
// bundle. Sensitive node credentials are never included.
func (s *Service) ExportAppRules() (string, error) {
	s.mu.Lock()
	bundle := rulesBundle{
		SchemaVersion: rulesSchemaVersion,
		Rules:         append([]AppRule{}, s.cfg.Rules...),
		Lines:         append([]Line{}, s.cfg.Lines...),
		CustomRules:   append([]core.RouteRule{}, s.cfg.CustomRules...),
		RuleSets:      normalizeRuleSetConfig(s.cfg.RuleSets),
		RuleMode:      s.cfg.RuleMode,
		DefaultLine:   s.cfg.DefaultLine,
	}
	s.mu.Unlock()

	data, err := json.MarshalIndent(bundle, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func mergeImportedLines(current, incoming []Line) (merged []Line, added, skipped int) {
	merged = append([]Line{}, current...)
	existing := map[string]bool{}
	for _, line := range current {
		existing[line.ID] = true
	}
	for _, line := range incoming {
		if existing[line.ID] {
			skipped++
			continue
		}
		merged = append(merged, line)
		existing[line.ID] = true
		added++
	}
	return merged, added, skipped
}

// validateRulesBundleLocked performs the complete import preflight without
// leaving any candidate state behind. Caller holds s.mu.
func (s *Service) validateRulesBundleLocked(bundle rulesBundle) (rules []AppRule, lines []Line, custom []core.RouteRule, preview RuleImportPreview, err error) {
	merged, added, skipped := mergeImportedLines(s.cfg.Lines, bundle.Lines)
	lines, err = s.normalizeCustomLinesLocked(merged)
	if err != nil {
		err = fmt.Errorf("???????: %w", err)
		return
	}

	oldLines := s.cfg.Lines
	s.cfg.Lines = lines
	rules, err = s.normalizeAppRulesLocked(bundle.Rules)
	s.cfg.Lines = oldLines
	if err != nil {
		err = fmt.Errorf("?????????: %w", err)
		return
	}

	if bundle.CustomRules != nil {
		custom, err = normalizeRouteRules(bundle.CustomRules)
		if err != nil {
			err = fmt.Errorf("??????????: %w", err)
			return
		}
	}
	if bundle.RuleMode != "" && bundle.RuleMode != "blacklist" && bundle.RuleMode != "whitelist" {
		err = fmt.Errorf("???????????: %s", bundle.RuleMode)
		return
	}
	defaultLine := bundle.DefaultLine
	if defaultLine != "" {
		all := append(builtinLines(), lines...)
		if lineByID(all, defaultLine) == nil {
			err = fmt.Errorf("??????????: %s", defaultLine)
			return
		}
	}
	preview = RuleImportPreview{
		SchemaVersion: bundle.SchemaVersion,
		RuleCount:     len(rules),
		LineAdded:     added,
		LineSkipped:   skipped,
		CustomRules:   len(custom),
	}
	preview.Summary = fmt.Sprintf("??? %d ???????? %d ?????? %d ?? ID ??", preview.RuleCount, added, skipped)
	if bundle.CustomRules != nil {
		preview.Summary += fmt.Sprintf("??? %d ??????", len(custom))
	}
	return
}

func (s *Service) PreviewAppRulesImport(data string) (RuleImportPreview, error) {
	bundle, err := parseRulesBundle(data)
	if err != nil {
		return RuleImportPreview{}, err
	}
	s.mu.Lock()
	_, _, _, preview, err := s.validateRulesBundleLocked(bundle)
	s.mu.Unlock()
	return preview, err
}

// ImportAppRules validates and commits the complete routing bundle atomically.
func (s *Service) ImportAppRules(data string) error {
	bundle, err := parseRulesBundle(data)
	if err != nil {
		return err
	}

	s.mu.Lock()
	rules, lines, custom, preview, err := s.validateRulesBundleLocked(bundle)
	if err != nil {
		s.mu.Unlock()
		return err
	}
	s.cfg.Rules = rules
	s.cfg.Lines = lines
	if bundle.CustomRules != nil {
		s.cfg.CustomRules = custom
	}
	if bundle.RuleSets != nil {
		s.cfg.RuleSets = normalizeRuleSetConfig(bundle.RuleSets)
	}
	if bundle.RuleMode != "" {
		s.cfg.RuleMode = bundle.RuleMode
	}
	if bundle.DefaultLine != "" {
		s.cfg.DefaultLine = bundle.DefaultLine
	}
	s.save()
	s.mu.Unlock()

	s.log("[rules] " + preview.Summary)
	if err := s.applyLive(); err != nil {
		return fmt.Errorf("已导入,但代理重新启动失败: %w", err)
	}
	return nil
}
