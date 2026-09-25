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
// exit, replaces the portable executable and launches the new one. If the new
// version cannot be started it restores and relaunches the old one.
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
# The app is quitting for this install; a shutdown that hangs must not keep the
# old executable (and the single-instance lock) alive.
# Check the path first: the PID may already belong to another program.
try {
  $parent = Get-Process -Id $ParentPid -ErrorAction SilentlyContinue
  if ($parent -and $parent.Path -eq $Target) { Stop-Process -Id $ParentPid -Force }
} catch {}
$backup = $Target + '.old'

# 1. Swap the files; only this step is retried (the exe can stay locked briefly).
$swapped = $false
for ($attempt = 0; $attempt -lt 60 -and -not $swapped; $attempt++) {
  try {
    if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }
    Move-Item -LiteralPath $Target -Destination $backup -Force
    try {
      Move-Item -LiteralPath $Source -Destination $Target -Force
      $swapped = $true
    } catch {
      Move-Item -LiteralPath $backup -Destination $Target -Force
      throw
    }
  } catch {
    Start-Sleep -Milliseconds 500
  }
}

# 2. The new version must start and stay up; otherwise (quarantined by
#    antivirus, crashes on launch) put the old version back.
if ($swapped) {
  $proc = $null
  try {
    $proc = Start-Process -FilePath $Target -ArgumentList '--updated' -PassThru
    Start-Sleep -Seconds 8
    if ($proc.HasExited) { throw 'new version exited during startup' }
    Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
    exit 0
  } catch {
    try { if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force } } catch {}
    Start-Sleep -Milliseconds 500
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
      try {
        if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Force }
        Move-Item -LiteralPath $backup -Destination $Target -Force
        break
      } catch { Start-Sleep -Milliseconds 500 }
    }
  }
}

# 3. Never leave the user without a running client. The old version notices the
#    failed install from its resume marker and stops auto-installing this release.
if (Test-Path -LiteralPath $Target) {
  try { Start-Process -FilePath $Target } catch {}
}
Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
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
