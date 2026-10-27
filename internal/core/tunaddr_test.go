package core

import (
	"net/netip"
	"testing"
)

func TestTUNAddr4AvoidsTakenSubnets(t *testing.T) {
	orig := localPrefixes
	defer func() { localPrefixes = orig }()
	set := func(ps ...string) {
		localPrefixes = func() []netip.Prefix {
			var out []netip.Prefix
			for _, p := range ps {
				out = append(out, netip.MustParsePrefix(p))
			}
			return out
		}
	}
	set("192.168.1.5/24")
	if got := tunAddr4(); got != "172.19.0.1/30" {
		t.Fatalf("free host: %s", got)
	}
	set("172.19.0.1/30") // our own TUN from the last run
	if got := tunAddr4(); got != "172.19.0.1/30" {
		t.Fatalf("own TUN must not count as taken: %s", got)
	}
	set("172.16.0.1/12") // Hyper-V / WSL took a big 172 block
	if got := tunAddr4(); got != "198.18.0.1/30" {
		t.Fatalf("Hyper-V overlap: %s", got)
	}
}
