package core

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// killCoreProcs force-kills sing-box processes started from binPath: the
// proxy-port ones (command line points into PortDirName) when ports is true,
// every other one (TUN / main core) when false.
func killCoreProcs(binPath string, ports bool) {
	like := "-notlike"
	if ports {
		like = "-like"
	}
	// The path comes from %APPDATA% (contains the user name) and is passed as an
	// environment variable: PowerShell ends a '…' string at typographic quotes
	// too, so quoting it into the script text would break on such names.
	ps := "Get-CimInstance Win32_Process -Filter \"Name='sing-box.exe'\" | " +
		"Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -ieq $env:PS_SINGBOX_PATH) -and ($_.CommandLine " + like + " '*" + PortDirName + "*') } | " +
		"ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive", "-Command", ps)
	cmd.Env = append(os.Environ(), "PS_SINGBOX_PATH="+filepath.Clean(binPath))
	hideWindow(cmd)
	_ = cmd.Run()
}
