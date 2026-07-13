package service

import (
	"os"
	"path/filepath"
	"time"
)

// RuleSetInfo describes one bundled sing-box rule-set (.srs) for the 规则 page.
type RuleSetInfo struct {
	Name     string `json:"name"`     // file name
	Display  string `json:"display"`  // human label
	Desc     string `json:"desc"`     // what it does
	SizeKB   int    `json:"sizeKB"`   // on-disk size
	Modified string `json:"modified"` // last-updated date (YYYY-MM-DD), "" if missing
	Present  bool   `json:"present"`
}

// ruleSetFiles are the rule-sets actually used by the router (bypass-CN + ads).
var ruleSetFiles = []struct{ name, display, desc string }{
	{"geosite-cn.srs", "国内网站 (geosite-cn)", "识别大陆网站域名 → 直连不走代理"},
	{"geoip-cn.srs", "国内 IP (geoip-cn)", "识别大陆 IP 段 → 直连不走代理"},
	{"geosite-category-ads-all.srs", "广告域名 (ads)", "广告/追踪域名 → 直接拦截"},
}

// GetRuleSets returns the state of each routing rule-set (used by 绕过大陆 分流).
func (s *Service) GetRuleSets() []RuleSetInfo {
	out := make([]RuleSetInfo, 0, len(ruleSetFiles))
	for _, rs := range ruleSetFiles {
		info := RuleSetInfo{Name: rs.name, Display: rs.display, Desc: rs.desc}
		if st, err := os.Stat(filepath.Join(s.binDir, rs.name)); err == nil {
			info.Present = true
			info.SizeKB = int(st.Size() / 1024)
			info.Modified = st.ModTime().Format("2006-01-02")
		}
		out = append(out, info)
	}
	return out
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

// maybeAutoUpdateRules refreshes the rule-sets in the background after a node is
// added, when the user opted in AND the proxy is running (the download goes
// through the node, since the rule-set host is GFW-blocked).
func (s *Service) maybeAutoUpdateRules() {
	s.mu.Lock()
	on := s.cfg.Settings.AutoUpdateRules
	running := s.core.Running() && s.core.Port() > 0
	s.mu.Unlock()
	if !on || !running {
		return
	}
	go func() {
		if msg := s.UpdateRuleSets(); msg != "" {
			s.log("[rules] 自动更新规则集失败: " + msg)
		} else {
			s.log("[rules] 已自动更新分流规则集")
		}
	}()
}
