//go:build !windows

package powervpn

import "runtime"

func osVersion() string { return runtime.GOOS }
