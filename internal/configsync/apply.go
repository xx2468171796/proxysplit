package configsync

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"
)

// BackupFile holds the config as it was before the last import / restore so
// it can be undone once. It lives in the user data dir next to config.json.
const BackupFile = "config-before-import.json"

// Preview summarises a bundle for the confirm dialog.
type Preview struct {
	Name          string   `json:"name,omitempty"`
	Device        string   `json:"device"`
	ExportedAt    string   `json:"exportedAt"`
	Sections      []string `json:"sections"` // sections present in the bundle
	Nodes         int      `json:"nodes"`
	Subscriptions int      `json:"subscriptions"`
	Rules         int      `json:"rules"` // app rules + global custom rules
	Lines         int      `json:"lines"`
	ProxyPorts    int      `json:"proxyPorts"`
	HasSettings   bool     `json:"hasSettings"`
}

func section(b Bundle, sec string) obj {
	var m obj
	if raw, ok := b.Sections[sec]; ok {
		_ = json.Unmarshal(raw, &m)
	}
	return m
}

// PreviewOf counts what a bundle would restore.
func PreviewOf(b Bundle) Preview {
	p := Preview{Device: b.Device, ExportedAt: b.ExportedAt, Sections: []string{}}
	for _, sec := range AllSections {
		if _, ok := b.Sections[sec]; ok {
			p.Sections = append(p.Sections, sec)
		}
	}
	p.Nodes = len(list(section(b, SecNodes)["nodes"]))
	p.Subscriptions = len(list(section(b, SecSubs)["subs"]))
	rules := section(b, SecRules)
	p.Rules = len(list(rules["rules"])) + len(list(rules["customRules"]))
	p.Lines = len(list(rules["lines"]))
	p.ProxyPorts = len(list(section(b, SecProxyPorts)["proxyPorts"]))
	_, p.HasSettings = section(b, SecSettings)["settings"]
	return p
}

func wanted(sections []string, b Bundle) map[string]bool {
	if len(sections) == 0 {
		sections = AllSections
	}
	out := map[string]bool{}
	for _, s := range sections {
		if _, ok := b.Sections[s]; ok {
			out[s] = true
		}
	}
	return out
}

// Merge returns the live config with the chosen bundle sections laid over
// it. POWER云 lines and the POWER云 subscription of this machine are always
// kept; references to nodes that no longer exist fall back to defaults.
func Merge(current string, b Bundle, sections []string) (string, error) {
	cfg, err := decodeConfig(current)
	if err != nil {
		return "", err
	}
	want := wanted(sections, b)
	if len(want) == 0 {
		return "", errors.New("请至少选择一项要恢复的内容")
	}
	manual, subNodes, account := split(cfg)
	if want[SecNodes] {
		in := section(b, SecNodes)
		manual = list(in["nodes"])
		if sel, ok := in["selectedId"].(string); ok && sel != "" {
			cfg["selectedId"] = sel
		}
	}
	if want[SecSubs] {
		in := section(b, SecSubs)
		subs := list(in["subs"])
		for _, s := range list(cfg["subs"]) {
			if str(s, "url") == officialSubURL {
				subs = append(subs, s)
			}
		}
		cfg["subs"] = toAny(subs)
		subNodes = list(in["nodes"])
	}
	for sec, keys := range sectionKeys {
		if !want[sec] {
			continue
		}
		in := section(b, sec)
		for _, k := range keys {
			if v, ok := in[k]; ok {
				cfg[k] = v
			} else {
				delete(cfg, k)
			}
		}
	}
	cfg["nodes"] = toAny(dedupe(append(append(manual, subNodes...), account...)))
	fixReferences(cfg)
	raw, err := json.MarshalIndent(cfg, "", "  ")
	return string(raw), err
}

func dedupe(nodes []obj) []obj {
	seen := map[string]bool{}
	out := make([]obj, 0, len(nodes))
	for _, n := range nodes {
		id := str(n, "id")
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, n)
	}
	return out
}

// fixReferences resets pointers to nodes that are not in this config (for
// example a POWER云 line of another account) instead of failing the import.
func fixReferences(cfg obj) {
	ids := map[string]bool{}
	for _, n := range list(cfg["nodes"]) {
		ids[str(n, "id")] = true
	}
	if sel := str(cfg, "selectedId"); sel != "" && !ids[sel] {
		cfg["selectedId"] = ""
	}
	for _, n := range list(cfg["nodes"]) {
		if via := str(n, "via"); via != "" && !ids[via] {
			delete(n, "via")
		}
	}
	for _, l := range list(cfg["lines"]) {
		if node := str(l, "node"); node != "" && node != "active" && node != "direct" && !ids[node] {
			l["node"] = "active"
		}
	}
	for _, key := range []string{"rules", "proxyPorts"} {
		for _, r := range list(cfg[key]) {
			if node := str(r, "node"); node != "" && !ids[node] {
				r["node"] = ""
			}
		}
	}
}

// Apply backs the live config up (for one-step undo) and applies the chosen
// sections of b.
func Apply(store Store, dir string, b Bundle, sections []string) error {
	current, err := store.ExportAll()
	if err != nil {
		return err
	}
	merged, err := Merge(current, b, sections)
	if err != nil {
		return err
	}
	if err := writeFileAtomic(filepath.Join(dir, BackupFile), []byte(current)); err != nil {
		return errors.New("备份当前配置失败，已取消导入：" + err.Error())
	}
	return store.ImportAll(merged)
}

// CanUndo reports whether an import backup exists and when it was taken.
func CanUndo(dir string) (bool, string) {
	info, err := os.Stat(filepath.Join(dir, BackupFile))
	if err != nil {
		return false, ""
	}
	return true, info.ModTime().Format(time.RFC3339)
}

// Undo restores the config saved by the last Apply and removes the backup.
func Undo(store Store, dir string) error {
	path := filepath.Join(dir, BackupFile)
	raw, err := os.ReadFile(path)
	if err != nil {
		return errors.New("没有可以撤销的导入")
	}
	if err := store.ImportAll(string(raw)); err != nil {
		return err
	}
	return os.Remove(path)
}

func writeFileAtomic(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
