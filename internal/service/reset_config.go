package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	"proxysplit/internal/engine"
)

// Config resets of the reset center. They only rewrite config.json (Config);
// the AI hijack switch (<数据目录>/ai-hijack), its NRPT lock, aienv-state.json,
// the license / device identity and the account live in other files and are
// never touched here. Every config reset writes a backup first so it can be
// undone (UndoReset).

const resetBackupKeep = 5

func (s *Service) resetBackupDir() string { return filepath.Join(s.dataDir, "backups") }

// backupBeforeReset writes the full config to backups/reset-<time>.json and
// keeps only the newest resetBackupKeep files.
func (s *Service) backupBeforeReset() (string, error) {
	data, err := s.ExportAll()
	if err != nil {
		return "", err
	}
	dir := s.resetBackupDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	now := time.Now()
	stamp := fmt.Sprintf("reset-%s-%03d", now.Format("20060102-150405"), now.Nanosecond()/1e6) // sortable
	// Two resets in the same millisecond must not overwrite each other's backup:
	// a numbered suffix keeps them apart and still sorts after the plain name.
	var name string
	for i := 0; ; i++ {
		name = stamp + ".json"
		if i > 0 {
			name = fmt.Sprintf("%s_%02d.json", stamp, i) // "_" sorts after "."
		}
		f, err := os.OpenFile(filepath.Join(dir, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if os.IsExist(err) && i < 99 {
			continue
		}
		if err != nil {
			return "", err
		}
		_, werr := f.WriteString(data)
		if cerr := f.Close(); werr == nil {
			werr = cerr
		}
		if werr != nil {
			return "", werr
		}
		break
	}
	s.pruneResetBackups()
	return name, nil
}

func (s *Service) resetBackups() []string {
	list, _ := filepath.Glob(filepath.Join(s.resetBackupDir(), "reset-*.json"))
	sort.Strings(list) // timestamped names: lexical = chronological
	return list
}

func (s *Service) pruneResetBackups() {
	list := s.resetBackups()
	for i := 0; i < len(list)-resetBackupKeep; i++ {
		_ = os.Remove(list[i])
	}
}

// LastResetBackup returns the newest backup's file name ("" = none).
func (s *Service) LastResetBackup() string {
	list := s.resetBackups()
	if len(list) == 0 {
		return ""
	}
	return filepath.Base(list[len(list)-1])
}

// UndoReset restores the newest reset backup and removes it, so pressing
// 撤销 again steps one reset further back. Running proxy ports follow.
func (s *Service) UndoReset() (string, error) {
	list := s.resetBackups()
	if len(list) == 0 {
		return "", errors.New("没有可撤销的重置")
	}
	path := list[len(list)-1]
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	running := s.runningPortIDs()
	if err := s.ImportAll(string(data)); err != nil { // ImportAll re-applies the core
		return "", fmt.Errorf("恢复备份失败：%w", err)
	}
	_ = os.Remove(path)
	for _, id := range running {
		s.stopPort(id)
	}
	s.startPorts(s.enabledPortIDs())
	s.log("[reset] 已撤销上一次重置（" + filepath.Base(path) + "）")
	return filepath.Base(path), nil
}

func (s *Service) enabledPortIDs() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	var ids []string
	for _, p := range s.cfg.ProxyPorts {
		if p.Enabled {
			ids = append(ids, p.ID)
		}
	}
	return ids
}

func applyMsg(err error, ok string) (string, error) {
	if err != nil {
		return "", fmt.Errorf("已重置，但重新应用到内核失败：%w", err)
	}
	return ok, nil
}

func (s *Service) resetNodeCores(context.Context) (string, error) {
	s.mu.Lock()
	n := 0
	for _, nd := range s.cfg.Nodes {
		if nd != nil && nd.Core != "" {
			nd.Core = ""
			n++
		}
	}
	if n > 0 {
		s.save()
	}
	s.mu.Unlock()
	if n == 0 {
		return "所有节点本来就是自动", nil
	}
	ports := s.runningPortIDs()
	err := s.applyLive()
	s.startPorts(ports)
	return applyMsg(err, fmt.Sprintf("%d 个节点改回自动", n))
}

func (s *Service) resetRouting(context.Context) (string, error) {
	s.mu.Lock()
	s.cfg.RuleMode = engine.ModeWhitelist
	s.cfg.DefaultLine = LineRule
	s.cfg.ClashMode = "rule"
	s.clashMode = "rule"
	s.cfg.Routing = Routing{}
	s.cfg.CustomRules = nil
	s.cfg.RuleSets = normalizeRuleSetConfig(nil)
	s.save()
	s.mu.Unlock()
	return applyMsg(s.applyLive(), "分流设置已恢复默认")
}

func (s *Service) resetAppRules(context.Context) (string, error) {
	s.mu.Lock()
	n := len(s.cfg.Rules)
	s.cfg.Rules = nil
	s.save()
	s.mu.Unlock()
	return applyMsg(s.applyLive(), fmt.Sprintf("已删除 %d 条应用规则", n))
}

// resetAllSettings restores every setting to its default while keeping nodes,
// subscriptions, proxy ports and custom apps (the old 「重置为默认配置」).
func (s *Service) resetAllSettings(context.Context) (string, error) {
	s.mu.Lock()
	old := s.cfg
	def := defaultSettings()
	def.Autostart = old.Settings.Autostart // the scheduled task is not touched: keep the flag truthful
	s.cfg = Config{
		Nodes: old.Nodes, Subs: old.Subs, SelectedID: old.SelectedID,
		ProxyPorts: old.ProxyPorts, CustomApps: old.CustomApps,
		Settings: def, RuleMode: engine.ModeWhitelist, DefaultLine: LineRule,
		LogLevel: "info", ClashMode: "rule", RuleSets: normalizeRuleSetConfig(nil),
		CorePort: old.CorePort, ConnectivityProbeVersion: old.ConnectivityProbeVersion,
		SysProxyLast: old.SysProxyLast, APIToken: old.APIToken,
	}
	s.clashMode = "rule"
	s.save()
	s.mu.Unlock()
	s.log("[store] 已重置为默认配置(保留了节点、订阅与端口代理)")
	return applyMsg(s.applyLive(), "全部设置已恢复默认（节点与订阅已保留）")
}

// resetFactory wipes the whole config. The proxy is stopped through the normal
// Stop path first, which locks AI before the core goes away (lockAIBeforeStop),
// so the AI hijack lock is never released by a factory reset.
func (s *Service) resetFactory(context.Context) (string, error) {
	running := s.runningPortIDs()
	for _, id := range running {
		s.stopPort(id)
	}
	wasRunning := s.core.Running()
	if wasRunning {
		s.Stop()
	}
	s.mu.Lock()
	old := s.cfg
	def := defaultSettings()
	def.Autostart = old.Settings.Autostart
	s.cfg = Config{
		Settings: def, RuleMode: engine.ModeWhitelist, DefaultLine: LineRule,
		LogLevel: "info", ClashMode: "rule", RuleSets: normalizeRuleSetConfig(nil),
		ConnectivityProbeVersion: old.ConnectivityProbeVersion,
		SysProxyLast:             old.SysProxyLast, APIToken: old.APIToken,
	}
	s.clashMode = "rule"
	s.save()
	s.mu.Unlock()
	s.log("[store] 已恢复出厂配置（账号、授权与 AI 劫持状态保留）")
	if wasRunning {
		return "已恢复出厂，代理已停止；请重新添加节点", nil
	}
	return "已恢复出厂；请重新添加节点", nil
}
