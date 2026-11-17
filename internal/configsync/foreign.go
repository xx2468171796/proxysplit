package configsync

// What may cross between a bundle and this machine. A bundle is foreign data:
// a share code or file from someone else, or a cloud copy written by another
// computer. Two kinds of things never cross, in either direction:
//
//   - account lines: POWER云 nodes belong to the signed-in account. The core
//     trusts them (raw outbounds passed through untouched, egress policy,
//     identity by officialKey), so a bundle node must not be able to claim to
//     be one.
//   - LAN exposure: whether a proxy listens on the LAN, and with which
//     credentials, is this machine's decision. Exporting it leaks the
//     credentials into files / share codes; importing it could open an
//     unauthenticated proxy on the user's network.

// accountNodeKeys mark a node as an account (POWER云) line.
var accountNodeKeys = []string{"official", "accountId", "officialKey", "egress"}

// machineLocalKeys are the LAN-exposure keys of each section's objects.
var (
	localSettingsKeys  = []string{"lanShare", "lanUser", "lanPass"}
	localProxyPortKeys = []string{"lan", "user", "pass"}
)

func claimsAccount(n obj) bool {
	for _, k := range accountNodeKeys {
		switch v := n[k].(type) {
		case nil:
		case bool:
			if v {
				return true
			}
		case string:
			if v != "" {
				return true
			}
		default:
			return true
		}
	}
	return false
}

// foreignNodes filters the nodes of a bundle section down to what a bundle may
// carry: no node claiming to be an account line, none reusing the id of one of
// this machine's account lines, and a subscription link only to a
// subscription that came in the same bundle (subIDs; nil for the manual-node
// section, whose nodes have no subscription).
func foreignNodes(nodes []obj, accountIDs, subIDs map[string]bool) []obj {
	out := make([]obj, 0, len(nodes))
	for _, n := range nodes {
		if claimsAccount(n) || accountIDs[str(n, "id")] {
			continue
		}
		if sub := str(n, "subId"); (subIDs == nil) != (sub == "") || (sub != "" && !subIDs[sub]) {
			continue
		}
		out = append(out, n)
	}
	return out
}

// foreignSubs drops subscriptions a bundle may not carry: the POWER云 profile
// subscription, and any reusing the id of one this machine keeps (taken).
func foreignSubs(subs []obj, taken map[string]bool) []obj {
	out := make([]obj, 0, len(subs))
	for _, s := range subs {
		if id := str(s, "id"); id == "" || taken[id] || str(s, "url") == officialSubURL {
			continue
		}
		out = append(out, s)
	}
	return out
}

func idSet(items []obj) map[string]bool {
	out := make(map[string]bool, len(items))
	for _, it := range items {
		out[str(it, "id")] = true
	}
	return out
}

// without returns a copy of m lacking keys.
func without(m obj, keys []string) obj {
	c := make(obj, len(m))
	for k, v := range m {
		c[k] = v
	}
	for _, k := range keys {
		delete(c, k)
	}
	return c
}

// keepLocal makes dst carry this machine's values of keys (from local): a
// bundle's own values are discarded, missing local values stay missing.
func keepLocal(dst, local obj, keys []string) {
	for _, k := range keys {
		if v, ok := local[k]; ok {
			dst[k] = v
		} else {
			delete(dst, k)
		}
	}
}

// portableSettings / portablePorts are the two sections without the
// machine-local keys, as they are exported and hashed.
func portableSettings(v any) any {
	if m, ok := v.(obj); ok {
		return without(m, localSettingsKeys)
	}
	return v
}

func portablePorts(v any) any {
	ports := list(v)
	out := make([]any, len(ports))
	for i, p := range ports {
		out[i] = without(p, localProxyPortKeys)
	}
	return out
}

// keepLocalExposure restores this machine's LAN exposure on the merged config
// after settings / proxy ports were taken from a bundle. prev is the config as
// it was before the merge.
func keepLocalExposure(cfg, prev obj, settings, ports bool) {
	if set, ok := cfg["settings"].(obj); ok && settings {
		local, _ := prev["settings"].(obj)
		keepLocal(set, local, localSettingsKeys)
	}
	if !ports {
		return
	}
	localPorts := map[string]obj{}
	for _, p := range list(prev["proxyPorts"]) {
		localPorts[str(p, "id")] = p
	}
	for _, p := range list(cfg["proxyPorts"]) {
		keepLocal(p, localPorts[str(p, "id")], localProxyPortKeys) // unknown port: no exposure, no credentials
	}
}
