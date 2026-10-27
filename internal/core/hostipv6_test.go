package core

import (
	"encoding/json"
	"testing"
)

// Without an IPv6 uplink the DNS answers must be IPv4-only; with one, the
// default strategy stays untouched.
func TestNoHostIPv6MakesDNSIPv4Only(t *testing.T) {
	n := parsed(t, "vless://a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d@203.0.113.30:443?encryption=none&security=tls&sni=a.example.com#N")
	for _, no := range []bool{true, false} {
		raw, err := BuildTUNConfig(n, "warn", Options{RemoteDNS: true, RouteMode: RouteBypassCN, NoHostIPv6: no})
		if err != nil {
			t.Fatal(err)
		}
		var cfg struct {
			DNS map[string]any `json:"dns"`
		}
		if err := json.Unmarshal(raw, &cfg); err != nil {
			t.Fatal(err)
		}
		got, has := cfg.DNS["strategy"]
		if no && got != "ipv4_only" || !no && has {
			t.Fatalf("NoHostIPv6=%v: dns.strategy = %v", no, got)
		}
	}
}
