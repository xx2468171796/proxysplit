package core

import (
	"testing"

	"proxysplit/internal/nodes"
	"proxysplit/internal/xray"
)

// A plain vless node the user forced onto Xray reaches sing-box as a SOCKS
// outbound to the sidecar; on auto it is generated natively.
func TestForcedXrayNodeUsesSidecar(t *testing.T) {
	n := parsed(t, "vless://a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d@203.0.113.30:443?encryption=none&security=tls&sni=a.example.com&type=ws&path=%2Fws#WS")
	n.Core = nodes.CoreXray
	opts := Options{RouteMode: RouteGlobal, XrayPorts: map[string]xray.Endpoint{xray.Key(n): {Port: 31090, User: "u", Pass: "p"}}}
	cfg, err := BuildTUNConfig(n, "warn", opts)
	if err != nil {
		t.Fatal(err)
	}
	ob := outboundByTag(t, cfg, "proxy")
	if ob["type"] != "socks" || ob["server"] != "127.0.0.1" || ob["server_port"] != float64(31090) {
		t.Fatalf("forced node outbound = %v", ob)
	}
	n.Core = nodes.CoreAuto
	cfg, err = BuildTUNConfig(n, "warn", Options{RouteMode: RouteGlobal})
	if err != nil {
		t.Fatal(err)
	}
	if ob := outboundByTag(t, cfg, "proxy"); ob["type"] != "vless" {
		t.Fatalf("auto node outbound = %v", ob)
	}
}
