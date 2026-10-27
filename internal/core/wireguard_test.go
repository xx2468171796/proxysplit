package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"proxysplit/internal/nodes"
)

// WireGuard lands in "endpoints" (sing-box 1.14 has no wireguard outbound) in
// every config shape, also behind a front node, and sing-box accepts it.
func TestWireGuardEndpointConfigs(t *testing.T) {
	bin := singboxPath(t)
	geoDir, _ := filepath.Abs(filepath.Join("..", "..", "bin"))
	wg, err := nodes.ParseLink("wireguard://yAnz5TF%2BlXXJte14tji3zlMNq%2Bhd2rYUIgJBgB3fBmk%3D@162.159.192.1:2408?publickey=xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg%3D&address=172.16.0.2/32,fd01::2/128&reserved=1,2,3#WARP")
	if err != nil {
		t.Fatal(err)
	}
	front, _ := nodes.ParseLink("socks://127.0.0.1:1080#front")
	chained := *wg
	chained.Via, chained.ViaNode = front.ID, front
	tunOpts := Options{Split: true, SplitWhitelist: true, GeoDir: geoDir}
	writeSplitSets(t, &tunOpts)
	builds := map[string]func() ([]byte, error){
		"tun":     func() ([]byte, error) { return BuildTUNConfig(wg, "info", tunOpts) },
		"chained": func() ([]byte, error) { return BuildTUNConfig(&chained, "info", tunOpts) },
		"multi": func() ([]byte, error) {
			return BuildMultiConfig([]LineConfig{{Key: "L1", InboundPort: 21001, Node: wg, RouteMode: RouteGlobal}}, "info", Options{GeoDir: geoDir})
		},
		"port": func() ([]byte, error) {
			return BuildPortConfig(PortConfig{Listen: "127.0.0.1", Port: 10801, Protocol: "socks", Node: wg, Mode: "global", GeoDir: geoDir})
		},
	}
	for name, build := range builds {
		cfg, err := build()
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if !strings.Contains(string(cfg), `"endpoints"`) {
			t.Fatalf("%s: wireguard not lifted to endpoints:\n%s", name, cfg)
		}
		p := filepath.Join(t.TempDir(), name+".json")
		_ = os.WriteFile(p, cfg, 0o600)
		if out, err := exec.Command(bin, "check", "-c", p).CombinedOutput(); err != nil {
			t.Fatalf("%s: sing-box rejected:\n%s\n%s", name, out, cfg)
		}
	}
}
