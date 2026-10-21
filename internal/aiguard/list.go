// Package aiguard keeps AI-service traffic of AI-site (aigw) customers on our
// own line: the destination list, and the Windows NRPT lock that makes those
// domains unresolvable whenever ProxySplit's tunnel is not up (fail-closed —
// never reach an account-sensitive AI service from the customer's own,
// mainland IP).
//
// ai.json is a verbatim copy of the company rule pack's "ai" category
// (powervpn repo packages/core/data/rulepack/ai.json). Update it by copying the
// file again and bumping RulepackVersion; never edit the list here by hand.
package aiguard

import (
	_ "embed"
	"encoding/json"
	"strings"
)

// RulepackVersion is the rule-pack version ai.json was copied from.
const RulepackVersion = "2026.10.16.1"

//go:embed ai.json
var aiJSON []byte

type category struct {
	ID           string   `json:"id"`
	DomainSuffix []string `json:"domain_suffix"`
	Domain       []string `json:"domain"`
	IPCIDR       []string `json:"ip_cidr"`
}

var ai = mustParse(aiJSON)

func mustParse(raw []byte) category {
	var c category
	if err := json.Unmarshal(raw, &c); err != nil || c.ID != "ai" || len(c.DomainSuffix) == 0 {
		panic("aiguard: bad embedded ai.json")
	}
	return c
}

// DomainSuffixes are the AI service domains (each matches itself and every
// subdomain, sing-box domain_suffix semantics).
func DomainSuffixes() []string { return append([]string(nil), ai.DomainSuffix...) }

// Domains are exact-match AI hosts (usually empty).
func Domains() []string { return append([]string(nil), ai.Domain...) }

// IPCIDRs are AI providers' own address ranges (traffic dialled by IP).
func IPCIDRs() []string { return append([]string(nil), ai.IPCIDR...) }

// Namespaces is the NRPT namespace list for the lock: ".x" covers the
// subdomains of x and "x" the name itself (NRPT has no single entry for both).
func Namespaces() []string {
	out := make([]string, 0, 2*len(ai.DomainSuffix)+len(ai.Domain))
	for _, s := range ai.DomainSuffix {
		s = strings.Trim(strings.ToLower(s), ".")
		out = append(out, "."+s, s)
	}
	for _, d := range ai.Domain {
		out = append(out, strings.Trim(strings.ToLower(d), "."))
	}
	return out
}

// Covers reports whether host is on the AI list (used by checks and tests).
func Covers(host string) bool {
	h := strings.Trim(strings.ToLower(host), ".")
	for _, s := range ai.DomainSuffix {
		if h == s || strings.HasSuffix(h, "."+s) {
			return true
		}
	}
	for _, d := range ai.Domain {
		if h == d {
			return true
		}
	}
	return false
}
