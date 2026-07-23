//go:build !windows

package license

import "os"

func machineID() string {
	host, _ := os.Hostname()
	return host
}
