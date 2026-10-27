package core

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// DNS answers are IPv4-only in every mode, and public IPv6 that still reaches
// the TUN is refused before anything can send it to a node — but only after
// the DNS hijack and the private / LAN rules (2026-10-28: a dual-stack PC got
// AAAA for ippure.com, the node had no IPv6 and the browser kept retrying).
func TestTUNIPv6NeverReachesNode(t *testing.T) {
	n := parsed(t, "vless://a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d@203.0.113.30:443?encryption=none&security=tls&sni=a.example.com#N")
	for _, guard := range []*AIGuard{nil, {Domains: []string{"claude.ai"}, Outbound: "proxy"}} {
		opts := Options{RemoteDNS: true, RouteMode: RouteBypassCN, AIGuard: guard, GeoDir: filepath.Join("..", "..", "bin"), RuleDir: t.TempDir()}
		raw, err := BuildTUNConfig(n, "warn", opts)
		if err != nil {
			t.Fatal(err)
		}
		var cfg struct {
			DNS   map[string]any `json:"dns"`
			Route struct {
				Rules []M `json:"rules"`
			} `json:"route"`
		}
		if err := json.Unmarshal(raw, &cfg); err != nil {
			t.Fatal(err)
		}
		if cfg.DNS["strategy"] != "ipv4_only" {
			t.Fatalf("guard=%v: dns.strategy = %v", guard != nil, cfg.DNS["strategy"])
		}
		hijack, reject, firstNode, aiV6, aiRoute := -1, -1, -1, -1, -1
		for i, r := range cfg.Route.Rules {
			switch {
			case r["action"] == "hijack-dns" && hijack < 0:
				hijack = i
			case r["ip_version"] == float64(6) && r["action"] == "reject":
				if r["domain"] != nil {
					aiV6 = i // the AI block's own IPv6 refusal
				} else if reject < 0 {
					reject = i
				}
			case r["domain"] != nil && r["outbound"] == "proxy" && aiRoute < 0:
				aiRoute = i
			case firstNode < 0 && r["outbound"] == "proxy" && r["domain"] == nil:
				firstNode = i
			}
		}
		if guard != nil && (aiV6 < 0 || aiV6 > aiRoute) {
			t.Fatalf("AI block must refuse IPv6 before routing AI: v6 %d, route %d", aiV6, aiRoute)
		}
		if hijack < 0 || reject < hijack || (firstNode >= 0 && reject > firstNode) {
			t.Fatalf("guard=%v: hijack-dns %d, IPv6 reject %d, first node rule %d", guard != nil, hijack, reject, firstNode)
		}
		if _, err := os.Stat(singboxPath(t)); err != nil {
			continue
		}
		p := filepath.Join(t.TempDir(), "v6.json")
		os.WriteFile(p, raw, 0o600)
		if o, err := exec.Command(singboxPath(t), "check", "-c", p).CombinedOutput(); err != nil {
			t.Fatalf("sing-box check: %v\n%s", err, o)
		}
	}
}
