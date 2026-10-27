package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"proxysplit/internal/nodes"
)

// User DNS settings and TUN options land in the config and sing-box accepts it.
func TestDNSAndTunOptions(t *testing.T) {
	node, err := nodes.ParseLink(sampleLinks["vless-reality"])
	if err != nil {
		t.Fatal(err)
	}
	geoDir, _ := filepath.Abs(filepath.Join("..", "..", "bin"))
	opts := Options{Split: true, SplitWhitelist: true, GeoDir: geoDir, TunMTU: 1400, StrictRouteOff: true,
		DNS: DNSOptions{Direct: "119.29.29.29", Remote: "1.1.1.1", Hosts: map[string][]string{"nas.home": {"192.168.1.10"}}, BlockHTTPS: true}}
	writeSplitSets(t, &opts)
	cfg, err := BuildTUNConfig(node, "info", opts)
	if err != nil {
		t.Fatal(err)
	}
	s := string(cfg)
	for _, want := range []string{`"119.29.29.29"`, `"1.1.1.1"`, `"dns-hosts"`, `"nas.home"`, `"SVCB"`, `"mtu": 1400`, `"strict_route": false`} {
		if !strings.Contains(s, want) {
			t.Fatalf("config misses %s", want)
		}
	}
	p := filepath.Join(t.TempDir(), "dns.json")
	_ = os.WriteFile(p, cfg, 0o600)
	if out, err := exec.Command(singboxPath(t), "check", "-c", p).CombinedOutput(); err != nil {
		t.Fatalf("sing-box rejected: %s", out)
	}
}
