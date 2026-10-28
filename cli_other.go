//go:build !darwin

package main

// platformCLI handles platform-only command lines (none here).
func platformCLI([]string) bool { return false }
