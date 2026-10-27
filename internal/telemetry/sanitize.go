package telemetry

import (
	"regexp"
	"strings"
)

// Sanitisation keeps what debugging needs (domains, IPs, ports, process
// names, error text) and removes anything that would let the reader use the
// user's nodes or accounts: share links, passwords, UUIDs, Reality / TLS keys,
// tokens, auth headers, the clash secret, URL query strings; e-mails are
// masked. Applied before anything is written to the on-disk spool.

const maxLineLen = 4096

var (
	reShareLink = regexp.MustCompile(`(?i)\b(vmess|vless|trojan|ssr|ss|hysteria2|hysteria|hy2|tuic|anytls|wireguard|wg|socks5h|socks5|socks4a|socks4|socks|naive\+https|naive\+quic|shadowtls)://[^\s"'<>]+`)
	// Any other URL: credentials in the userinfo go.
	reUserinfo = regexp.MustCompile(`(?i)\b([a-z][a-z0-9+.-]*://)[^\s/@"'<>]+@`)
	// http(s) / ws(s) URLs keep scheme and host only: paths of subscription
	// links carry tokens (https://host/link/AbC123), queries carry keys.
	reWebURL  = regexp.MustCompile(`(?i)\b(https?|wss?)://(?:[^\s/@"'<>]*@)?([^\s/?#"'<>]+)([^\s"'<>]*)`)
	reJWT     = regexp.MustCompile(`\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}`)
	reAuthHdr = regexp.MustCompile(`(?i)\b(authorization|proxy-authorization)(\s*[:=]\s*)("?)(bearer|basic)?\s*[^\s",}]+`)
	reBearer  = regexp.MustCompile(`(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}`)
	reKV      = regexp.MustCompile(`(?i)("?)\b(password|passwd|pass|pwd|secret|token|access_?token|refresh_?token|api_?token|private_?key|public_?key|short_?id|uuid|psk|pre_?shared_?key|auth_?str|auth|obfs_?password|lan_?pass|lan_?user|username|user)("?)(\s*[:=]\s*)("?)([^\s",;&}]+)`)
	reUUID    = regexp.MustCompile(`(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`)
	reEmail   = regexp.MustCompile(`\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b`)
	// Long base64 / base64url / hex runs: Reality public keys (43 chars), PSKs,
	// device fingerprints, tokens. Domains never reach 32 characters without a dot.
	reLongToken = regexp.MustCompile(`[A-Za-z0-9+/_-]{32,}={0,2}`)
)

// Sanitize redacts secrets from one log line or error text.
func Sanitize(s string) string {
	if s == "" {
		return s
	}
	if len(s) > maxLineLen {
		s = s[:maxLineLen] + "…[truncated]"
	}
	s = reShareLink.ReplaceAllStringFunc(s, func(m string) string {
		return strings.ToLower(m[:strings.Index(m, "://")]) + "://[redacted]"
	})
	s = reWebURL.ReplaceAllStringFunc(s, func(m string) string {
		g := reWebURL.FindStringSubmatch(m)
		out := strings.ToLower(g[1]) + "://" + g[2]
		if g[3] != "" || strings.Contains(m, "@") {
			out += "/[redacted]"
		}
		return out
	})
	s = reUserinfo.ReplaceAllString(s, "$1[redacted]@")
	s = reJWT.ReplaceAllString(s, "[jwt]")
	s = reAuthHdr.ReplaceAllString(s, "$1$2$3[redacted]")
	s = reBearer.ReplaceAllString(s, "$1 [redacted]")
	s = reKV.ReplaceAllString(s, "$1$2$3$4$5[redacted]")
	s = reUUID.ReplaceAllString(s, "[uuid]")
	s = reEmail.ReplaceAllString(s, "$1***@$2")
	s = reLongToken.ReplaceAllString(s, "[secret]")
	return s
}

var reDigits = regexp.MustCompile(`^\+?[0-9][0-9 -]{5,}$`)

// MaskAccount masks a user name before it leaves the device: e-mails become
// a***@domain, phone numbers keep the first 3 and last 2 digits, anything
// else keeps its first 2 characters.
func MaskAccount(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if at := strings.LastIndex(s, "@"); at > 0 {
		return string([]rune(s)[:1]) + "***" + s[at:]
	}
	if reDigits.MatchString(s) {
		d := strings.NewReplacer(" ", "", "-", "").Replace(s)
		if len(d) >= 7 {
			return d[:3] + "***" + d[len(d)-2:]
		}
	}
	r := []rune(s)
	if len(r) > 2 {
		r = r[:2]
	}
	return string(r) + "***"
}

// secretKey reports whether a payload key names a secret; such values are
// dropped whatever they contain.
func secretKey(k string) bool {
	k = strings.ToLower(strings.ReplaceAll(k, "_", ""))
	for _, frag := range []string{"password", "passwd", "secret", "token", "privatekey", "publickey", "shortid", "uuid", "psk", "lanpass", "lanuser", "link", "share", "server", "credential"} {
		if strings.Contains(k, frag) {
			return true
		}
	}
	return k == "pass" || k == "pwd" || k == "auth" || k == "username"
}

// SanitizeValue sanitises a payload value recursively.
func SanitizeValue(v any) any {
	switch t := v.(type) {
	case string:
		return Sanitize(t)
	case map[string]any:
		return SanitizeMap(t)
	case []string:
		out := make([]string, len(t))
		for i, s := range t {
			out[i] = Sanitize(s)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, x := range t {
			out[i] = SanitizeValue(x)
		}
		return out
	case []map[string]any:
		out := make([]any, len(t))
		for i, x := range t {
			out[i] = SanitizeMap(x)
		}
		return out
	default:
		return v
	}
}

// SanitizeMap copies a payload with secret keys redacted and strings cleaned.
func SanitizeMap(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		if secretKey(k) {
			out[k] = "[redacted]"
			continue
		}
		out[k] = SanitizeValue(v)
	}
	return out
}
