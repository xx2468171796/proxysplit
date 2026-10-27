//go:build !windows

package xray

func exeRunning(string) bool { return false }
