// Package sysproxy toggles the macOS system HTTP/HTTPS proxy on every enabled
// network service. networksetup needs root, so it goes through the control
// script (macpriv; installed with one password prompt the first time).
package sysproxy

import (
	"fmt"
	"net"
	"os/exec"
	"strings"

	"proxysplit/internal/macpriv"
)

// Core is the sing-box path the control script is installed for; the service
// sets it at startup.
var Core string

func ctl(args ...string) error {
	if !macpriv.Available() {
		if err := macpriv.Install(Core); err != nil {
			return err
		}
	}
	return macpriv.Run(args...)
}

// Set points the system proxy at server ("127.0.0.1:7890").
func Set(server string) error {
	host, port, err := net.SplitHostPort(server)
	if err != nil {
		return fmt.Errorf("bad proxy address %q: %w", server, err)
	}
	return ctl("proxy", "on", host, port)
}

// Clear turns the system proxy off.
func Clear() error {
	if on, _ := Get(); !on {
		return nil
	}
	return ctl("proxy", "off")
}

// Get reads the current system proxy (scutil, no root needed).
func Get() (enabled bool, server string) {
	out, err := exec.Command("/usr/sbin/scutil", "--proxy").Output()
	if err != nil {
		return false, ""
	}
	return parseScutil(string(out))
}

func parseScutil(out string) (bool, string) {
	kv := map[string]string{}
	for _, line := range strings.Split(out, "\n") {
		k, v, ok := strings.Cut(line, ":")
		if ok {
			kv[strings.TrimSpace(k)] = strings.TrimSpace(v)
		}
	}
	if kv["HTTPEnable"] != "1" || kv["HTTPProxy"] == "" {
		return false, ""
	}
	return true, net.JoinHostPort(kv["HTTPProxy"], kv["HTTPPort"])
}
