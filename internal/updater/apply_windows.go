//go:build windows

package updater

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
)

// ScheduleInstall starts a detached helper which waits for this process to
// exit, atomically replaces the portable executable, and launches the new one.
func ScheduleInstall(downloaded string) error {
	target, err := os.Executable()
	if err != nil {
		return err
	}
	target, err = filepath.Abs(target)
	if err != nil {
		return err
	}
	downloaded, err = filepath.Abs(downloaded)
	if err != nil {
		return err
	}
	if filepath.Ext(target) != ".exe" || filepath.Ext(downloaded) != ".exe" {
		return fmt.Errorf("更新目标必须是 Windows EXE")
	}

	// Fail before quitting when the portable app directory is not writable.
	probe := filepath.Join(filepath.Dir(target), ".proxysplit-update-write-test")
	if err := os.WriteFile(probe, []byte("ok"), 0o600); err != nil {
		return fmt.Errorf("程序目录不可写，请以管理员身份运行后重试：%w", err)
	}
	_ = os.Remove(probe)

	script := downloaded + ".install.ps1"
	content := `param(
  [Parameter(Mandatory=$true)][int]$ParentPid,
  [Parameter(Mandatory=$true)][string]$Source,
  [Parameter(Mandatory=$true)][string]$Target
)
$ErrorActionPreference = 'Stop'
try { Wait-Process -Id $ParentPid -Timeout 45 -ErrorAction SilentlyContinue } catch {}
$backup = $Target + '.old'
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  try {
    if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }
    if (Test-Path -LiteralPath $Target) { Move-Item -LiteralPath $Target -Destination $backup -Force }
    Move-Item -LiteralPath $Source -Destination $Target -Force
    Start-Process -FilePath $Target -ArgumentList '--updated'
    Start-Sleep -Milliseconds 500
    if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
    exit 0
  } catch {
    if (-not (Test-Path -LiteralPath $Target) -and (Test-Path -LiteralPath $backup)) {
      Move-Item -LiteralPath $backup -Destination $Target -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 500
  }
}
exit 1
`
	if err := os.WriteFile(script, []byte(content), 0o600); err != nil {
		return err
	}
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", script, strconv.Itoa(os.Getpid()), downloaded, target)
	// A new process group survives the Wails parent shutdown. DETACHED_PROCESS
	// is intentionally avoided here because Windows PowerShell may terminate
	// before executing a -File script when launched without standard handles.
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
	if err := cmd.Start(); err != nil {
		_ = os.Remove(script)
		return fmt.Errorf("启动升级助手失败：%w", err)
	}
	return cmd.Process.Release()
}
