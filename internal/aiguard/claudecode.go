package aiguard

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

// SetClaudeCodeQuiet adds the switch, leaving every other key and the
// formatting untouched. marker records that we added it, so Unset only removes
// our own value.
func SetClaudeCodeQuiet(path, marker string) error {
	raw, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if len(bytes.TrimSpace(raw)) > 0 && !gjson.ValidBytes(raw) {
		return errors.New("Claude Code 配置文件不是合法 JSON，不去改它")
	}
	if gjson.GetBytes(raw, claudeQuietKey).Exists() {
		return nil // the user's own value: leave it
	}
	doc := raw
	if len(bytes.TrimSpace(doc)) == 0 {
		doc = []byte("{}")
	}
	if doc, err = sjson.SetBytes(doc, claudeQuietKey, "1"); err != nil {
		return err
	}
	if err := os.WriteFile(marker, []byte("1\n"), 0o644); err != nil {
		return err
	}
	return writeFileAtomic(path, doc)
}

// UnsetClaudeCodeQuiet removes the switch if we added it and it is unchanged.
func UnsetClaudeCodeQuiet(path, marker string) error {
	if _, err := os.Stat(marker); err != nil {
		return nil
	}
	raw, err := os.ReadFile(path)
	if err == nil && gjson.GetBytes(raw, claudeQuietKey).String() == "1" {
		doc, derr := sjson.DeleteBytes(raw, claudeQuietKey)
		if derr != nil {
			return derr
		}
		if err := writeFileAtomic(path, doc); err != nil {
			return err
		}
	}
	return os.Remove(marker)
}

func writeFileAtomic(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".proxysplit-tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
