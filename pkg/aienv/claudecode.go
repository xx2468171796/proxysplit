package aienv

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"

	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

// claudeQuietKey is Claude Code's official switch for telemetry, error
// reporting and feedback upload (code.claude.com/docs/en/data-usage).
const claudeQuietKey = "env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"

// Absent is the snapshot of a setting that did not exist before (hosts pass
// it to Adopt for a setting they added themselves).
const Absent = "\x00absent"

const absent = Absent

// ClaudeSettingsPath is ~/.claude/settings.json (CLAUDE_CONFIG_DIR wins), the
// file the CLI and the VS Code extension read.
func ClaudeSettingsPath() string {
	if d := os.Getenv("CLAUDE_CONFIG_DIR"); d != "" {
		return filepath.Join(d, "settings.json")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".claude", "settings.json")
}

// ClaudeCodeQuiet reports whether the switch is on in path.
func ClaudeCodeQuiet(path string) bool {
	raw, err := os.ReadFile(path)
	return err == nil && gjson.GetBytes(raw, claudeQuietKey).String() == "1"
}

func claudeSnapshot(path string) string {
	raw, _ := os.ReadFile(path)
	if v := gjson.GetBytes(raw, claudeQuietKey); v.Exists() {
		return v.String()
	}
	return absent
}

// setClaudeKey sets (value != absent) or deletes the switch, leaving every
// other key and the formatting untouched.
func setClaudeKey(path, value string) error {
	raw, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if len(bytes.TrimSpace(raw)) > 0 && !gjson.ValidBytes(raw) {
		return errors.New("Claude Code 配置文件不是合法 JSON，不去改它")
	}
	if value == absent {
		if errors.Is(err, os.ErrNotExist) || !gjson.GetBytes(raw, claudeQuietKey).Exists() {
			return nil
		}
		doc, err := sjson.DeleteBytes(raw, claudeQuietKey)
		if err != nil {
			return err
		}
		return writeFileAtomic(path, doc)
	}
	doc := raw
	if len(bytes.TrimSpace(doc)) == 0 {
		doc = []byte("{}")
	}
	if doc, err = sjson.SetBytes(doc, claudeQuietKey, value); err != nil {
		return err
	}
	return writeFileAtomic(path, doc)
}

func writeFileAtomic(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".aienv-tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// claudeItem is shared by every platform (a plain JSON file).
var claudeItem = item{
	id: "claudecode", name: "Claude Code 遥测", target: "关闭",
	note: "官方开关 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC：关掉使用数据、错误上报和反馈上传，不影响正常使用（重开 Claude Code 生效）",
	current: func(m *Manager) string {
		if ClaudeCodeQuiet(m.claudePath()) {
			return "关闭"
		}
		return "开启（默认）"
	},
	done:     func(_ *Manager, cur string) bool { return cur == "关闭" },
	snapshot: func(m *Manager) string { return claudeSnapshot(m.claudePath()) },
	apply:    func(m *Manager) error { return setClaudeKey(m.claudePath(), "1") },
	restore:  func(m *Manager, orig string) error { return setClaudeKey(m.claudePath(), orig) },
}
