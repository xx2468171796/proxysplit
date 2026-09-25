//go:build windows

// Package shortcut keeps a desktop shortcut to the running executable.
package shortcut

import (
	"context"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
)

// EnsureDesktop creates (or repairs) the current user's desktop shortcut
// "<name>.lnk" pointing at exePath. It is cheap to call on every launch: an
// existing shortcut that already points at exePath is left untouched, a
// deleted one is recreated and a stale target (the exe moved) is corrected.
func EnsureDesktop(name, exePath string) error { return ensureIn("", name, exePath) }

// ensureIn does the work; dir "" means the user's desktop.
func ensureIn(dir, name, exePath string) error {
	exePath, err := filepath.Abs(exePath)
	if err != nil {
		return err
	}
	// Windows stores the long form (C:UsersAdministrator, not ADMINI~1);
	// compare in that form or an up-to-date shortcut is rewritten every launch.
	exePath = LongPath(exePath)
	q := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
	// GetFolderPath follows a Desktop redirected to OneDrive / another drive.
	script := "$ErrorActionPreference='Stop';" +
		"$t=" + q(exePath) + ";" +
		"$d=" + q(dir) + ";if(-not $d){$d=[Environment]::GetFolderPath('Desktop')};" +
		"$l=Join-Path $d " + q(name+".lnk") + ";" +
		"$w=New-Object -ComObject WScript.Shell;" +
		"if(Test-Path -LiteralPath $l){$s=$w.CreateShortcut($l);if($s.TargetPath -ieq $t){exit 0}};" +
		"$s=$w.CreateShortcut($l);$s.TargetPath=$t;$s.WorkingDirectory=(Split-Path -Parent $t);" +
		"$s.IconLocation=$t+',0';$s.Description=" + q(name) + ";$s.Save()"
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if out, err := cmd.CombinedOutput(); err != nil {
		return &Error{err: err, output: strings.TrimSpace(string(out))}
	}
	return nil
}

// LongPath expands 8.3 short names (ADMINI~1) to the long path when it exists.
func LongPath(p string) string {
	src, err := windows.UTF16PtrFromString(p)
	if err != nil {
		return p
	}
	buf := make([]uint16, windows.MAX_LONG_PATH)
	if n, err := windows.GetLongPathName(src, &buf[0], uint32(len(buf))); err == nil && n > 0 && int(n) < len(buf) {
		return windows.UTF16ToString(buf[:n])
	}
	return p
}

// Error carries PowerShell's output for the log.
type Error struct {
	err    error
	output string
}

func (e *Error) Error() string {
	if e.output == "" {
		return e.err.Error()
	}
	return e.err.Error() + ": " + e.output
}
