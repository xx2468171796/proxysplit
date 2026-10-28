package core

import "runtime"

// tunRouteExclude keeps other VPN-like networks out of the TUN routes. On
// macOS that is Tailscale (CGNAT range + its IPv6 prefix): many company Macs
// are reached through it (the bastion), and taking its routes would cut them
// off. Windows keeps the existing behaviour.
func tunRouteExclude() []string {
	if runtime.GOOS != "darwin" {
		return nil
	}
	return []string{"100.64.0.0/10", "fd7a:115c:a1e0::/48"}
}
