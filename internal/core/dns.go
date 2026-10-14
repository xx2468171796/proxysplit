package core

import (
	"net"
	"strings"
)

// DNS for the TUN configs (整机全局 and 应用分流 both run on TUN).
//
// 远程解析域名 (Options.RemoteDNS) on — the default:
//   - mainland names (geosite-cn), our own API, node servers, LAN / reverse
//     names and the fake-IP exclusions below resolve on the China resolver,
//     DIRECT (real addresses);
//   - any other name is first asked on the China resolver (a few ms, no border
//     crossing): an answer inside China or a private network is kept, so
//     China-hosted names outside geosite-cn still go direct by geoip-cn;
//   - everything else gets a fake IPv4 at once (no round trip at all). The
//     connection to the fake IP carries the name to the route rules, and the
//     node resolves it on its side (anti-pollution, nothing resolved locally);
//     a direct-routed connection resolves it on the China resolver.
//
// 远程解析域名 off: every name resolves on the China resolver (no fake IPs).
//
// Both: the TUN is IPv4-only, so AAAA answers are always empty (a real IPv6
// address would make apps connect around the tunnel); the cache keeps 8192
// answers, serves expired ones at once for up to an hour while refreshing in
// the background (optimistic), and — with Options.CacheFile — survives a core
// restart together with the fake-IP table.

const (
	dnsDirect = "dns-direct"
	dnsRemote = "dns-remote"
	dnsFakeIP = "fakeip"

	// FakeIPRange is the IPv4 pool fake answers come from (RFC 2544
	// benchmarking range, never routed on the internet).
	FakeIPRange = "198.18.0.0/15"

	dnsCacheCapacity     = 8192
	dnsOptimisticTimeout = "1h"
)

// fakeIPExcludeSuffixes always get real answers: names apps compare or need to
// reach by their real address (Windows network status probe, time sync, NAT /
// STUN detection, Xbox Live) and local / reverse names.
var fakeIPExcludeSuffixes = []string{
	// LAN and reverse lookups
	"lan", "local", "localdomain", "localhost", "home.arpa", "internal", "in-addr.arpa", "ip6.arpa",
	// Windows network connectivity status (NCSI compares dns.msftncsi.com's answer)
	"msftconnecttest.com", "msftncsi.com",
	// captive portal / connectivity checks of other software on Windows
	"captive.apple.com", "detectportal.firefox.com", "connectivitycheck.gstatic.com",
	// time sync
	"time.windows.com", "time.nist.gov", "ntp.org", "time.apple.com",
	// NAT type detection
	"xboxlive.com",
}

// fakeIPExcludeRegex catches STUN servers (stun.l.google.com, stun.miwifi.com…).
var fakeIPExcludeRegex = []string{`(^|\.)stun\.`}

// fakeIPOn reports whether a TUN config answers foreign names with fake IPs.
func fakeIPOn(opts Options) bool { return opts.RemoteDNS }

// dnsCacheOptions are the cache settings shared by every generated config.
func dnsCacheOptions(dns M) {
	dns["cache_capacity"] = dnsCacheCapacity
	dns["optimistic"] = M{"enabled": true, "timeout": dnsOptimisticTimeout}
}

// serverHosts returns the domain names (not IPs) the given outbounds dial, so
// node servers always resolve to real addresses.
func serverHosts(outbounds []M) []string {
	var out []string
	seen := map[string]bool{}
	for _, o := range outbounds {
		h, _ := o["server"].(string)
		h = strings.ToLower(strings.TrimSpace(h))
		if h == "" || net.ParseIP(h) != nil || seen[h] {
			continue
		}
		seen[h] = true
		out = append(out, h)
	}
	return out
}

// tunDNS builds the dns block of a TUN config. nodeHosts are the outbound
// server names (see serverHosts).
func tunDNS(opts Options, nodeHosts []string) M {
	servers := []M{
		// Foreign resolver through the node, for what fake IPs don't cover
		// (TXT / MX / SRV … of foreign names).
		{"type": "udp", "tag": dnsRemote, "server": "8.8.8.8", "detour": "proxy"},
		// China resolver, DIRECT — reachable even when the node is down.
		{"type": "udp", "tag": dnsDirect, "server": "223.5.5.5"},
	}
	// IPv4-only TUN: never hand out IPv6 addresses.
	rules := []M{{"query_type": []string{"AAAA"}, "action": "predefined", "rcode": "NOERROR"}}
	rules = append(rules, clashDNSRules(opts)...)
	real := M{"domain_suffix": fakeIPExcludeSuffixes, "domain_regex": fakeIPExcludeRegex, "server": dnsDirect}
	rules = append(rules, real)
	if names := realNames(opts, nodeHosts); len(names) > 0 {
		rules = append(rules, M{"domain": names, "domain_suffix": names, "server": dnsDirect})
	}
	rules = append(rules, M{"rule_set": []string{"geosite-cn"}, "server": dnsDirect})

	final := dnsDirect
	if fakeIPOn(opts) {
		servers = append(servers, M{"type": "fakeip", "tag": dnsFakeIP, "inet4_range": FakeIPRange})
		rules = append(rules,
			// Unknown names: keep the China resolver's answer when it points into
			// China or a private network…
			M{"query_type": []string{"A"}, "action": "evaluate", "server": dnsDirect},
			M{
				"type": "logical", "mode": "or",
				"rules": []M{
					{"match_response": true, "rule_set": []string{"geoip-cn"}},
					{"match_response": true, "ip_is_private": true},
				},
				"action": "respond",
			},
			// …otherwise the name is foreign: fake IPv4, no HTTPS / SVCB records
			// (their address hints and ECH would bypass the fake IP).
			M{"query_type": []string{"A"}, "server": dnsFakeIP},
			M{"query_type": []string{"HTTPS", "SVCB"}, "action": "predefined", "rcode": "NOERROR"},
		)
		final = dnsRemote
	}
	dns := M{"servers": servers, "rules": rules, "final": final}
	dnsCacheOptions(dns)
	return dns
}

// realNames are our own API domains and the node servers: always real answers.
func realNames(opts Options, nodeHosts []string) []string {
	var out []string
	seen := map[string]bool{}
	for _, d := range append(append([]string(nil), opts.DirectDomains...), nodeHosts...) {
		d = strings.TrimSpace(strings.ToLower(d))
		if d == "" || seen[d] {
			continue
		}
		seen[d] = true
		out = append(out, d)
	}
	return out
}

// withCacheFile adds the persistent cache (fake-IP table + DNS answers) to the
// experimental block. No-op without a path: probes and checks run beside the
// main core and must not open its cache file (it is locked while in use).
func withCacheFile(exp M, opts Options) M {
	if opts.CacheFile == "" {
		return exp
	}
	if exp == nil {
		exp = M{}
	}
	exp["cache_file"] = M{
		"enabled":      true,
		"path":         strings.ReplaceAll(opts.CacheFile, "\\", "/"),
		"store_fakeip": fakeIPOn(opts),
		"store_dns":    true,
	}
	return exp
}
