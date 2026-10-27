package core

import (
	"encoding/json"
	"testing"

	"proxysplit/internal/xray"
)

// Under TUN, xray.exe's own DNS lookups must leave directly: its route rule
// comes before hijack-dns, and its DNS rule (if a lookup still reaches
// sing-box) is the direct resolver. Otherwise remote DNS loops through Xray.
func TestXrayBypassesDNSHijack(t *testing.T) {
	n := parsed(t, xhttpLink)
	const exe = `C:\data\bin\xray.exe`
	opts := Options{RouteMode: RouteGlobal, RemoteDNS: true, XrayPath: exe,
		XrayPorts: map[string]xray.Endpoint{xray.Key(n): {Port: 31080, User: "u1", Pass: "p1"}}}
	cfg, err := BuildTUNConfig(n, "warn", opts)
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Route struct{ Rules []map[string]any }
		DNS   struct{ Rules []map[string]any }
	}
	if err := json.Unmarshal(cfg, &doc); err != nil {
		t.Fatal(err)
	}
	xrayAt, hijackAt := -1, -1
	for i, r := range doc.Route.Rules {
		if pp, ok := r["process_path"].([]any); ok && len(pp) == 1 && pp[0] == exe && r["outbound"] == "direct" && xrayAt < 0 {
			xrayAt = i
		}
		if r["action"] == "hijack-dns" && hijackAt < 0 {
			hijackAt = i
		}
	}
	if xrayAt < 0 || hijackAt < 0 || xrayAt > hijackAt {
		t.Fatalf("xray rule at %d, hijack-dns at %d: %v", xrayAt, hijackAt, doc.Route.Rules)
	}
	if len(doc.DNS.Rules) == 0 || doc.DNS.Rules[0]["server"] != "dns-direct" || doc.DNS.Rules[0]["process_path"] == nil {
		t.Fatalf("first DNS rule must send xray.exe to dns-direct: %v", doc.DNS.Rules)
	}
	ob := outboundByTag(t, cfg, "proxy")
	if ob["username"] != "u1" || ob["password"] != "p1" {
		t.Fatalf("sidecar socks outbound lacks credentials: %v", ob)
	}
}
