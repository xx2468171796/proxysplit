package aiguard

import (
	"net/netip"
	"testing"
)

func TestOursMatch(t *testing.T) {
	dyn := netip.MustParseAddr("36.235.176.216")
	dyn6 := netip.MustParseAddr("2001:b030:a81d:a00::82:330")
	resolve := func(h string) []netip.Addr {
		if h == "hinet.alonelife.top" {
			return []netip.Addr{dyn, dyn6}
		}
		return nil
	}
	l := OursList{IPs: []string{"211.76.176.116"}, CIDRs: []string{"2405:cdc0:0:902::/64"}, Hosts: []string{"hinet.alonelife.top"}}
	for ip, want := range map[string]bool{
		"211.76.176.116":                 true,  // fixed
		"2405:cdc0:0:902:211:76:176:116": true,  // in the /64
		"36.235.176.216":                 true,  // DDNS A
		"2001:b030:a81d:a00::1234":       true,  // same /64 as the DDNS AAAA
		"::ffff:211.76.176.116":          true,  // v4-mapped
		"8.8.8.8":                        false, // someone else's VPN
		"2405:cdc0:0:903::1":             false, // neighbouring /64
	} {
		if got := oursMatch(l, netip.MustParseAddr(ip).Unmap(), resolve); got != want {
			t.Errorf("%s: ours=%v, want %v", ip, got, want)
		}
	}
}

// The built-in list must parse: a typo would silently stop matching.
func TestBuiltinOursParses(t *testing.T) {
	for _, s := range builtinOurs.IPs {
		if _, err := netip.ParseAddr(s); err != nil {
			t.Error(err)
		}
	}
	for _, s := range builtinOurs.CIDRs {
		if _, err := netip.ParsePrefix(s); err != nil {
			t.Error(err)
		}
	}
}
