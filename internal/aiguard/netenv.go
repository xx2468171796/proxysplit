package aiguard

import (
	"net"
	"strings"
)

// Portable network facts for the AI environment check.

// tunAddr is the TUN address ProxySplit's core uses (internal/core); the
// interface carrying it is ours.
const tunAddr = "172.19.0.1"

// otherVPNHints are interface-name fragments of other proxy / VPN clients'
// virtual adapters (Clash / mihomo / sing-box TUN, WireGuard, OpenVPN TAP …).
// Specific names only: a bare "tun" would also match Windows' own "Teredo
// Tunneling Pseudo-Interface".
var otherVPNHints = []string{"wintun", "wireguard", "tap-windows", "openvpn", "meta", "mihomo", "clash", "singbox", "sing-box", "zerotier", "tailscale", "letsvpn"}

// OtherVPNAdapters lists up interfaces that look like another proxy / VPN
// client's adapter (ours excluded). Their routes can take AI traffic away
// from our tunnel.
func OtherVPNAdapters() []string {
	ifs, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var out []string
	for _, ifc := range ifs {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 || isOurs(ifc) {
			continue
		}
		name := strings.ToLower(ifc.Name)
		for _, h := range otherVPNHints {
			if strings.Contains(name, h) {
				out = append(out, ifc.Name)
				break
			}
		}
	}
	return out
}

func isOurs(ifc net.Interface) bool {
	addrs, _ := ifc.Addrs()
	for _, a := range addrs {
		if ipn, ok := a.(*net.IPNet); ok && ipn.IP.String() == tunAddr {
			return true
		}
	}
	return false
}

// HasGlobalIPv6 reports whether a physical interface has a public IPv6
// address (AI over IPv6 would bypass the IPv4-only tunnel).
func HasGlobalIPv6() bool {
	ifs, err := net.Interfaces()
	if err != nil {
		return false
	}
	for _, ifc := range ifs {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 || isOurs(ifc) {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			ipn, ok := a.(*net.IPNet)
			if ok && ipn.IP.To4() == nil && ipn.IP.IsGlobalUnicast() && !ipn.IP.IsPrivate() {
				return true
			}
		}
	}
	return false
}

// riskyRegions are exit countries where AI providers refuse service or flag
// accounts (mainland China, Hong Kong, Macau, sanctioned countries).
var riskyRegions = map[string]bool{"CN": true, "HK": true, "MO": true, "RU": true, "BY": true, "KP": true, "IR": true, "SY": true, "CU": true}

// ExitRegionRisky reports whether an exit country code is a hard no.
func ExitRegionRisky(cc string) bool {
	return riskyRegions[strings.ToUpper(strings.TrimSpace(cc))] || strings.TrimSpace(cc) == ""
}

// knownProxyClients are executables of other proxy / VPN clients (lower-case).
var knownProxyClients = map[string]string{
	"clash.exe": "Clash", "clash for windows.exe": "Clash for Windows", "clash-verge.exe": "Clash Verge", "verge-mihomo.exe": "Clash Verge",
	"mihomo.exe": "mihomo", "clash-meta.exe": "Clash Meta", "flclash.exe": "FlClash", "v2rayn.exe": "v2rayN", "xray.exe": "Xray",
	"v2ray.exe": "V2Ray", "nekoray.exe": "NekoRay", "nekobox.exe": "NekoBox", "hiddify.exe": "Hiddify", "shadowsocks.exe": "Shadowsocks",
	"shadowsocksr.exe": "ShadowsocksR", "trojan-go.exe": "Trojan-Go", "letspro.exe": "快连", "openvpn.exe": "OpenVPN", "wireguard.exe": "WireGuard",
}

// ProxyClientName returns the display name of a known proxy client exe ("" if not one).
func ProxyClientName(exe string) string { return knownProxyClients[strings.ToLower(exe)] }
