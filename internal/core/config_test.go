package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"proxysplit/internal/nodes"
)

// sampleLinks are structurally-valid share links (fake credentials) covering the
// four supported protocols and the common transport/security combinations.
var sampleLinks = map[string]string{
	"vless-reality": "vless://11111111-2222-3333-4444-555555555555@example.com:443?encryption=none&security=reality&sni=www.microsoft.com&fp=chrome&pbk=jNXHt1yRo0vDuchQlIP6Z0ZvjT3KtzVI-T4E7RoLJS0&sid=0123abcd&type=tcp&flow=xtls-rprx-vision#Reality-Node",
	"vless-ws-tls":  "vless://11111111-2222-3333-4444-555555555555@example.com:443?encryption=none&security=tls&sni=cdn.example.com&type=ws&path=%2Fpath&host=cdn.example.com#VLESS-WS",
	"vmess-ws":      "vmess://eyJ2IjoiMiIsInBzIjoiVk1lc3MtV1MiLCJhZGQiOiJleGFtcGxlLmNvbSIsInBvcnQiOiI0NDMiLCJpZCI6IjExMTExMTExLTIyMjItMzMzMy00NDQ0LTU1NTU1NTU1NTU1NSIsImFpZCI6IjAiLCJzY3kiOiJhdXRvIiwibmV0Ijoid3MiLCJob3N0IjoiY2RuLmV4YW1wbGUuY29tIiwicGF0aCI6Ii9wYXRoIiwidGxzIjoidGxzIiwic25pIjoiY2RuLmV4YW1wbGUuY29tIn0=",
	"trojan":        "trojan://password123@example.com:443?sni=example.com&type=tcp#Trojan-Node",
	"ss":            "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQxMjM=@example.com:8388#SS-Node",
	"socks":         "socks://dXNlcjpwYXNz@example.com:1080#Socks-Node",
	"http":          "http://user:pass@example.com:8080#HTTP-Node",
	"hysteria2":     "hysteria2://password123@example.com:443?sni=example.com&insecure=1#Hy2-Node",
	"tuic":          "tuic://11111111-2222-3333-4444-555555555555:password@example.com:443?sni=example.com&congestion_control=bbr&alpn=h3#TUIC-Node",
	"anytls":        "anytls://password123@example.com:443?sni=example.com&insecure=1#AnyTLS-Node",
}

