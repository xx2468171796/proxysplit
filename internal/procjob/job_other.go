//go:build !windows

package procjob

import "os/exec"

// Attach is a no-op off Windows.
func Attach(*exec.Cmd) {}
