//go:build !windows

package shortcut

// EnsureDesktop is a no-op outside Windows.
func EnsureDesktop(name, exePath string) error { return nil }
