package appid

import (
	"runtime"
	"testing"
)

func TestDiscoverLDPlayer(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows 路径 / 行为")
	}
	env := Env{
		Installed: []Installed{
			{Name: "雷电模拟器14", Dir: DirOf(`D:\LDPlayer\LDPlayer14\dnuninst.exe`)},
			{Name: "Google Chrome", Dir: `C:\Program Files\Google\Chrome\Application`},
		},
		ProgramFiles: []string{`C:\Program Files`},
		Exists:       func(d string) bool { return d == `C:\Program Files\ldplayer9box` },
		Running:      []string{`C:\Program Files\ldplayer9box\VBoxNetNAT.exe`, `E:\Portable\MEmu\MEmuHeadless.exe`},
	}
	got := map[string][]string{}
	for _, a := range Discover(Builtin(), env) {
		got[a.ID] = a.Dirs
	}
	ld := got["emu-ldplayer"]
	if len(ld) != 2 || ld[0] != `C:\Program Files\ldplayer9box\` || ld[1] != `D:\LDPlayer\LDPlayer14\` {
		t.Fatalf("ldplayer dirs = %v", ld)
	}
	if m := got["emu-memu"]; len(m) != 1 || m[0] != `E:\Portable\MEmu\` {
		t.Fatalf("memu (running, portable) dirs = %v", m)
	}
	if len(got["emu-mumu"]) != 0 || len(got["emu-bluestacks"]) != 0 {
		t.Fatalf("false positives: %v", got)
	}
}

func TestDirOf(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows 路径 / 行为")
	}
	for in, want := range map[string]string{
		`"D:\LDPlayer\LDPlayer14\dnuninst.exe" /S`: `D:\LDPlayer\LDPlayer14`,
		`C:\Apps\x.exe,0`:                          `C:\Apps`,
		`MsiExec.exe /X{123}`:                      ``,
	} {
		if got := DirOf(in); got != want {
			t.Errorf("DirOf(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestNormalizeCustomDirs(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows 路径 / 行为")
	}
	got, err := NormalizeCustom([]App{{Name: "手游助手", Dirs: []string{` D:\Games\Helper `}}})
	if err != nil || got[0].Dirs[0] != `D:\Games\Helper\` || len(got[0].Processes) != 0 {
		t.Fatalf("got %+v err %v", got, err)
	}
	for _, bad := range []string{`D:\`, `relative\dir`, `C:\a*b`} {
		if _, err := NormalizeCustom([]App{{Name: "x", Dirs: []string{bad}}}); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
}

func TestDetectNoFalsePositives(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows 路径 / 行为")
	}
	env := Env{Installed: []Installed{
		{Name: "Memurai Developer", Dir: `C:\Program Files\Memurai`},
		{Name: "NoxAudit Tool", Dir: `C:\Tools\NoxAudit`},
		{Name: "Remumble", Dir: `C:\Tools\Remumble`},
		{Name: "Some MSI App", Dir: `C:\Windows\Installer\{1234}`},
	}}
	for _, a := range Discover(Builtin(), env) {
		if len(a.Dirs) != 0 {
			t.Errorf("%s matched %v", a.Name, a.Dirs)
		}
	}
	env.Installed = []Installed{{Name: "MEmu", Dir: `D:\Microvirt\MEmu`}, {Name: "NoxPlayer", Dir: `D:\Nox\bin`}, {Name: "MuMu模拟器12", Dir: `D:\MuMu Player 12`}}
	found := 0
	for _, a := range Discover(Builtin(), env) {
		found += len(a.Dirs)
	}
	if found != 3 {
		t.Errorf("real emulators found %d of 3", found)
	}
}

func TestCheckDir(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows 路径 / 行为")
	}
	t.Setenv("SystemRoot", `C:\Windows`)
	t.Setenv("ProgramFiles", `C:\Program Files`)
	SetProtected(`D:\Apps\ProxySplit`, `D:\Apps\ProxySplit\bin`)
	defer SetProtected()
	for _, bad := range []string{`C:\Windows\`, `C:\Windows\System32\`, `C:\Program Files\`, `D:\`, `D:\Apps\`, `relative\x\`} {
		if _, err := CheckDir(bad); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
	if d, err := CheckDir(`%ProgramFiles%\ldplayer9box`); err != nil || d != `C:\Program Files\ldplayer9box\` {
		t.Errorf("env folder = %q, %v", d, err)
	}
}

func TestHostsOrder(t *testing.T) {
	log := []Access{
		{Host: "quic", Status: StatusBlocked}, {Host: "quic", Status: StatusBlocked}, {Host: "quic", Status: StatusBlocked},
		{Host: "ok.com", Status: StatusOK},
		{Host: "bad.com", Status: StatusFailed, Reason: "timeout"},
	}
	h := Hosts(log)
	if h[0].Host != "bad.com" || h[1].Host != "ok.com" || h[2].Host != "quic" {
		t.Fatalf("order = %s %s %s", h[0].Host, h[1].Host, h[2].Host)
	}
}
