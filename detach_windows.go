package main

import "syscall"

// detachedAttr starts a process in its own group with no console.
func detachedAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | 0x00000008 /* DETACHED_PROCESS */}
}
