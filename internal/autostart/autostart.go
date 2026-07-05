package autostart

import (
	"strings"

	"golang.org/x/sys/windows/registry"
)

const (
	runKeyPath = `Software\Microsoft\Windows\CurrentVersion\Run`
	valueName  = "ProxySplit"
)

// Enable registers the executable at exePath to start on user login by writing
// a value under the HKCU Run key.
func Enable(exePath string) error {
	key, err := registry.OpenKey(registry.CURRENT_USER, runKeyPath, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()

	return key.SetStringValue(valueName, `"`+exePath+`"`)
}

// Disable removes the login autostart entry. A missing value is treated as
// success.
func Disable() error {
	key, err := registry.OpenKey(registry.CURRENT_USER, runKeyPath, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()

	err = key.DeleteValue(valueName)
	if err == registry.ErrNotExist || (err != nil && strings.Contains(strings.ToLower(err.Error()), "not found")) {
		return nil
	}
	return err
}

// Enabled reports whether the login autostart entry exists and is non-empty.
func Enabled() bool {
	key, err := registry.OpenKey(registry.CURRENT_USER, runKeyPath, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer key.Close()

	val, _, err := key.GetStringValue(valueName)
	if err != nil {
		return false
	}
	return val != ""
}
