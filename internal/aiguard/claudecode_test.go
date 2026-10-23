package aiguard

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Set adds only our key; Unset removes only what we added.
func TestClaudeCodeQuiet(t *testing.T) {
	dir := t.TempDir()
	path, marker := filepath.Join(dir, "settings.json"), filepath.Join(dir, "marker")
	orig := "{\n  \"model\": \"opus\",\n  \"env\": {\"FOO\": \"bar\"}\n}\n"
	os.WriteFile(path, []byte(orig), 0o644)
	if err := SetClaudeCodeQuiet(path, marker); err != nil {
		t.Fatal(err)
	}
	if !ClaudeCodeQuiet(path) {
		t.Fatal("switch not set")
	}
	if err := UnsetClaudeCodeQuiet(path, marker); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(path)
	if ClaudeCodeQuiet(path) || !strings.Contains(string(got), `"FOO": "bar"`) || !strings.Contains(string(got), `"model": "opus"`) {
		t.Fatalf("restore changed other keys:\n%s", got)
	}

	// The user's own value is never touched.
	os.WriteFile(path, []byte(`{"env":{"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1"}}`), 0o644)
	SetClaudeCodeQuiet(path, marker)
	UnsetClaudeCodeQuiet(path, marker)
	if !ClaudeCodeQuiet(path) {
		t.Fatal("removed the user's own setting")
	}

	// Invalid JSON: refuse.
	os.WriteFile(path, []byte(`{broken`), 0o644)
	if SetClaudeCodeQuiet(path, marker) == nil {
		t.Fatal("wrote into invalid JSON")
	}
}
