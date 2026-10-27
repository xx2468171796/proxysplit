//go:build !windows

package telemetry

import "runtime"

func OSInfo() string                     { return runtime.GOOS }
func IsAdmin() bool                      { return false }
func Locale() string                     { return "" }
func DefenderDetections() map[string]any { return map[string]any{"supported": false} }
