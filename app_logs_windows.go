package main

import (
	"os/exec"
	"syscall"
)

// openFolderCmd: explorer is a GUI program; CREATE_NO_WINDOW only stops a
// console from flashing (HideWindow would hide the folder window itself).
func openFolderCmd(dir string) *exec.Cmd {
	cmd := exec.Command("explorer", dir)
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000}
	return cmd
}
