package autostart

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
)

// The task XML is accepted by the real Task Scheduler and comes out with the
// settings that matter: highest privileges, tray start, battery-proof, no
// time limit. Registered under a throwaway name (logon trigger: never runs
// during the test) and deleted afterwards.
func TestTaskXMLRegisters(t *testing.T) {
	if _, err := exec.LookPath("schtasks.exe"); err != nil {
		t.Skip("no Task Scheduler")
	}
	name := fmt.Sprintf("ProxySplit-test-%d", os.Getpid())
	exe := `C:\Program Files\Pro & Split\proxysplit.exe` // needs XML escaping
	if err := createTask(name, exe); err != nil {
		if strings.Contains(err.Error(), "Access is denied") || strings.Contains(err.Error(), "拒绝访问") {
			t.Skip("needs an elevated shell")
		}
		t.Fatal(err)
	}
	defer schtasks("/Delete", "/TN", name, "/F")
	out, err := exec.Command("schtasks.exe", "/Query", "/TN", name, "/XML").Output()
	if err != nil {
		t.Fatal(err)
	}
	got := decode(out)
	for _, want := range []string{"<RunLevel>HighestAvailable</RunLevel>", "<Arguments>--background</Arguments>",
		"<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>", "<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>",
		"Pro &amp; Split", "<LogonTrigger>"} {
		if !strings.Contains(got, want) {
			t.Errorf("registered task lacks %s:\n%s", want, got)
		}
	}
}

// decode turns schtasks' UTF-16 (or plain) XML output into a string.
func decode(b []byte) string {
	if len(b) >= 2 && b[0] == 0xFF && b[1] == 0xFE {
		b = b[2:]
	}
	if len(b) > 1 && b[1] == 0 {
		r := make([]rune, 0, len(b)/2)
		for i := 0; i+1 < len(b); i += 2 {
			r = append(r, rune(uint16(b[i])|uint16(b[i+1])<<8))
		}
		return string(r)
	}
	return string(b)
}
