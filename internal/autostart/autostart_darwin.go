// Package autostart starts ProxySplit at login. On macOS it is a LaunchAgent
// (~/Library/LaunchAgents) that starts the app in the tray (--background).
package autostart

import (
	"fmt"
	"html"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
)

const label = "cn.zygskins.proxysplit"

func plistPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "LaunchAgents", label+".plist")
}

// Enable registers the login item for exePath (the binary inside the .app).
func Enable(exePath string) error {
	p := plistPath()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	body := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>%s</string>
  <key>ProgramArguments</key>
  <array><string>%s</string><string>--background</string></array>
  <key>RunAtLoad</key><true/>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
</dict>
</plist>
`, label, html.EscapeString(exePath))
	return os.WriteFile(p, []byte(body), 0o644)
}

// Disable removes the login item (and unloads it if loaded).
func Disable() error {
	_ = exec.Command("/bin/launchctl", "bootout", "gui/"+strconv.Itoa(os.Getuid())+"/"+label).Run()
	if err := os.Remove(plistPath()); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// Enabled reports whether the login item exists.
func Enabled() bool {
	_, err := os.Stat(plistPath())
	return err == nil
}

// MigrateLegacy has nothing to migrate on macOS.
func MigrateLegacy(string) (bool, error) { return false, nil }
