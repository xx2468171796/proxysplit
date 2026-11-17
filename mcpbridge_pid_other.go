//go:build !windows

package main

import (
	"errors"
	"syscall"
)

// processAlive reports whether pid is a running process (signal 0 probes it;
// EPERM means it exists but belongs to another user).
func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}
