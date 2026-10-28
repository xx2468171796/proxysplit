package configsync

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// BackupFile holds the config as it was before the last manual import /
// restore so it can be undone once. It lives in the user data dir next to
// config.json.
const BackupFile = "config-before-import.json"

// SyncBackupFile holds the config as it was before the last automatic cloud
// pull (only the latest one is kept). Auto-sync never touches BackupFile, so
// a background pull cannot wipe the undo of a manual import.
const SyncBackupFile = "config-before-sync.json"

// mergeMode tells Merge where the bundle comes from.
type mergeMode int

const (
	// modeImport: manual file / cloud-profile / share import. The bundle's
	// selected node is applied when it exists on this machine.
	modeImport mergeMode = iota
	// modeSync: automatic cloud sync. The selected node is per machine and
	// never synced: this machine's selection always stays.
	modeSync
)

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
	return merge(current, b, sections, modeImport)
}

func merge(current string, b Bundle, sections []string, mode mergeMode) (string, error) {
	cfg, err := decodeConfig(current)
	if err != nil {
		return "", err
	}
	prev, _ := decodeConfig(current) // untouched copy: this machine's references
	want := wanted(sections, b)
	if len(want) == 0 {
		return "", errors.New("请至少选择一项要恢复的内容")
	}
	manual, subNodes, account := split(cfg)
	if want[SecNodes] {
		in := section(b, SecNodes)
		manual = list(in["nodes"])
		if sel, ok := in["selectedId"].(string); ok && sel != "" && mode == modeImport {
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
	fixReferences(cfg, prev)
	raw, err := json.MarshalIndent(cfg, "", "  ")
	return string(raw), err
}

// refKey identifies the same line / rule / proxy port across machines.
func refKey(kind string, i int, m obj) string {
	if id := str(m, "id"); id != "" {
		return kind + "#" + id
	}
	if match := str(m, "match"); match != "" {
		return kind + "@" + match
	}
	return fmt.Sprintf("%s[%d]", kind, i)
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

// fixReferences repairs pointers to nodes that are not in this config. The
// usual cause is a POWER云 official / account line of the exporting machine
// (those never travel in a bundle): the same line / rule / proxy port then
// keeps the value it had on this machine (prev) when that still points at an
// existing node — typically this machine's own POWER云 line — and only
// otherwise falls back to the default instead of failing the import.
func fixReferences(cfg, prev obj) {
	ids := map[string]bool{}
	for _, n := range list(cfg["nodes"]) {
		ids[str(n, "id")] = true
	}
	local := map[string]string{}
	for _, key := range []string{"lines", "rules", "proxyPorts"} {
		for i, m := range list(prev[key]) {
			local[refKey(key, i, m)] = str(m, "node")
		}
	}
	keepLocal := func(key string, i int, m obj, fallback string) {
		if node := str(m, "node"); node == "" || ids[node] || (key == "lines" && (node == "active" || node == "direct")) {
			return
		}
		if v, ok := local[refKey(key, i, m)]; ok && (ids[v] || (key == "lines" && (v == "active" || v == "direct"))) {
			m["node"] = v
			return
		}
		m["node"] = fallback
	}
	if sel := str(cfg, "selectedId"); sel != "" && !ids[sel] {
		if old := str(prev, "selectedId"); ids[old] {
			cfg["selectedId"] = old
		} else {
			cfg["selectedId"] = ""
		}
	}
	for _, n := range list(cfg["nodes"]) {
		if via := str(n, "via"); via != "" && !ids[via] {
			delete(n, "via")
		}
	}
	for i, l := range list(cfg["lines"]) {
		keepLocal("lines", i, l, "active")
	}
	for _, key := range []string{"rules", "proxyPorts"} {
		for i, r := range list(cfg[key]) {
			keepLocal(key, i, r, "")
		}
	}
}

// Apply backs the live config up (for one-step undo) and applies the chosen
// sections of b (manual import / cloud profile / share code).
func Apply(store Store, dir string, b Bundle, sections []string) error {
	return apply(store, filepath.Join(dir, BackupFile), b, sections, modeImport)
}

// ApplySync applies a cloud-sync copy: backup in SyncBackupFile (the manual
// import undo stays intact) and this machine's selected node is kept.
func ApplySync(store Store, dir string, b Bundle) error {
	return apply(store, filepath.Join(dir, SyncBackupFile), b, nil, modeSync)
}

func apply(store Store, backup string, b Bundle, sections []string, mode mergeMode) error {
	current, err := store.ExportAll()
	if err != nil {
		return err
	}
	merged, err := merge(current, b, sections, mode)
	if err != nil {
		return err
	}
	if err := writeFileAtomic(backup, []byte(current)); err != nil {
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
