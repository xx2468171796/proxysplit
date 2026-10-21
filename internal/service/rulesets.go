package service

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"proxysplit/internal/core"
	"proxysplit/internal/geoupdate"
)

// RuleSetInfo describes one bundled sing-box rule-set (.srs) for the 规则 page.
type RuleSetInfo struct {
	Name     string `json:"name"`     // file name
	Display  string `json:"display"`  // human label
	Desc     string `json:"desc"`     // what it does
	SizeKB   int    `json:"sizeKB"`   // on-disk size
	Modified string `json:"modified"` // last-updated date (YYYY-MM-DD), "" if missing
	Present  bool   `json:"present"`
	Enabled  bool   `json:"enabled"`
}

// ruleSetFiles are the rule-sets actually used by the router (bypass-CN + ads).
var ruleSetFiles = []struct{ name, display, desc string }{
	{"geosite-cn.srs", "国内网站 (geosite-cn)", "识别大陆网站域名 → 直连不走代理"},
	{"geoip-cn.srs", "国内 IP (geoip-cn)", "识别大陆 IP 段 → 直连不走代理"},
	{"geosite-category-ads-all.srs", "广告域名 (ads)", "广告/追踪域名 → 直接拦截"},
}

func normalizeRuleSetConfig(current map[string]bool) map[string]bool {
	out := make(map[string]bool, len(ruleSetFiles))
	for _, rs := range ruleSetFiles {
		// A missing key means enabled so configs written by older versions keep
		// their historical smart-routing behaviour.
		enabled, exists := current[rs.name]
		if !exists {
			enabled = true
		}
		out[rs.name] = enabled
	}
	return out
}

func knownRuleSet(name string) bool {
	for _, rs := range ruleSetFiles {
		if rs.name == name {
			return true
		}
	}
	return false
}

// GetRuleSets returns the state of each routing rule-set (used by 绕过大陆 分流).
func (s *Service) GetRuleSets() []RuleSetInfo {
	s.mu.Lock()
	enabled := normalizeRuleSetConfig(s.cfg.RuleSets)
	s.mu.Unlock()
	out := make([]RuleSetInfo, 0, len(ruleSetFiles))
	for _, rs := range ruleSetFiles {
		info := RuleSetInfo{Name: rs.name, Display: rs.display, Desc: rs.desc, Enabled: enabled[rs.name]}
		if st, err := os.Stat(filepath.Join(s.binDir, rs.name)); err == nil {
			info.Present = true
			info.SizeKB = int(st.Size() / 1024)
			info.Modified = st.ModTime().Format("2006-01-02")
		}
		out = append(out, info)
	}
	return out
}

// SetRuleSetEnabled enables/disables one bundled smart-routing data set and
// safely reloads a running core. It returns "" on success for Wails bindings.
func (s *Service) SetRuleSetEnabled(name string, enabled bool) string {
	name = strings.TrimSpace(name)
	if !knownRuleSet(name) {
		return "未知规则库: " + name
	}
	s.mu.Lock()
	s.cfg.RuleSets = normalizeRuleSetConfig(s.cfg.RuleSets)
	if s.cfg.RuleSets[name] == enabled {
		s.mu.Unlock()
		return ""
	}
	s.cfg.RuleSets[name] = enabled
	s.save()
	s.mu.Unlock()
	if err := s.restart(); err != nil {
		s.log("[rules] restart after rule-set change failed: " + err.Error())
		return restartMsg(err)
	}
	return ""
}

// RuleSetsUpdatedAt returns the newest rule-set file's mod time as a date, or "".
func (s *Service) RuleSetsUpdatedAt() string {
	var newest time.Time
	for _, rs := range ruleSetFiles {
		if st, err := os.Stat(filepath.Join(s.binDir, rs.name)); err == nil && st.ModTime().After(newest) {
			newest = st.ModTime()
		}
	}
	if newest.IsZero() {
		return ""
	}
	return newest.Format("2006-01-02")
}

// GetCustomRules returns the user's global custom routing rules.
func (s *Service) GetCustomRules() []core.RouteRule {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Use a non-nil empty slice so JSON marshals to `[]`, never `null`; a null
	// reaching the frontend {#each customRules} throws and wedges Svelte's
	// scheduler (whole-UI freeze on the 分流规则 page).
	return append([]core.RouteRule{}, s.cfg.CustomRules...)
}

// normalizeRouteRules validates, normalizes and de-duplicates custom rules.
// Rejecting the whole update keeps a malformed UI/import payload from silently
// replacing the last known-good rules.
func normalizeRouteRules(rules []core.RouteRule) ([]core.RouteRule, error) {
	out := make([]core.RouteRule, 0, len(rules))
	seen := map[string]bool{}
	for i, raw := range rules {
		typ, value, err := canonicalRuleInput(strings.ToLower(strings.TrimSpace(raw.Type)), raw.Value)
		if err != nil {
			return nil, fmt.Errorf("第 %d 条规则: %w", i+1, err)
		}
		action := strings.ToLower(strings.TrimSpace(raw.Action))
		if value == "" {
			continue
		}
		if action == "" {
			action = "proxy"
		}
		switch action {
		case "proxy", "direct", "block":
		default:
			return nil, fmt.Errorf("第 %d 条规则动作无效: %s", i+1, raw.Action)
		}
		switch typ {
		case "domain", "suffix": // already lower-cased and stripped by canonicalRuleInput
			if err := validateDomainRule(value); err != nil {
				return nil, fmt.Errorf("第 %d 条规则: %w", i+1, err)
			}
		case "keyword":
			value = strings.ToLower(value)
			if strings.ContainsAny(value, " \t\r\n") {
				return nil, fmt.Errorf("第 %d 条规则关键字不能包含空白", i+1)
			}
		case "ip":
			if ip, network, err := net.ParseCIDR(value); err == nil {
				network.IP = ip.Mask(network.Mask)
				value = network.String()
			} else if ip := net.ParseIP(value); ip != nil {
				value = ip.String()
			} else {
				return nil, fmt.Errorf("第 %d 条规则不是有效 IP 或 CIDR: %s", i+1, value)
			}
		default:
			return nil, fmt.Errorf("第 %d 条规则类型无效: %s", i+1, raw.Type)
		}
		key := typ + "\x00" + value + "\x00" + action
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, core.RouteRule{Type: typ, Value: value, Action: action})
	}
	return out, nil
}

