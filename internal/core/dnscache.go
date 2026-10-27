package core

import "strings"

// applyDNSCache turns on sing-box 1.14's optimistic DNS cache (an expired
// answer is served at once while a background refresh runs) and the
// persistent cache file (experimental.cache_file.store_dns: restarts begin
// with a warm cache).
//
// Both stay OFF whenever the AI guard is active: AI names are answered with a
// client TTL capped at aiDNSTTL so they expire seconds after a stop, and a
// stale or persisted AI answer must never outlive the guard. sing-box cannot
// exempt single rules from either cache, so the whole feature is skipped.
func applyDNSCache(cfg, dnsBlock M, opts Options) {
	if opts.AIGuardActive() {
		return
	}
	if opts.DNSOptimistic {
		dnsBlock["optimistic"] = true
	}
	if opts.DNSCacheFile == "" {
		return
	}
	exp, _ := cfg["experimental"].(M)
	if exp == nil {
		exp = M{}
	}
	exp["cache_file"] = M{"enabled": true, "path": strings.ReplaceAll(opts.DNSCacheFile, "\\", "/"), "store_dns": true}
	cfg["experimental"] = exp
}
