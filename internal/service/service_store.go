package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"proxysplit/internal/core"
	"proxysplit/internal/engine"
)

func (s *Service) configPath() string { return filepath.Join(s.dataDir, "config.json") }

// altConfigPath is a redundant copy of the config kept next to the .exe, so the
// user's nodes/rules survive even if %APPDATA% is wiped by a cleaner tool. It is
// best-effort: "" when the exe dir can't be determined; writes are ignored if
// the folder is read-only (e.g. Program Files).
func (s *Service) altConfigPath() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	// `go test` runs every case from the same temporary *.test executable.
	// Writing a portable backup beside that binary leaks one test's nodes into
	// the next test's otherwise-isolated dataDir.  Production binaries never use
	// this suffix, so disable the exe-adjacent store only for test executables.
	if strings.HasSuffix(strings.ToLower(filepath.Base(exe)), ".test.exe") ||
		strings.HasSuffix(strings.ToLower(filepath.Base(exe)), ".test") {
		return ""
	}
	return filepath.Join(filepath.Dir(exe), "proxysplit-data.json")
}

// isCoreConfig reports whether data is a sing-box config (which has outbounds /
// inbounds) rather than the app config — a guard against ever loading a file the
// core clobbered into place.
func isCoreConfig(data []byte) bool {
	// Top-level keys only: stored raw nodes (POWER云 / imported groups) carry
	// their own "outbounds" inside "nodes" and must not look like a core config.
	var top map[string]json.RawMessage
	if json.Unmarshal(data, &top) != nil {
		return bytes.Contains(data, []byte(`"outbounds"`)) || bytes.Contains(data, []byte(`"inbounds"`))
	}
	_, ob := top["outbounds"]
	_, ib := top["inbounds"]
	return ob || ib
}

func decodeAppConfig(data []byte) (Config, bool) {
	var cfg Config
	if len(data) == 0 || !json.Valid(data) || isCoreConfig(data) || json.Unmarshal(data, &cfg) != nil {
		return Config{}, false
	}
	return cfg, true
}

func (s *Service) load() {
	// Read the main config; if it is missing, corrupt, or was clobbered by the
	// core's sing-box config (a past bug wrote it here), fall back to the last
	// known-good backup so the user's nodes/rules are never lost.
	data, err := os.ReadFile(s.configPath())
	decoded, ok := decodeAppConfig(data)
	bad := err != nil || !ok
	if bad {
		// Recovery chain: .bak (same dir) → the redundant copy next to the exe.
		recovered := false
		if bak, berr := os.ReadFile(s.configPath() + ".bak"); berr == nil {
			if candidate, valid := decodeAppConfig(bak); valid {
				data = bak
				decoded = candidate
				s.log("[store] 主配置异常,已从备份恢复节点/规则")
				if werr := os.WriteFile(s.configPath(), bak, 0o600); werr != nil {
					s.log("[config] 写回从备份恢复的主配置失败: " + werr.Error())
				}
				recovered = true
			}
		}
		if !recovered {
			if alt := s.altConfigPath(); alt != "" {
				if ad, aerr := os.ReadFile(alt); aerr == nil {
					if candidate, valid := decodeAppConfig(ad); valid {
						data = ad
						decoded = candidate
						s.log("[store] 从 exe 旁的备份 proxysplit-data.json 恢复节点/规则")
						if werr := os.WriteFile(s.configPath(), ad, 0o600); werr != nil {
							s.log("[config] 写回从 exe 旁备份恢复的主配置失败: " + werr.Error())
						}
						recovered = true
					}
				}
			}
		}
		if !recovered {
			data = nil // nothing usable — start clean rather than importing junk
		}
	}
	if len(data) > 0 {
		s.cfg = decoded
	}
	// Defaults / migration.
	if s.cfg.LogLevel == "" {
		s.cfg.LogLevel = "info"
	}
	if s.cfg.RuleMode == "" {
		// 只代理列出的 — what the UI recommends; 默认全走代理 is opt-in.
		s.cfg.RuleMode = engine.ModeWhitelist
	}
	if s.cfg.DefaultLine == "" {
		s.cfg.DefaultLine = LineRule
	}
	s.cfg.RuleSets = normalizeRuleSetConfig(s.cfg.RuleSets)
	if s.cfg.Settings.Theme == "" {
		s.cfg.Settings = defaultSettings()
	}
	// Existing v1.8.2 configs predate this field. Opt them into startup checks
	// while still preserving an explicit false saved by newer versions.
	if len(data) == 0 || !bytes.Contains(data, []byte(`"autoUpdateApp"`)) {
		s.cfg.Settings.AutoUpdateApp = true
	}
	// Legacy string apps -> rules.
	if len(s.cfg.Rules) == 0 && len(s.cfg.Apps) > 0 {
		def := LineGlobal
		if s.cfg.Routing.Enabled && s.cfg.Routing.Mode == core.RouteBypassCN {
			def = LineRule
		}
		for _, a := range s.cfg.Apps {
			s.cfg.Rules = append(s.cfg.Rules, AppRule{Match: a, Path: a, Line: def, Enabled: true})
		}
		s.cfg.Apps = nil
	}
	// Migrate legacy action/follow rules to lines.
	for i := range s.cfg.Rules {
		migrateRuleLocked(&s.cfg.Rules[i], s.cfg.Routing)
	}
	// Never resurrect design-preview endpoints from an old/hand-edited backup.
	// The desktop client has no built-in nodes: every displayed node must have
	// come from the user's import, subscription, or manual entry.
	placeholdersDropped := s.dropPlaceholderNodesLocked()
	refsHealed := s.healDanglingNodeRefsLocked()
	probeMigrated := false
	if s.cfg.ConnectivityProbeVersion < 2 {
		for _, n := range s.cfg.Nodes {
			if n != nil {
				n.Latency = 0
				n.TCPLatency = 0
			}
		}
		s.cfg.ConnectivityProbeVersion = 2
		probeMigrated = true
	}
	if placeholdersDropped || refsHealed || probeMigrated {
		s.save()
	}
}

