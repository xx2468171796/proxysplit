package service

import "proxysplit/internal/hostnet"

// hostHasIPv6 reports whether the OS has a real IPv6 uplink (hostnet.HasIPv6).
func hostHasIPv6() bool { return hostnet.HasIPv6() }

// hostIPv6 is hostHasIPv6 measured while our core is stopped: once the TUN
// carries IPv6, the OS routes IPv6 into it and the probe would always say
// "none". While the core runs, the last stopped-time answer is reused.
func (s *Service) hostIPv6() bool {
	if s.coreRunning() && s.hostIPv6Known.Load() {
		return s.hostIPv6Seen.Load()
	}
	v := hostHasIPv6()
	s.hostIPv6Seen.Store(v)
	s.hostIPv6Known.Store(true)
	return v
}
