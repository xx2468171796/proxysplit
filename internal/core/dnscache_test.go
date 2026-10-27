package core

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"proxysplit/internal/nodes"
)

type tunDoc struct {
	DNS          map[string]any   `json:"dns"`
	Inbounds     []map[string]any `json:"inbounds"`
	Outbounds    []map[string]any `json:"outbounds"`
	Route        map[string]any   `json:"route"`
	Experimental map[string]any   `json:"experimental"`
}

func tunDocOf(t *testing.T, node *nodes.Node, opts Options) tunDoc {
	t.Helper()
	raw, err := BuildTUNConfig(node, "warn", opts)
	if err != nil {
		t.Fatal(err)
	}
	var d tunDoc
	if err := json.Unmarshal(raw, &d); err != nil {
		t.Fatal(err)
	}
	return d
}

func guardedOpts(t *testing.T) Options {
	exe, _ := os.Executable()
	opts := placement(matrixOpts(true), filepath.Base(exe), "未列出")
	opts.AIGuard = guardFor("proxy")
	return opts
}

// TestAIGuardUntouchedByPreresolveAndCache: with the AI guard on, adding
// ServerIPs, the optimistic cache and the cache file changes nothing but the
// dialed address: AI DNS rules / servers, every route rule (and so the AI
// rules' position), the TUN inbound (addresses incl. aiTUN6) are identical,
// and neither cache is enabled.
func TestAIGuardUntouchedByPreresolveAndCache(t *testing.T) {
	node := &nodes.Node{ID: "n1", Name: "n", Type: "trojan", Server: pinDomain, Port: 443, Password: "p"}
	before := tunDocOf(t, node, guardedOpts(t))
	opts := guardedOpts(t)
	opts.ServerIPs, opts.DNSOptimistic, opts.DNSCacheFile = pinIPs, true, `C:\data\dns-cache.db`
	after := tunDocOf(t, node, opts)

	if js, _ := json.Marshal(before.DNS); !json.Valid(js) || !strings.Contains(string(js), `"rewrite_ttl":10`) {
		t.Fatalf("guard not active in fixture: %s", js)
	}
	if !reflect.DeepEqual(before.DNS, after.DNS) {
		t.Fatalf("dns block changed:\n%v\n%v", before.DNS, after.DNS)
	}
	if _, ok := after.DNS["optimistic"]; ok {
		t.Fatal("optimistic cache enabled with the AI guard on")
	}
	if c := after.Experimental["cache_file"]; c != nil {
		t.Fatalf("cache_file enabled with the AI guard on: %v", c)
	}
	if !reflect.DeepEqual(before.Route, after.Route) {
		t.Fatal("route (rules / order) changed")
	}
	if !reflect.DeepEqual(before.Inbounds, after.Inbounds) {
		t.Fatal("inbounds (TUN addresses / ai-proxy-in) changed")
	}
	if !reflect.DeepEqual(before.Experimental, after.Experimental) {
		t.Fatal("experimental changed")
	}
	// Only the dialed server of the node changed.
	b, a := before.Outbounds[0], after.Outbounds[0]
	if a["server"] != pinIP || b["server"] != pinDomain {
		t.Fatalf("server %v -> %v", b["server"], a["server"])
	}
	a["server"] = b["server"]
	if !reflect.DeepEqual(b, a) {
		t.Fatalf("outbound changed beyond server:\n%v\n%v", b, a)
	}
}

// TestDNSCacheWithoutGuard: guard off = optimistic + store_dns cache file,
// accepted by the real core.
func TestDNSCacheWithoutGuard(t *testing.T) {
	node := &nodes.Node{ID: "n1", Name: "n", Type: "trojan", Server: pinDomain, Port: 443, Password: "p"}
	dir := t.TempDir()
	opts := Options{DNSOptimistic: true, DNSCacheFile: filepath.Join(dir, "dns-cache.db"), ClashController: "127.0.0.1:9", GeoDir: filepath.Join("..", "..", "bin")}
	d := tunDocOf(t, node, opts)
	if d.DNS["optimistic"] != true {
		t.Fatal("optimistic missing")
	}
	cf, _ := d.Experimental["cache_file"].(map[string]any)
	if cf["store_dns"] != true || cf["enabled"] != true || d.Experimental["clash_api"] == nil {
		t.Fatalf("experimental %v", d.Experimental)
	}
	raw, _ := BuildTUNConfig(node, "warn", opts)
	p := filepath.Join(dir, "c.json")
	if err := os.WriteFile(p, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command(singboxPath(t), "check", "-c", p).CombinedOutput(); err != nil {
		t.Fatalf("sing-box check: %v\n%s", err, out)
	}
}
