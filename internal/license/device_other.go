//go:build !windows

package license

import "os"

// platformMachineProbe: the host name is the only component (kept so existing
// installs keep their fingerprint). It follows the network on macOS, which is
// why the first value is stored — see machine_store.go.
func platformMachineProbe() machineProbe {
	return machineProbe{stable: func() []string {
		host, _ := os.Hostname()
		if host == "" {
			return nil
		}
		return []string{host}
	}}
}
