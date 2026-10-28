package macpriv

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestScriptHasNoFormatErrors(t *testing.T) {
	s, err := Script("bob", "/Users/bob/Library/Application Support/proxysplit/bin/sing-box")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(s, "%!") || !strings.Contains(s, "put sing-box 755 < '/Users/bob/") {
		t.Fatalf("bad install script:\n%s", s)
	}
	if _, err := Script("bob;rm", "/x"); err == nil {
		t.Fatal("bad username accepted")
	}
	if _, err := Script("bob", "/x'y"); err == nil {
		t.Fatal("quote in core path accepted")
	}
}

// checkJS runs under osascript as root before every TUN start.
func TestCheckJS(t *testing.T) {
	dir := t.TempDir()
	js := filepath.Join(dir, "check.js")
	if err := os.WriteFile(js, []byte(checkJS), 0o644); err != nil {
		t.Fatal(err)
	}
	check := func(cfg string) (map[string]any, error) {
		p := filepath.Join(dir, "run.json")
		if err := os.WriteFile(p, []byte(cfg), 0o600); err != nil {
			t.Fatal(err)
		}
		if out, err := exec.Command("osascript", "-l", "JavaScript", js, p, "/root/cache.db").CombinedOutput(); err != nil {
			return nil, &exec.ExitError{Stderr: out}
		}
		raw, _ := os.ReadFile(p)
		var m map[string]any
		return m, json.Unmarshal(raw, &m)
	}
	m, err := check(`{"log":{"level":"info"},"route":{"rule_set":[{"type":"local","path":"rules/a.json"}]},"experimental":{"cache_file":{"enabled":true,"path":"/Users/x/evil","store_dns":true}},"n":null}`)
	if err != nil {
		t.Fatal(err)
	}
	if p := m["experimental"].(map[string]any)["cache_file"].(map[string]any)["path"]; p != "/root/cache.db" {
		t.Fatalf("cache path = %v", p)
	}
	for _, bad := range []string{
		`{"log":{"output":"/etc/x"}}`,
		`{"experimental":{"clash_api":{"external_ui":"/etc"}}}`,
		`{"endpoints":[{"type":"tailscale","state_directory":"/etc"}]}`,
		`{"services":[]}`,
	} {
		if _, err := check(bad); err == nil {
			t.Fatalf("accepted %s", bad)
		}
	}
}
