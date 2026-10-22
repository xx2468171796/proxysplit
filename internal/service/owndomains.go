package service

import "strings"

// ownDomesticSuffixes are our own sites hosted in mainland China: the AI relay
// gateways (sub2api.demo / codex.demo / ai.zygskins.cn …), panels and APIs.
// Tunnelling them through an overseas node only adds a round trip abroad and
// about 1 in 3 TLS handshakes fail (docs/memory/routing.md), so they always go
// direct — ahead of per-app lines, so Codex / VS Code set to 「线路」 still
// reach a domestic gateway directly. Never add them to the AI lock: the
// gateways must keep working when ProxySplit is off.
var ownDomesticSuffixes = []string{"zygskins.cn"}

// DirectDomains is the always-direct list: our own domestic sites plus the
// commercial API host (empty = not configured).
func DirectDomains(apiHost string) []string {
	out := append([]string(nil), ownDomesticSuffixes...)
	if h := strings.TrimSpace(strings.ToLower(apiHost)); h != "" && !coveredBy(h, out) {
		out = append(out, h)
	}
	return out
}

func coveredBy(host string, suffixes []string) bool {
	for _, s := range suffixes {
		if host == s || strings.HasSuffix(host, "."+s) {
			return true
		}
	}
	return false
}
