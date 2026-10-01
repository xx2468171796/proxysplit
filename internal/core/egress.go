package core

import "proxysplit/internal/nodes"

// POWER云 account egress (signed profile accounts[].egress): destinations the
// node will not carry — the blocked list for every plan, and everything off the
// allowlist for 仅 AI. Tunnelling them would just break sites the user can
// already reach (domestic sites included), so the client keeps them off the
// line: every route entry that would use a restricted outbound tag becomes
// "blocked → direct", then (仅 AI) "allowlisted → that tag", then "otherwise →
// direct" (仅 AI) or the original entry. The node's own rejection stays as the
// guard against a modified client.

// listMatch is the sing-box match for a rule list (the fields inside one
// default rule are OR'ed). nil when the list is empty — an empty match would
// match everything.
func listMatch(l *nodes.EgressAllow) M {
	if l == nil {
		return nil
	}
	m := M{}
	put := func(key string, vals []string) {
		if v := cleanList(vals); len(v) > 0 {
			m[key] = v
		}
	}
	put("domain", l.Domains)
	put("domain_suffix", l.DomainSuffixes)
	put("domain_keyword", l.DomainKeywords)
	put("ip_cidr", l.IPCIDRs)
	if len(m) == 0 {
		return nil
	}
	return m
}

// egressPolicy is one tag's compiled restriction.
type egressPolicy struct {
	deny   M    // blocked destinations (exceptions already excluded); nil = none
	aiOnly bool // only allow may use the tag
	allow  M    // 仅 AI allowlist; nil = empty (nothing may use the tag)
}

// restrictedTags maps each restricted outbound tag to its policy.
type restrictedTags map[string]*egressPolicy

func (r restrictedTags) add(tag string, n *nodes.Node) {
	if n == nil || !n.Egress.Active() {
		return
	}
	e := n.Egress
	p := &egressPolicy{aiOnly: e.Restricted()}
	if p.aiOnly {
		p.allow = listMatch(e.Allow)
	}
	if deny := listMatch(e.Deny); deny != nil {
		if except := cleanList(e.DenyExcept); len(except) > 0 {
			deny = M{"type": "logical", "mode": "and", "rules": []M{deny, {"domain_suffix": except, "invert": true}}}
		}
		p.deny = deny
	}
	r[tag] = p
}

// and narrows match by extra (match may be empty = unconditional).
func and(match, extra M) M {
	if len(match) == 0 {
		return cloneMatch(extra)
	}
	return M{"type": "logical", "mode": "and", "rules": []M{cloneMatch(match), cloneMatch(extra)}}
}

// restrictEgress rewrites route rules and final for the restricted tags.
func restrictEgress(rules []M, final string, restricted restrictedTags) ([]M, string) {
	if len(restricted) == 0 {
		return rules, final
	}
	out := make([]M, 0, len(rules)+8)
	// expand appends the replacement of "match → tag"; it returns false when the
	// entry was unconditional and ends the rule list (the rest goes to final).
	expand := func(match M, tag string, p *egressPolicy) bool {
		if p.deny != nil {
			out = append(out, emit(and(match, p.deny), "direct"))
		}
		if !p.aiOnly {
			if len(match) == 0 {
				return false // caller keeps tag as final
			}
			out = append(out, emit(cloneMatch(match), tag))
			return true
		}
		if p.allow != nil {
			out = append(out, emit(and(match, p.allow), tag))
		}
		if len(match) == 0 {
			return false
		}
		out = append(out, emit(cloneMatch(match), "direct"))
		return true
	}
	for _, r := range rules {
		tag, _ := r["outbound"].(string)
		p, hit := restricted[tag]
		if !hit {
			out = append(out, r)
			continue
		}
		match := cloneMatch(r)
		delete(match, "outbound")
		delete(match, "action")
		if !expand(match, tag, p) {
			// Unconditional entry (sing-box rejects a rule without conditions):
			// later entries were unreachable anyway; what is left goes to final.
			if p.aiOnly {
				return out, "direct"
			}
			return out, tag
		}
	}
	if p, hit := restricted[final]; hit {
		expand(nil, final, p)
		if p.aiOnly {
			final = "direct"
		}
	}
	return out, final
}
