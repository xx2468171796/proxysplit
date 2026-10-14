package core

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"proxysplit/internal/nodes"
)

// tunCfgFor builds a TUN config and returns it decoded and raw.
func tunCfgFor(t *testing.T, opts Options) (M, []byte) {
	t.Helper()
	node, err := nodes.ParseLink(sampleLinks["vless-reality"])
	if err != nil {
		t.Fatal(err)
	}
	if opts.GeoDir == "" {
		opts.GeoDir, _ = filepath.Abs(filepath.Join("..", "..", "bin"))
	}
	if opts.Split && opts.RuleDir == "" {
		opts.RuleDir = t.TempDir()
		if err := writeRuleSets(opts); err != nil {
			t.Fatal(err)
		}
	}
	b, err := BuildTUNConfig(node, "info", opts)
	if err != nil {
		t.Fatal(err)
	}
	var cfg M
	if err := json.Unmarshal(b, &cfg); err != nil {
		t.Fatal(err)
	}
	return cfg, b
}

func dnsServerTags(dns M) map[string]M {
	out := map[string]M{}
	for _, s := range dns["servers"].([]interface{}) {
		m := s.(map[string]interface{})
		out[m["tag"].(string)] = m
	}
	return out
}

// TestTUNDNSMatrix checks the TUN dns block for 远程解析域名 on/off × 整机全局 /
// 应用分流 × clash on/off, and that the real core accepts every variant.
func TestTUNDNSMatrix(t *testing.T) {
	bin := singboxPath(t)
	for _, remote := range []bool{true, false} {
		for _, split := range []bool{false, true} {
			for _, clash := range []bool{false, true} {
				opts := Options{RemoteDNS: remote, Split: split, SplitWhitelist: true,
					DirectDomains: []string{"proxysplit.example.cn"}, CacheFile: filepath.Join(t.TempDir(), "cache.db")}
				if clash {
					opts.ClashController = "127.0.0.1:19090"
				}
				cfg, raw := tunCfgFor(t, opts)
				dns := cfg["dns"].(map[string]interface{})
				tags := dnsServerTags(dns)
				name := map[bool]string{true: "remote", false: "local"}[remote] + "/" +
					map[bool]string{true: "split", false: "tun"}[split] + "/" +
					map[bool]string{true: "clash", false: "noclash"}[clash]

				_, hasFake := tags[dnsFakeIP]
				if hasFake != remote {
					t.Errorf("%s: fakeip server present=%v", name, hasFake)
				}
				if hasFake && tags[dnsFakeIP]["inet4_range"] != FakeIPRange {
					t.Errorf("%s: fakeip range %v", name, tags[dnsFakeIP]["inet4_range"])
				}
				if _, ok := tags[dnsFakeIP]["inet6_range"]; ok {
					t.Errorf("%s: fakeip must be IPv4-only", name)
				}
				wantFinal := map[bool]string{true: dnsRemote, false: dnsDirect}[remote]
				if dns["final"] != wantFinal {
					t.Errorf("%s: final %v, want %s", name, dns["final"], wantFinal)
				}
				if o, _ := dns["optimistic"].(map[string]interface{}); o["enabled"] != true || o["timeout"] != dnsOptimisticTimeout {
					t.Errorf("%s: optimistic %v", name, dns["optimistic"])
				}
				if dns["cache_capacity"] != float64(dnsCacheCapacity) {
					t.Errorf("%s: cache_capacity %v", name, dns["cache_capacity"])
				}
				rules := dns["rules"].([]interface{})
				first := rules[0].(map[string]interface{})
				if first["action"] != "predefined" || first["query_type"].([]interface{})[0] != "AAAA" {
					t.Errorf("%s: AAAA must be answered empty first, got %v", name, first)
				}
				s := string(raw)
				for _, want := range []string{`"msftncsi.com"`, `"proxysplit.example.cn"`, `"example.com"`, `"lan"`} {
					if !strings.Contains(s, want) {
						t.Errorf("%s: real-answer list misses %s", name, want)
					}
				}
				exp := cfg["experimental"].(map[string]interface{})
				cf := exp["cache_file"].(map[string]interface{})
				if cf["enabled"] != true || cf["store_dns"] != true || cf["store_fakeip"] != remote || cf["path"] == "" {
					t.Errorf("%s: cache_file %v", name, cf)
				}
				if _, ok := exp["clash_api"]; ok != clash {
					t.Errorf("%s: clash_api present=%v", name, ok)
				}
				{
					p := filepath.Join(t.TempDir(), "cfg.json")
					os.WriteFile(p, raw, 0o600)
					if out, err := exec.Command(bin, "check", "-c", p).CombinedOutput(); err != nil {
						t.Fatalf("%s: sing-box check rejected:\n%s\n%s", name, out, raw)
					}
				}
			}
		}
	}
}

// Probes / checks never get a cache file (it is locked by the main core).
func TestNoCacheFileWithoutPath(t *testing.T) {
	cfg, _ := tunCfgFor(t, Options{RemoteDNS: true})
	if _, ok := cfg["experimental"]; ok {
		t.Fatalf("experimental without clash / cache file: %v", cfg["experimental"])
	}
	node, _ := nodes.ParseLink(sampleLinks["vless-reality"])
	b, err := BuildConfig(node, 17890, "info", Options{RemoteDNS: true})
	if err != nil {
		t.Fatal(err)
	}
	var c M
	json.Unmarshal(b, &c)
	if _, ok := c["experimental"]; ok {
		t.Fatalf("single-line config must not carry a cache file: %s", b)
	}
	dns := c["dns"].(map[string]interface{})
	if _, ok := dnsServerTags(dns)[dnsFakeIP]; ok {
		t.Fatal("non-TUN config must not use fake IPs")
	}
	if o, _ := dns["optimistic"].(map[string]interface{}); o["enabled"] != true {
		t.Fatalf("non-TUN config should still cache optimistically: %v", dns)
	}
}

func TestManagerTUNConfigUsesDataDirCache(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(filepath.Join(dir, "sing-box.exe"), dir, nil)
	node, _ := nodes.ParseLink(sampleLinks["vless-reality"])
	_, opts, err := m.tunConfig(node, "info", RouteBypassCN, nil, Options{RemoteDNS: true})
	if err != nil {
		t.Fatal(err)
	}
	if opts.CacheFile != filepath.Join(dir, "cache.db") {
		t.Fatalf("cache file %q", opts.CacheFile)
	}
}
