package aienv

import (
	"os"
	"path/filepath"
	"testing"
)

func testManager(t *testing.T) (*Manager, string) {
	dir := t.TempDir()
	m := New(filepath.Join(dir, "state.json"))
	m.ClaudeSettings = filepath.Join(dir, "settings.json")
	return m, m.ClaudeSettings
}

// Apply then Restore leaves the file byte-for-byte as it was, and the state
// file is gone.
func TestApplyRestoreRoundTrip(t *testing.T) {
	m, path := testManager(t)
	orig := "{\n  \"model\": \"opus\",\n  \"env\": {\"FOO\": \"bar\"}\n}\n"
	os.WriteFile(path, []byte(orig), 0o644)
	if err := m.Apply("claudecode"); err != nil {
		t.Fatal(err)
	}
	if !ClaudeCodeQuiet(path) || !m.Configured() {
		t.Fatal("not applied / not recorded")
	}
	// A second Apply must keep the first original (not record "1").
	if err := m.Apply("claudecode"); err != nil {
		t.Fatal(err)
	}
	if err := m.Restore(); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(path)
	if string(got) != orig {
		t.Fatalf("not restored byte-for-byte:\n%s", got)
	}
	if m.Configured() {
		t.Fatal("state left behind")
	}
}

// A value the user had before is put back, not deleted.
func TestRestoreKeepsUsersOwnValue(t *testing.T) {
	m, path := testManager(t)
	os.WriteFile(path, []byte(`{"env":{"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"0"}}`), 0o644)
	m.Apply("claudecode")
	if !ClaudeCodeQuiet(path) {
		t.Fatal("not applied")
	}
	m.Restore()
	if claudeSnapshot(path) != "0" {
		t.Fatalf("user's value lost: %q", claudeSnapshot(path))
	}
}

// No file before → no file content beyond {} after; invalid JSON is refused.
func TestClaudeEdgeCases(t *testing.T) {
	m, path := testManager(t)
	if err := m.Apply("claudecode"); err != nil {
		t.Fatal(err)
	}
	m.Restore()
	if ClaudeCodeQuiet(path) {
		t.Fatal("switch left after restore")
	}
	os.WriteFile(path, []byte(`{broken`), 0o644)
	if m.Apply("claudecode") == nil {
		t.Fatal("wrote into invalid JSON")
	}
}

// Every Windows item that changes something can be restored, except clock.
func TestItemsRestorable(t *testing.T) {
	for _, it := range items {
		if it.apply != nil && it.restore == nil && it.id != "clock" {
			t.Errorf("%s changes the PC but cannot be restored", it.id)
		}
		if it.restore != nil && it.snapshot == nil {
			t.Errorf("%s restores without a snapshot", it.id)
		}
	}
}
