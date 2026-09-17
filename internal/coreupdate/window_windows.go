package coreupdate

import (
	"os/exec"
	"syscall"
)

func hideVersionWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}
