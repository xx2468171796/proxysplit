package service

import (
	"os/exec"
	"syscall"
)

// hideWindow keeps a child process (curl in route tests) from flashing a
// console window.
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}