// canonicalRuleInput turns what people actually type into a valid rule: a
// pasted URL keeps only its host, "*.x.com" / ".x.com" become a suffix rule,
// ports / trailing dots / full-width dots are dropped, and an IP typed under a
// domain type becomes an IP rule. Remaining mistakes get a hint on how to write it.
func canonicalRuleInput(typ, value string) (string, string, error) {
	value = strings.TrimSpace(strings.NewReplacer("。", ".", "．", ".", "：", ":", "／", "/").Replace(value))
	if value == "" || typ == "ip" {
		if typ == "ip" && value != "" && net.ParseIP(value) == nil {
			if _, _, err := net.ParseCIDR(value); err != nil {
				return typ, value, fmt.Errorf("「IP 段」只能填 IP 或 CIDR（如 1.1.1.1、10.0.0.0/8），网址请选「域名后缀」：%s", value)
			}
		}
		return typ, value, nil
	}
	if typ == "keyword" {
		return typ, strings.ToLower(value), nil
	}
	if typ != "domain" && typ != "suffix" {
		return typ, value, nil
	}
	v := strings.ToLower(value)
	if _, _, err := net.ParseCIDR(v); err == nil { // before URL stripping eats "/8"
		return "ip", v, nil
	}
	if i := strings.Index(v, "://"); i >= 0 {
		v = v[i+3:]
	}
	if i := strings.IndexAny(v, "/?#"); i >= 0 {
		v = v[:i]
	}
	if i := strings.LastIndex(v, "@"); i >= 0 {
		v = v[i+1:]
	}
	if host, _, err := net.SplitHostPort(v); err == nil {
		v = host
	}
	v = strings.TrimSuffix(v, ".")
	switch {
	case strings.HasPrefix(v, "*."):
		typ, v = "suffix", v[2:]
	case strings.HasPrefix(v, "."):
		typ, v = "suffix", v[1:]
	}
	if strings.Contains(v, "*") {
		return typ, v, fmt.Errorf("通配符只能写在开头，如 *.github.com（等同「域名后缀」github.com）；包含某个词请选「关键字」：%s", value)
	}
	if net.ParseIP(strings.Trim(v, "[]")) != nil {
		return "ip", strings.Trim(v, "[]"), nil
	}
	if _, _, err := net.ParseCIDR(v); err == nil {
		return "ip", v, nil
	}
	return typ, v, nil
}

func validateDomainRule(value string) error {
	if value == "" || len(value) > 253 || strings.ContainsAny(value, "/:@?#") || strings.IndexFunc(value, unicode.IsSpace) >= 0 {
		return fmt.Errorf("域名格式无效: %s", value)
	}
	for _, label := range strings.Split(value, ".") {
		if label == "" || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return fmt.Errorf("域名格式无效: %s", value)
		}
	}
	return nil
}

// SetCustomRules replaces the global custom routing rules (域名/IP → 代理/直连/
// 拦截) and regenerates the running config so they take effect immediately.
func (s *Service) SetCustomRules(rules []core.RouteRule) string {
	kept, err := normalizeRouteRules(rules)
	if err != nil {
		return err.Error()
	}
	s.mu.Lock()
	s.cfg.CustomRules = kept
	s.save()
	s.mu.Unlock()
	if err := s.restart(); err != nil {
		s.log("[rules] restart after custom-rule change failed: " + err.Error())
		return restartMsg(err)
	}
	return ""
}

const (
	ruleSyncFirstDelay = 30 * time.Second
	ruleSyncInterval   = 6 * time.Hour
)

// StartRuleSync keeps the rule-sets in step with the Shenzhen mirror (updated
// daily): a check shortly after launch, then every few hours. Direct
// connection, no proxy needed; only files whose sha256 differs are downloaded.
// sing-box reloads local rule-sets when the file changes, so no restart.
func (s *Service) StartRuleSync() {
	s.ruleSyncStart.Do(func() {
		go func() {
			time.Sleep(ruleSyncFirstDelay)
			for {
				s.syncRuleSets()
				time.Sleep(ruleSyncInterval)
			}
		}()
	})
}

func (s *Service) syncRuleSets() {
	res, err := geoupdate.Sync(s.binDir)
	if err != nil {
		s.log(fmt.Sprintf("[rules] 规则库自动同步失败（下次再试）: %v", err))
		return
	}
	if res.Changed > 0 {
		s.log(fmt.Sprintf("[rules] 规则库已从深圳镜像更新 %d 个文件", res.Changed))
	}
}
