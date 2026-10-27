package core

import (
	"bytes"
	"flag"
	"net/netip"
	"os"
	"path/filepath"
	"testing"

	"proxysplit/internal/nodes"
	"proxysplit/internal/xray"
)

// Golden snapshots pin the exact generated configs so refactors of the
// builders stay byte-identical. Regenerate with:
//
//	go test ./internal/core -run Golden -update
var updateGolden = flag.Bool("update", false, "rewrite testdata/golden/*.json")

func goldenNode(t *testing.T, link string) *nodes.Node {
	t.Helper()
	n, err := nodes.ParseLink(sampleLinks[link])
	if err != nil {
		t.Fatal(err)
	}
	return n
}

// goldenSplit is a representative app-split option set with fixed paths.
func goldenSplit(t *testing.T, whitelist bool) Options {
	return Options{
		GeoDir: "GEO", RuleDir: "RULES", Split: true, SplitWhitelist: whitelist, RemoteDNS: true,
		ClashController: "127.0.0.1:19095", ClashSecret: "secret", ClashMode: "rule",
		SelfProcess: "proxysplit.exe", PortProcessPath: `C:\x\sing-box.exe`,
		DirectDomains: []string{"api.example.cn"},
		CustomRules:   []RouteRule{{Type: "suffix", Value: "custom.com", Action: "direct"}},
		SplitGroups: []SplitGroup{
			{Key: "rule|proxy|bypass_cn", Names: []string{"chrome.exe", `dir:D:\Games`}, Mode: RouteBypassCN, NodeTag: "proxy"},
			{Key: "global|proxy|global", Names: []string{"telegram.exe"}, Mode: RouteGlobal, NodeTag: "proxy"},
			{Key: "custom|node-x|custom", Names: []string{"steam.exe"}, Mode: RouteCustom, NodeTag: "node-x",
				Rules: []RouteRule{{Type: "keyword", Value: "tracker", Action: "block"}, {Type: "suffix", Value: "cn", Action: "direct"}}},
		},
		SplitDirect: []string{"code.exe"},
		SplitBlock:  []string{"bad.exe"},
		SplitScoped: []ScopedRule{
			{Name: "code.exe", Domains: []string{"github.com"}, Outbound: "proxy"},
			{Name: "chrome.exe", IPs: []string{"10.1.0.0/16"}, Outbound: "direct"},
			{Name: "chrome.exe", Ports: []string{"6881-6889"}, Outbound: "reject"},
		},
		ExtraNodes: []ExtraNode{{Tag: "node-x", Node: goldenNode(t, "trojan")}},
	}
}

func goldenProcess(opts Options) Options {
	ports := map[string]int{}
	for i, tag := range ProcessInbounds(opts) {
		ports[tag] = 30000 + i
	}
	opts.Process = &ProcessCapture{Ports: ports}
	return opts
}

