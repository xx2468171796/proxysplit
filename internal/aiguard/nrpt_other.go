//go:build !windows

package aiguard

import "errors"

// DNSServer is the loopback address of the core's AI DNS listener (port 53).
const DNSServer = "127.0.0.53"

var errUnsupported = errors.New("AI 锁只支持 Windows")

func Installed() bool         { return false }
func Present() bool           { return false }
func GroupPolicyActive() bool { return false }
func Install() error          { return errUnsupported }
func Remove() error           { return nil }
func FlushCache()             {}