// dropPlaceholderNodesLocked removes only IANA documentation endpoints. They
// cannot be real proxy servers and were used solely by historic UI prototypes
// (for example jp01.example.net). The caller must hold s.mu when the service is
// already live; load calls it before the service becomes concurrent.
func (s *Service) dropPlaceholderNodesLocked() bool {
	kept := s.cfg.Nodes[:0]
	removed := false
	selectedStillPresent := false
	for _, n := range s.cfg.Nodes {
		if n == nil || isPlaceholderEndpoint(n.Server) {
			removed = true
			continue
		}
		kept = append(kept, n)
		if n.ID == s.cfg.SelectedID {
			selectedStillPresent = true
		}
	}
	s.cfg.Nodes = kept
	if !selectedStillPresent && s.cfg.SelectedID != AutoNodeID {
		s.cfg.SelectedID = ""
		if len(kept) > 0 {
			s.cfg.SelectedID = kept[0].ID
		}
	}
	return removed
}

func isPlaceholderEndpoint(server string) bool {
	host := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(server)), ".")
	for _, domain := range []string{"example.com", "example.net", "example.org", "example.edu"} {
		if host == domain || strings.HasSuffix(host, "."+domain) {
			return true
		}
	}
	return false
}

// save writes the config atomically via persistLocked (snapshot the current good
// file to <config>.bak, write a temp file, rename it over the live file — an
// atomic op on the same volume). A crash mid-write leaves the old config intact.
// It is best effort: failures are logged, not returned. Caller holds s.mu.
func (s *Service) save() {
	if err := s.persistLocked(); err != nil {
		s.log("[store] 保存配置失败: " + err.Error())
	}
}

// persistLocked writes the config and returns any error. save() wraps it as best
// effort; configuration restore calls it directly, since an import must never
// claim success unless the new snapshot is already durable on disk. Caller holds
// s.mu. The current valid app-config file (never a core-config, so .bak always
// holds real nodes/rules) is snapshotted first; the copy next to the exe is
// best-effort (read-only folders are ignored).
func (s *Service) persistLocked() error {
	data, err := json.MarshalIndent(&s.cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("serialize config: %w", err)
	}
	path := s.configPath()
	if cur, rerr := os.ReadFile(path); rerr == nil && json.Valid(cur) && !isCoreConfig(cur) {
		// The .bak is only a recovery aid: failing to refresh it must not stop
		// the user's change from being saved (it never did before the split).
		if err := os.WriteFile(path+".bak", cur, 0o600); err != nil {
			s.log("[store] 刷新配置备份失败（不影响保存）: " + err.Error())
		}
	}
	tmp := path + ".import.tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return fmt.Errorf("write imported config: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("activate imported config: %w", err)
	}
	if alt := s.altConfigPath(); alt != "" {
		_ = os.WriteFile(alt, data, 0o600)
	}
	return nil
}
