//go:build !windows

package core

import (
	"os/exec"
	"regexp"
	"runtime"

	"proxysplit/internal/macpriv"
)

// killCoreProcs stops sing-box processes started from binPath: the proxy-port
// ones (config under PortDirName, run as this user) when ports is true, the
// main core otherwise (on macOS the TUN core is root's: the control script
// stops it).
func killCoreProcs(binPath string, ports bool) {
	if ports {
		_ = exec.Command("/usr/bin/pkill", "-KILL", "-f", "^"+regexp.QuoteMeta(binPath)+" run -c .*"+PortDirName).Run()
		return
	}
	_ = exec.Command("/usr/bin/pkill", "-KILL", "-f", "^"+regexp.QuoteMeta(binPath)+` run -c .*sing-box.json$`).Run()
	if runtime.GOOS == "darwin" && macpriv.Available() {
		_ = macpriv.Run("stop")
	}
}
