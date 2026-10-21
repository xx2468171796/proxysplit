package autostart

import (
	"context"
	"encoding/binary"
	"fmt"
	"html"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unicode/utf16"

	"golang.org/x/sys/windows/registry"
)

// Login autostart is a Task Scheduler logon task with highest privileges.
// ProxySplit's manifest requires administrator (TUN), and Windows silently
// skips such programs in the HKCU Run key at logon — the Run value older
// versions wrote never actually started anything. The task starts the app
// in the tray (--background), also on battery, with no run-time limit.
const (
	taskName   = "ProxySplit"
	runKeyPath = `Software\Microsoft\Windows\CurrentVersion\Run`
	valueName  = "ProxySplit"
)

// Enable registers (or re-points) the logon task at exePath and drops the
// legacy Run value.
func Enable(exePath string) error {
	if err := createTask(taskName, exePath); err != nil {
		return err
	}
	removeRunValue()
	return nil
}

func createTask(name, exePath string) error {
	u, err := user.Current()
	if err != nil {
		return fmt.Errorf("读取当前用户失败：%w", err)
	}
	xmlPath := filepath.Join(os.TempDir(), name+"-autostart.xml")
	if err := os.WriteFile(xmlPath, utf16File(taskXML(exePath, u.Username)), 0o600); err != nil {
		return err
	}
	defer os.Remove(xmlPath)
	if err := schtasks("/Create", "/TN", name, "/XML", xmlPath, "/F"); err != nil {
		return fmt.Errorf("创建开机自启任务失败：%w", err)
	}
	return nil
}

// Disable removes the logon task and the legacy Run value. Missing = success.
func Disable() error {
	removeRunValue()
	if !taskExists() {
		return nil
	}
	return schtasks("/Delete", "/TN", taskName, "/F")
}

// Enabled reports whether login autostart is on (task, or a legacy Run value
// MigrateLegacy will turn into one).
func Enabled() bool { return taskExists() || runValue() != "" }

// MigrateLegacy turns a legacy Run value (which never started the elevated
// app) into the logon task for the program it named (exePath when that file
// is gone). Reports whether it migrated.
func MigrateLegacy(exePath string) (bool, error) {
	v := runValue()
	if v == "" || taskExists() {
		return false, nil
	}
	if p := strings.Trim(strings.TrimSpace(v), `"`); p != "" {
		if _, err := os.Stat(p); err == nil {
			exePath = p
		}
	}
	return true, Enable(exePath)
}

func taskXML(exe, userID string) string {
	e, u := html.EscapeString(exe), html.EscapeString(userID)
	return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>ProxySplit 开机自启（托盘启动）</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>` + u + `</UserId></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>` + u + `</UserId><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>5</Priority>
  </Settings>
  <Actions Context="Author"><Exec><Command>` + e + `</Command><Arguments>--background</Arguments></Exec></Actions>
</Task>
`
}

// utf16File encodes s as UTF-16LE with a BOM (what schtasks /XML expects).
func utf16File(s string) []byte {
	units := utf16.Encode([]rune(s))
	out := make([]byte, 2, 2+2*len(units))
	out[0], out[1] = 0xFF, 0xFE
	for _, u := range units {
		out = binary.LittleEndian.AppendUint16(out, u)
	}
	return out
}

func taskExists() bool { return schtasks("/Query", "/TN", taskName) == nil }

func schtasks(args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "schtasks.exe", args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%v %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func runValue() string {
	key, err := registry.OpenKey(registry.CURRENT_USER, runKeyPath, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer key.Close()
	val, _, _ := key.GetStringValue(valueName)
	return val
}

func removeRunValue() {
	key, err := registry.OpenKey(registry.CURRENT_USER, runKeyPath, registry.SET_VALUE)
	if err != nil {
		return
	}
	defer key.Close()
	_ = key.DeleteValue(valueName)
}
