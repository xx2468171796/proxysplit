//go:build !windows

package main

import "syscall"

// detachedAttr starts a process in its own session.
func detachedAttr() *syscall.SysProcAttr { return &syscall.SysProcAttr{Setsid: true} }
