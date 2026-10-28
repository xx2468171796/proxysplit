package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestResolveChannel(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "channel")
	cases := []struct {
		name, account, exe, want string
		persist                  bool
	}{
		{"own site download, own account", "", `C:\Users\a\Downloads\proxysplit-latest.exe`, "", false},
		{"AI site installer", "", `C:\Users\a\Downloads\proxysplit-ai-latest (1).exe`, channelAIGW, true},
		{"AI site account", channelAIGW, `C:\Program Files\ProxySplit\proxysplit.exe`, channelAIGW, true},
		{"unknown channel from a newer server", "partner-x", `proxysplit.exe`, "", false},
	}
	for _, c := range cases {
		got, persist := resolveChannel(file, c.account, c.exe)
		if got != c.want || persist != c.persist {
			t.Errorf("%s: got %q/%v, want %q/%v", c.name, got, persist, c.want, c.persist)
		}
	}
	// Once marked, it sticks: logout (no account) and a renamed exe keep contacts hidden.
	if err := os.WriteFile(file, []byte("aigw\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got, persist := resolveChannel(file, "", `proxysplit.exe`); got != channelAIGW || persist {
		t.Fatalf("persisted marker ignored: %q/%v", got, persist)
	}
}

func TestAigwStartURL(t *testing.T) {
	got := aigwStartURL("https://lxc.5fskins.com/oauth/authorize?client_id=proxysplit&redirect_uri=http%3A%2F%2F127.0.0.1%3A5000%2Fcallback&state=s1")
	want := "https://lxc.5fskins.com/api/auth/aigw/start?next=%2Foauth%2Fauthorize%3Fclient_id%3Dproxysplit%26redirect_uri%3Dhttp%253A%252F%252F127.0.0.1%253A5000%252Fcallback%26state%3Ds1"
	if got != want {
		t.Fatalf("got %s want %s", got, want)
	}
	if u := "https://lxc.5fskins.com/portal"; aigwStartURL(u) != u {
		t.Fatal("non-authorize URLs must pass through unchanged")
	}
}

func TestDownloadTicket(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows 路径 / 行为")
	}
	tk := "Abc_-" + "x0123456789012345678901234567890123456789"[:38]
	if len(tk) != 43 {
		t.Fatalf("test ticket length %d", len(tk))
	}
	cases := map[string]string{
		`C:\Users\a\Downloads\proxysplit-ai-` + tk + `.exe`:      tk,
		`C:\Users\a\Downloads\proxysplit-ai-` + tk + ` (1).exe`:  tk, // browser de-dup suffix
		`C:\Users\a\Downloads\ProxySplit-AI-` + tk + `.EXE`:      tk,
		`C:\Users\a\Downloads\proxysplit-ai-latest.exe`:          "",
		`C:\Users\a\Downloads\proxysplit-ai-` + tk + `x.exe`:     "", // 44 chars
		`C:\Users\a\Downloads\proxysplit-ai-` + tk[:42] + `.exe`: "",
		`C:\Users\a\Downloads\proxysplit-latest.exe`:             "",
		`C:\Users\a\Downloads\my-proxysplit-ai-` + tk + `.exe`:   "",
	}
	for exe, want := range cases {
		if got := downloadTicket(exe); got != want {
			t.Errorf("%s: got %q want %q", exe, got, want)
		}
		if want != "" && !exeMarksAIGW(exe) {
			t.Errorf("%s: a ticketed download must also mark the AI-site channel", exe)
		}
	}
	file := filepath.Join(t.TempDir(), "download-ticket")
	if ticketTried(file, tk) {
		t.Fatal("nothing tried yet")
	}
	if err := os.WriteFile(file, []byte(ticketHash(tk)+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if !ticketTried(file, tk) || ticketTried(file, tk[:42]+"z") {
		t.Fatal("tried marker must match exactly this ticket")
	}
	raw, _ := os.ReadFile(file)
	if strings.Contains(string(raw), tk) {
		t.Fatal("only the hash is stored")
	}
}
