package aiguard

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unicode/utf16"
)

// The boot task closes the lock at system start, before anyone logs in and
// whether or not ProxySplit starts: power loss or a Windows shutdown kills the
// app without its quit path, leaving the rule on TunnelServer. It runs as
// SYSTEM and only re-points an existing rule of ours at LockedServer — it can
// tighten the lock, never lift it (only the in-app 恢复 lifts it).
const bootTaskName = "ProxySplit-AILock"

// bootScript re-points our rule at the dead loopback server and empties the DNS cache.
func bootScript() string {
	return `Get-DnsClientNrptRule | Where-Object { $_.Comment -eq '` + ruleComment + `' } | ForEach-Object { Set-DnsClientNrptRule -Name $_.Name -NameServers '` + LockedServer + `' }
Clear-DnsClientCache`
}

// encodedCommand is script in PowerShell's -EncodedCommand form (UTF-16LE, base64): no quoting.
func encodedCommand(script string) string {
	units := utf16.Encode([]rune(script))
	b := make([]byte, 0, 2*len(units))
	for _, u := range units {
		b = binary.LittleEndian.AppendUint16(b, u)
	}
	return base64.StdEncoding.EncodeToString(b)
}

func bootTaskXML() string {
	return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>ProxySplit：开机时先锁住 AI 访问（防止断电或关机后 AI 走本机网络）</Description></RegistrationInfo>
  <Triggers><BootTrigger><Enabled>true</Enabled></BootTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT5M</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Author"><Exec><Command>powershell.exe</Command><Arguments>-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ` + encodedCommand(bootScript()) + `</Arguments></Exec></Actions>
</Task>
`
}

// ensureBootTask registers the boot task once (no-op when it exists).
func ensureBootTask() error {
	if schtasks("/Query", "/TN", bootTaskName) == nil {
		return nil
	}
	units := utf16.Encode([]rune(bootTaskXML()))
	data := []byte{0xFF, 0xFE}
	for _, u := range units {
		data = binary.LittleEndian.AppendUint16(data, u)
	}
	path := filepath.Join(os.TempDir(), bootTaskName+".xml")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return err
	}
	defer os.Remove(path)
	if err := schtasks("/Create", "/TN", bootTaskName, "/XML", path, "/F"); err != nil {
		return fmt.Errorf("创建开机锁定任务失败：%w", err)
	}
	return nil
}

// removeBootTask deletes the boot task (missing = success).
func removeBootTask() error {
	if schtasks("/Query", "/TN", bootTaskName) != nil {
		return nil
	}
	return schtasks("/Delete", "/TN", bootTaskName, "/F")
}

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
