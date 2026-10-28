// Package sysproxy toggles the Windows system HTTP proxy by writing the
// per-user Internet Settings registry keys and refreshing WinINet so the
// change applies immediately without a reboot.
package sysproxy

import (
	"syscall"

	"golang.org/x/sys/windows/registry"
)

const internetSettingsPath = `Software\Microsoft\Windows\CurrentVersion\Internet Settings`

const proxyOverride = "localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*;<local>"

const (
	internetOptionSettingsChanged = 39
	internetOptionRefresh         = 37
)

// Set enables the system HTTP proxy pointing at server ("host:port",
// e.g. "127.0.0.1:7890") and refreshes WinINet.
func Set(server string) error {
	key, err := registry.OpenKey(registry.CURRENT_USER, internetSettingsPath, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()

	if err := key.SetStringValue("ProxyServer", server); err != nil {
		return err
	}
	if err := key.SetDWordValue("ProxyEnable", 1); err != nil {
		return err
	}
	if err := key.SetStringValue("ProxyOverride", proxyOverride); err != nil {
		return err
	}

	return refresh()
}

// Clear disables the system HTTP proxy (leaving ProxyServer intact) and
// refreshes WinINet.
func Clear() error {
	key, err := registry.OpenKey(registry.CURRENT_USER, internetSettingsPath, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()

	if err := key.SetDWordValue("ProxyEnable", 0); err != nil {
		return err
	}

	return refresh()
}

// Get returns the current system proxy state, best-effort: (false, "") on any
// error.
func Get() (enabled bool, server string) {
	key, err := registry.OpenKey(registry.CURRENT_USER, internetSettingsPath, registry.QUERY_VALUE)
	if err != nil {
		return false, ""
	}
	defer key.Close()

	v, _, err := key.GetIntegerValue("ProxyEnable")
	if err != nil {
		return false, ""
	}
	enabled = v != 0

	server, _, err = key.GetStringValue("ProxyServer")
	if err != nil {
		server = ""
	}

	return enabled, server
}

// refresh notifies WinINet that the proxy settings changed so they take effect
// without a reboot. Best-effort: individual call errors are ignored.
func refresh() error {
	proc := syscall.NewLazyDLL("wininet.dll").NewProc("InternetSetOptionW")
	proc.Call(0, internetOptionSettingsChanged, 0, 0)
	proc.Call(0, internetOptionRefresh, 0, 0)
	return nil
}

// Core is only used on macOS (the control script); kept for a shared API.
var Core string
