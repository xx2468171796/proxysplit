package service

import "proxysplit/internal/hostnet"

// hostHasIPv6 reports whether the OS has a real IPv6 uplink (hostnet.HasIPv6).
func hostHasIPv6() bool { return hostnet.HasIPv6() }
