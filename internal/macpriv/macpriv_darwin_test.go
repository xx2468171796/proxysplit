package macpriv

import (
	"encoding/json"
	"fmt"
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
		`{"log":{"Output":"/etc/x"}}`,
		`{"ſervices":[]}`,
		`{"log":{"OUTPUT":"/etc/x"}}`,
		`{"ntp":{"enabled":true,"write_to_system":true}}`,
	} {
		if _, err := check(bad); err == nil {
			t.Fatalf("accepted %s", bad)
		}
	}
}

// TestCtlRun runs psctl (relocated into a temp dir, fake core) as the caller:
// the config is copied, checked, the cache path rewritten and the core runs in
// the caller's directory; symlinked and rejected configs never reach the core.
func TestCtlRun(t *testing.T) {
	d := t.TempDir()
	ctl := filepath.Join(d, "psctl")
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(os.WriteFile(ctl, []byte(strings.ReplaceAll(ctlScript, Dir, d)), 0o755))
	must(os.WriteFile(filepath.Join(d, "check.js"), []byte(checkJS), 0o644))
	must(os.WriteFile(filepath.Join(d, "sing-box"), []byte("#!/bin/sh\necho \"core $* in $PWD\"\n"), 0o755))
	work := t.TempDir()
	run := func(cfg string) (string, error) {
		cmd := exec.Command(ctl, "run", cfg)
		cmd.Dir = work
		cmd.Env = append(os.Environ(), fmt.Sprintf("SUDO_UID=%d", os.Getuid()))
		out, err := cmd.CombinedOutput()
		return string(out), err
	}
	good := filepath.Join(work, "good.json")
	must(os.WriteFile(good, []byte(`{"experimental":{"cache_file":{"path":"x.db"}}}`), 0o600))
	out, err := run(good)
	if err != nil || !strings.Contains(out, "core run -c "+d+"/run.json in ") || !strings.HasSuffix(strings.TrimSpace(out), filepath.Base(work)) {
		t.Fatalf("good config: %v %q", err, out)
	}
	raw, _ := os.ReadFile(filepath.Join(d, "run.json"))
	if !strings.Contains(string(raw), d+"/cache.db") {
		t.Fatalf("cache path not rewritten: %s", raw)
	}
	bad := filepath.Join(work, "bad.json")
	must(os.WriteFile(bad, []byte(`{"log":{"Output":"/tmp/x"}}`), 0o600))
	if out, err := run(bad); err == nil || strings.Contains(out, "core run") {
		t.Fatalf("bad config ran: %q", out)
	}
	link := filepath.Join(work, "link.json")
	must(os.Symlink(good, link))
	if out, err := run(link); err == nil || strings.Contains(out, "core run") {
		t.Fatalf("symlink config ran: %q", out)
	}
}
