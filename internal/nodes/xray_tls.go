package nodes

import (
	"encoding/json"
	"net/url"
	"regexp"
	"strings"
)

// Xray v26.6.1 TLS extras (infra/conf/transport_internet.go TLSConfig):
// echConfigList, echForceQuery ("none" | "half" | "full" | ""),
// pinnedPeerCertSha256 (hex, "," separated, colon form accepted). The share
// link parameters follow v2rayN: ech, echForceQuery, pcs.

// needsXrayTLS: a TLS node using ECH or certificate pinning. Our sing-box
// outbound builder has neither (sing-box only pins public keys, not cert
// hashes), so such nodes run on Xray.
func (n *Node) needsXrayTLS() bool {
	if !n.xrayFamily() || n.Security != "tls" {
		return false
	}
	return n.ECH != "" || n.PinnedCert != ""
}

// applyTLSExtras reads ech / echForceQuery / pcs from a share link.
func applyTLSExtras(n *Node, q url.Values) {
	// A raw "+" (base64, or "domain+https://…") decodes as a space in a query.
	n.ECH = strings.TrimSpace(strings.ReplaceAll(q.Get("ech"), " ", "+"))
	n.ECHForceQuery = echForceQuery(q.Get("echForceQuery"))
	n.PinnedCert = pinnedCert(q.Get("pcs"))
}

// echForceQuery keeps only the values Xray accepts; anything else would stop
// the whole sidecar from starting.
func echForceQuery(v string) string {
	switch v = strings.ToLower(strings.TrimSpace(v)); v {
	case "none", "half", "full":
		return v
	}
	return ""
}

var certHash = regexp.MustCompile(`^[0-9a-fA-F:]{64,95}$`)

// pinnedCert keeps the well-formed SHA256 entries of a pcs list.
func pinnedCert(v string) string {
	var out []string
	for _, h := range strings.Split(v, ",") {
		h = strings.TrimSpace(h)
		if certHash.MatchString(h) && len(strings.ReplaceAll(h, ":", "")) == 64 {
			out = append(out, h)
		}
	}
	return strings.Join(out, ",")
}

// clashECH is Mihomo's `ech-opts` (config = base64 ECHConfigList). Without
// a config Mihomo queries DNS itself; that has no safe Xray equivalent here
// (Xray needs an explicit resolver), so only a static config is taken.
type clashECH struct {
	Enable bool   `yaml:"enable"`
	Config string `yaml:"config"`
}

func applyClashECH(n *Node, e clashECH) {
	if e.Enable && strings.TrimSpace(e.Config) != "" {
		n.ECH = strings.TrimSpace(e.Config)
	}
}

// xmuxKeys are XHTTP xmux fields: Int32Range (int or "a-b" string) except
// hKeepAlivePeriod (int64).
var xmuxKeys = map[string]bool{
	"maxConcurrency": true, "maxConnections": true, "cMaxReuseTimes": true,
	"hMaxRequestTimes": true, "hMaxReusableSecs": true, "hKeepAlivePeriod": false,
}

var rangeValue = regexp.MustCompile(`^\s*-?\d+\s*(-\s*-?\d+\s*)?$`)

// sanitizeExtra keeps an xhttp "extra" JSON object (compact). Unknown keys
// pass through (Xray ignores them), but a malformed xmux would make Xray
// refuse the whole config, so bad xmux values are dropped (and xmux itself
// when it is not an object).
func sanitizeExtra(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	var obj map[string]any
	if err := json.Unmarshal([]byte(s), &obj); err != nil {
		return ""
	}
	if raw, ok := obj["xmux"]; ok {
		if mux, ok := raw.(map[string]any); ok {
			obj["xmux"] = cleanXmux(mux)
		} else {
			delete(obj, "xmux")
		}
	}
	b, err := json.Marshal(obj)
	if err != nil {
		return ""
	}
	return string(b)
}

func cleanXmux(mux map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range mux {
		isRange, known := xmuxKeys[k]
		if !known {
			out[k] = v
			continue
		}
		switch val := v.(type) {
		case float64:
			if val == float64(int64(val)) {
				out[k] = int64(val)
			}
		case string:
			if isRange && rangeValue.MatchString(val) {
				out[k] = val
			}
		}
	}
	return out
}