func TestGoldenConfigs(t *testing.T) {
	old := localPrefixes
	localPrefixes = func() []netip.Prefix { return []netip.Prefix{netip.MustParsePrefix("192.168.1.10/24")} }
	t.Cleanup(func() { localPrefixes = old })

	reality := goldenNode(t, "vless-reality")
	vmess := goldenNode(t, "vmess-ws")
	cases := map[string]func() ([]byte, error){}
	tun := func(name string, n *nodes.Node, o Options) {
		cases["tun-"+name] = func() ([]byte, error) { return BuildTUNConfig(n, "warn", o) }
	}
	proc := func(name string, o Options) {
		cases["process-"+name] = func() ([]byte, error) { return BuildProcessConfig(reality, "warn", goldenProcess(o)) }
	}

	white, black := goldenSplit(t, true), goldenSplit(t, false)
	tun("split-whitelist", reality, white)
	black.SplitDefault = &SplitGroup{Mode: RouteCustom, NodeTag: "node-x", Rules: []RouteRule{{Type: "ip", Value: "10.0.0.0/8", Action: "direct"}}}
	tun("split-blacklist-default", reality, black)
	blackPlain := goldenSplit(t, false)
	tun("split-blacklist", reality, blackPlain)

	quic := goldenSplit(t, true)
	quic.BlockQUIC, quic.ProxyPrivate = true, true
	tun("split-quic", reality, quic)

	guard := goldenSplit(t, true)
	guard.AIGuard = guardFor("node-x")
	guard.AIGuard.STUNProcesses = []string{"chrome.exe"}
	guard.AIProxy = &AIProxy{Port: 17001, User: "u", Pass: "p", Outbound: "node-x"}
	guard.ExitProbe = &AIProxy{Port: 17002, Outbound: "proxy"}
	guard.AccelPort, guard.AccelOutbound = 17003, "proxy"
	tun("split-aiguard", reality, guard)

	accel := goldenSplit(t, false)
	accel.AccelPort, accel.AccelOutbound = 17003, "node-x"
	tun("split-accel", reality, accel)

	lan := Options{GeoDir: "GEO", RouteMode: RouteBypassCN, LanShare: true, LanPort: 7891, LanType: "socks", LanUser: "u", LanPass: "p",
		ClashController: "127.0.0.1:19095", BlockQUIC: true, RuleSets: &RuleSetOptions{GeoSiteCN: true, GeoIPCN: false, Ads: true}}
	tun("global-bypasscn-lan", reality, lan)
	tun("global-custom", vmess, Options{GeoDir: "GEO", RouteMode: RouteCustom, SelfProcess: "proxysplit.exe",
		RouteRules: []RouteRule{{Type: "domain", Value: "a.com", Action: "proxy"}, {Type: "ip", Value: "10.0.0.0/8", Action: "direct"}, {Type: "keyword", Value: "ad", Action: "block"}}})
	tun("global-plain", reality, Options{RouteMode: RouteGlobal, DNSOptimistic: true, DNSCacheFile: "CACHE/dns.db"})
	tun("global-pinned", reality, Options{RouteMode: RouteGlobal, ServerIPs: map[string]string{"example.com": "1.2.3.4"}})

	xn := &nodes.Node{ID: "x1", Name: "x", Type: "vless", Server: "example.com", Port: 443,
		UUID: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", Security: "tls", Network: "xhttp", Path: "/x"}
	xo := Options{RouteMode: RouteBypassCN, GeoDir: "GEO", XrayPath: `C:\x\xray.exe`,
		XrayPorts: map[string]xray.Endpoint{xray.Key(xn): {Port: 31001, User: "u", Pass: "p"}}}
	tun("xray", xn, xo)

	proc("whitelist", goldenSplit(t, true))
	proc("blacklist", goldenSplit(t, false))
	pq := goldenSplit(t, false)
	pq.BlockQUIC = true
	pq.SplitDefault = &SplitGroup{Mode: RouteGlobal, NodeTag: "node-x"}
	proc("blacklist-quic", pq)

	multiOpts := Options{GeoDir: "GEO", RemoteDNS: true, ClashController: "127.0.0.1:19095", DirectDomains: []string{"api.example.cn"},
		LanShare: true, CustomRules: []RouteRule{{Type: "suffix", Value: "custom.com", Action: "block"}}}
	cases["single-line"] = func() ([]byte, error) {
		return BuildConfig(reality, 17890, "", Options{RouteMode: RouteBypassCN, GeoDir: "GEO"})
	}
	cases["multi-line"] = func() ([]byte, error) {
		return BuildMultiConfig([]LineConfig{
			{Key: "a", InboundPort: 17891, Node: reality, RouteMode: RouteBypassCN},
			{Key: "b", InboundPort: 17892, Node: vmess, RouteMode: RouteCustom,
				RouteRules: []RouteRule{{Type: "suffix", Value: "x.com", Action: "direct"}, {Type: "keyword", Value: "ad", Action: "block"}, {Type: "domain", Value: "y.com"}}},
			{Key: "c", InboundPort: 17893, Node: reality, RouteMode: RouteGlobal},
		}, "debug", multiOpts)
	}
	for _, mode := range []string{"rule", "global", "direct"} {
		mode := mode
		cases["port-"+mode] = func() ([]byte, error) {
			n := reality
			if mode == "direct" {
				n = nil
			}
			return BuildPortConfig(PortConfig{Listen: "0.0.0.0", Port: 10801, Protocol: "socks", User: "u", Pass: "p", Node: n, Mode: mode,
				ClashController: "127.0.0.1:1", ClashSecret: "s", GeoDir: "GEO", DirectDomains: []string{"api.example.cn"}})
		}
	}

	dir := filepath.Join("testdata", "golden")
	if *updateGolden {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for name, build := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := build()
			if err != nil {
				t.Fatal(err)
			}
			got = append(got, '\n')
			path := filepath.Join(dir, name+".json")
			if *updateGolden {
				if err := os.WriteFile(path, got, 0o644); err != nil {
					t.Fatal(err)
				}
				return
			}
			want, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("missing golden (run with -update): %v", err)
			}
			if !bytes.Equal(bytes.ReplaceAll(want, []byte("\r\n"), []byte("\n")), got) {
				t.Fatalf("%s differs from golden; rerun with -update only if the change is intended", path)
			}
		})
	}
}
