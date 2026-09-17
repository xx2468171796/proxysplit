//go:build !windows

package coreupdate

import "os/exec"

func hideVersionWindow(cmd *exec.Cmd) {}
