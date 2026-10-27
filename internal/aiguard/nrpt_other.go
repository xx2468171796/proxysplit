//go:build !windows

package aiguard

import "errors"

// Lock servers (see nrpt_windows.go).
const (
	LockedServer = "127.0.0.53"
	TunnelServer = "fdfe:dcba:9876::2"
)

var errUnsupported = errors.New("AI 锁只支持 Windows")

func Installed(string) bool   { return false }
func Present() bool           { return false }
func GroupPolicyActive() bool { return false }
func Install(string) error    { return errUnsupported }
func Remove() error           { return nil }
func EnsureBootTask() error   { return nil }
func FlushCache()             {}
