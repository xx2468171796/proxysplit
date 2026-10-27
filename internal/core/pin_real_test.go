package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"testing"

	"proxysplit/internal/nodes"
	"proxysplit/internal/xray"
)

// TestPinnedConfigAcceptedByRealCores: a TUN config whose every outbound is
// pinned passes `sing-box check`; the Xray sidecar config passes `xray run -test`.
func TestPinnedConfigAcceptedByRealCores(t *testing.T) {
	bin := singboxPath(t)
	cases := pinCases()
	names := make([]string, 0, len(cases))
	for k := range cases {
		names = append(names, k)
	}
	sort.Strings(names)
	main := &nodes.Node{ID: "main", Name: "main", Type: "trojan", Server: pinDomain, Port: 443, Password: "p"}
	opts := Options{ServerIPs: pinIPs, GeoDir: filepath.Join("..", "..", "bin")}
	for i, k := range names {
		n := *cases[k]
		n.ID, n.Name = k, k
		opts.ExtraNodes = append(opts.ExtraNodes, ExtraNode{Tag: "x" + string(rune('a'+i)), Node: &n})
	}
	cfg, err := BuildTUNConfig(main, "warn", opts)
	if err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(t.TempDir(), "pin.json")
	if err := os.WriteFile(p, cfg, 0o600); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command(bin, "check", "-c", p).CombinedOutput(); err != nil {
		t.Fatalf("sing-box check: %v\n%s\n%s", err, out, cfg)
	}

	xbin := filepath.Join(filepath.Dir(bin), "xray.exe")
	if _, err := os.Stat(xbin); err != nil {
		t.Skip("no xray.exe")
	}
	xn := &nodes.Node{ID: "x1", Type: "vless", Server: pinDomain, Port: 443, UUID: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", Security: "tls", Network: "xhttp", Path: "/x"}
	xcfg, err := xray.BuildConfig([]xray.Entry{{Key: "x1", Endpoint: xray.Endpoint{Port: 20811, User: "u", Pass: "p"}, Node: PinNode(xn, pinIPs)}}, "warning")
	if err != nil {
		t.Fatal(err)
	}
	xp := filepath.Join(t.TempDir(), "x.json")
	if err := os.WriteFile(xp, xcfg, 0o600); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command(xbin, "run", "-test", "-c", xp).CombinedOutput(); err != nil {
		t.Fatalf("xray -test: %v\n%s", err, out)
	}
}