func singboxPath(t *testing.T) string {
	p, err := filepath.Abs(filepath.Join("..", "..", "bin", "sing-box.exe"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(p); err != nil {
		t.Skipf("sing-box binary not found at %s", p)
	}
	return p
}

func TestManualNode(t *testing.T) {
	bin := singboxPath(t)
	dir := t.TempDir()
	for _, tp := range []string{"socks", "http"} {
		n, err := nodes.Manual(tp, "Test", "1.2.3.4", 1080, "user", "pass")
		if err != nil {
			t.Fatal(err)
		}
		cfg, err := BuildConfig(n, 17890, "info", Options{})
		if err != nil {
			t.Fatal(err)
		}
		p := filepath.Join(dir, tp+".json")
		os.WriteFile(p, cfg, 0o600)
		if out, err := exec.Command(bin, "check", "-c", p).CombinedOutput(); err != nil {
			t.Fatalf("manual %s rejected: %s", tp, out)
		}
		t.Logf("manual %s -> OK", tp)
	}
}

func TestTUNConfig(t *testing.T) {
	bin := singboxPath(t)
	dir := t.TempDir()
	geoDir, _ := filepath.Abs(filepath.Join("..", "..", "bin"))
	node, err := nodes.ParseLink(sampleLinks["vless-reality"])
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{RouteGlobal, RouteBypassCN} {
		cfg, err := BuildTUNConfig(node, "info", Options{RouteMode: mode, GeoDir: geoDir})
		if err != nil {
			t.Fatalf("build %s: %v", mode, err)
		}
		path := filepath.Join(dir, "tun-"+mode+".json")
		os.WriteFile(path, cfg, 0o600)
		if out, err := exec.Command(bin, "check", "-c", path).CombinedOutput(); err != nil {
			t.Fatalf("sing-box check rejected TUN %s:\n%s\n%s", mode, out, cfg)
		}
		t.Logf("TUN %s -> OK", mode)
	}
}

func TestMultiLine(t *testing.T) {
	bin := singboxPath(t)
	dir := t.TempDir()
	geoDir, _ := filepath.Abs(filepath.Join("..", "..", "bin"))

	jp, err := nodes.ParseLink(sampleLinks["vless-reality"])
	if err != nil {
		t.Fatal(err)
	}
	us, err := nodes.ParseLink(sampleLinks["trojan"])
	if err != nil {
		t.Fatal(err)
	}
	// Two apps -> two nodes with different policies, plus a shared-node line.
	lines := []LineConfig{
		{Key: "L1", InboundPort: 21001, Node: jp, RouteMode: RouteBypassCN},
		{Key: "L2", InboundPort: 21002, Node: us, RouteMode: RouteGlobal},
		{Key: "L3", InboundPort: 21003, Node: jp, RouteMode: RouteCustom, RouteRules: []RouteRule{
			{Type: "suffix", Value: "openai.com", Action: "proxy"},
			{Type: "suffix", Value: "cn", Action: "direct"},
		}},
	}
	cfg, err := BuildMultiConfig(lines, "info", Options{RemoteDNS: true, GeoDir: geoDir})
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	path := filepath.Join(dir, "multi.json")
	if err := os.WriteFile(path, cfg, 0o600); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command(bin, "check", "-c", path).CombinedOutput(); err != nil {
		t.Fatalf("sing-box check rejected multi-line config:\n%s\n%s", out, cfg)
	}
	t.Log("multi-line (3 inbounds, 2 nodes, 3 policies) -> OK")
}

func TestClashConfig(t *testing.T) {
	bin := singboxPath(t)
	dir := t.TempDir()
	geoDir, _ := filepath.Abs(filepath.Join("..", "..", "bin"))
	node, err := nodes.ParseLink(sampleLinks["vless-reality"])
	if err != nil {
		t.Fatal(err)
	}
	opts := Options{RemoteDNS: true, GeoDir: geoDir, ClashController: "127.0.0.1:19090", ClashSecret: "deadbeef", ClashMode: "global"}

	// Multi-line config with clash_api enabled.
	multi := []LineConfig{{Key: "L1", InboundPort: 21001, Node: node, RouteMode: RouteBypassCN}}
	cfg, err := BuildMultiConfig(multi, "info", opts)
	if err != nil {
		t.Fatalf("build multi: %v", err)
	}
	path := filepath.Join(dir, "clash-multi.json")
	os.WriteFile(path, cfg, 0o600)
	if out, err := exec.Command(bin, "check", "-c", path).CombinedOutput(); err != nil {
		t.Fatalf("clash multi rejected:\n%s\n%s", out, cfg)
	}
	t.Log("clash multi-line -> OK")

	// TUN config with clash_api enabled.
	tunOpts := opts
	tunOpts.RouteMode = RouteBypassCN
	tcfg, err := BuildTUNConfig(node, "info", tunOpts)
	if err != nil {
		t.Fatalf("build tun: %v", err)
	}
	tpath := filepath.Join(dir, "clash-tun.json")
	os.WriteFile(tpath, tcfg, 0o600)
	if out, err := exec.Command(bin, "check", "-c", tpath).CombinedOutput(); err != nil {
		t.Fatalf("clash tun rejected:\n%s\n%s", out, tcfg)
	}
	t.Log("clash TUN -> OK")
}

func TestLanShareConfig(t *testing.T) {
	bin := singboxPath(t)
	dir := t.TempDir()
	geoDir, _ := filepath.Abs(filepath.Join("..", "..", "bin"))
	node, err := nodes.ParseLink(sampleLinks["vless-reality"])
	if err != nil {
		t.Fatal(err)
	}
	for _, typ := range []string{"mixed", "socks", "http"} {
		for _, auth := range []bool{false, true} {
			opts := Options{RemoteDNS: true, GeoDir: geoDir, LanShare: true, LanPort: 7890, LanType: typ}
			if auth {
				opts.LanUser, opts.LanPass = "lanuser", "lanpass"
			}
			// multi-line (app-split) path
			lines := []LineConfig{{Key: "L1", InboundPort: 21001, Node: node, RouteMode: RouteBypassCN}}
			cfg, err := BuildMultiConfig(lines, "info", opts)
			if err != nil {
				t.Fatalf("build multi %s auth=%v: %v", typ, auth, err)
			}
			p := filepath.Join(dir, "lan-multi-"+typ+".json")
			os.WriteFile(p, cfg, 0o600)
			if out, err := exec.Command(bin, "check", "-c", p).CombinedOutput(); err != nil {
				t.Fatalf("LAN multi %s auth=%v rejected:\n%s\n%s", typ, auth, out, cfg)
			}
			// TUN path
			topts := opts
			topts.RouteMode = RouteBypassCN
			tcfg, err := BuildTUNConfig(node, "info", topts)
			if err != nil {
				t.Fatalf("build tun %s: %v", typ, err)
			}
			tp := filepath.Join(dir, "lan-tun-"+typ+".json")
			os.WriteFile(tp, tcfg, 0o600)
			if out, err := exec.Command(bin, "check", "-c", tp).CombinedOutput(); err != nil {
				t.Fatalf("LAN tun %s auth=%v rejected:\n%s\n%s", typ, auth, out, tcfg)
			}
		}
	}
	t.Log("LAN inbound (mixed/socks/http, ±auth, multi+TUN) -> OK")
}

func TestRoutingModes(t *testing.T) {
	bin := singboxPath(t)
	dir := t.TempDir()
	geoDir, _ := filepath.Abs(filepath.Join("..", "..", "bin"))

	node, err := nodes.ParseLink(sampleLinks["vless-reality"])
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name string
		opts Options
	}{
		{"global", Options{RemoteDNS: true, RouteMode: RouteGlobal, GeoDir: geoDir}},
		{"bypass_cn", Options{RemoteDNS: true, RouteMode: RouteBypassCN, GeoDir: geoDir}},
		{"custom", Options{RemoteDNS: true, RouteMode: RouteCustom, GeoDir: geoDir, RouteRules: []RouteRule{
			{Type: "suffix", Value: "openai.com", Action: "proxy"},
			{Type: "suffix", Value: "cn", Action: "direct"},
			{Type: "keyword", Value: "doubleclick", Action: "block"},
			{Type: "ip", Value: "192.168.0.0/16", Action: "direct"},
		}}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			cfg, err := BuildConfig(node, 17890, "info", c.opts)
			if err != nil {
				t.Fatalf("build: %v", err)
			}
			path := filepath.Join(dir, c.name+".json")
			if err := os.WriteFile(path, cfg, 0o600); err != nil {
				t.Fatal(err)
			}
			if out, err := exec.Command(bin, "check", "-c", path).CombinedOutput(); err != nil {
				t.Fatalf("sing-box check rejected %s:\n%s\n%s", c.name, out, cfg)
			}
			t.Logf("%s -> OK", c.name)
		})
	}
}

func TestParseAndCheck(t *testing.T) {
	bin := singboxPath(t)
	dir := t.TempDir()

	for name, link := range sampleLinks {
		t.Run(name, func(t *testing.T) {
			node, err := nodes.ParseLink(link)
			if err != nil {
				t.Fatalf("parse: %v", err)
			}
			cfg, err := BuildConfig(node, 17890, "info", Options{RemoteDNS: true})
			if err != nil {
				t.Fatalf("build: %v", err)
			}
			path := filepath.Join(dir, name+".json")
			if err := os.WriteFile(path, cfg, 0o600); err != nil {
				t.Fatal(err)
			}
			out, err := exec.Command(bin, "check", "-c", path).CombinedOutput()
			if err != nil {
				t.Fatalf("sing-box check rejected %s config:\n%s\n--- config ---\n%s", name, out, cfg)
			}
			t.Logf("%s (%s) -> OK", name, node.Type)
		})
	}
}
