//go:build !windows

package noderesolve

import (
	"net/netip"
	"syscall"
)

func systemDNS() []netip.Addr { return nil }

func bindControl() func(network, address string, c syscall.RawConn) error { return nil }
