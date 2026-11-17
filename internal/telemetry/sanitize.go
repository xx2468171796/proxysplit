package telemetry

import (
	"regexp"
	"strings"
)

// Sanitisation keeps what debugging needs (domains, IPs, ports, process
// names, error text) and removes anything that would let the reader use the
// user's nodes or accounts: share links, passwords, UUIDs, Reality / TLS keys,
// tokens, auth headers, the clash secret, URL query strings; e-mails and
// mainland phone numbers are masked, and the OS account name in home paths
// (often the user's real name) becomes [user]. Applied before anything is
// written to the on-disk spool.
//
// Sanitize is the single owner of redaction: the uploaded copy and the local
// log file (internal/logfile) both call it, so a rule added here covers both.

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
	reKV      = regexp.MustCompile(`(?i)("?)\b(` + kvSecretPattern() + `)("?)(\s*[:=]\s*)("?)([^\s",;&}]+)`)
	reUUID    = regexp.MustCompile(`(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`)
	reEmail   = regexp.MustCompile(`\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b`)
	// Long base64 / base64url / hex runs: Reality public keys (43 chars), PSKs,
	// device fingerprints, tokens. Domains never reach 32 characters without a dot.
	reLongToken = regexp.MustCompile(`[A-Za-z0-9+/_-]{32,}={0,2}`)

	// Home directories: C:\Users\<name>\…, C:/Users/<name>/…, the JSON-escaped
	// C:\\Users\\<name>, /Users/<name>/… (macOS), /home/<name>/… (Linux) and
	// /c/Users/<name>/… (Git Bash). Windows account names may contain spaces, so
	// a name runs to the next separator when there is one (reWinHome) and to
	// the next blank otherwise (reWinHomeEnd).
	reWinHome     = regexp.MustCompile(`(?i)\b([a-z]:[\\/]+(?:users|documents and settings)[\\/]+)([^\\/\r\n"'<>|:*?]+)([\\/])`)
	reWinHomeEnd  = regexp.MustCompile(`(?i)\b([a-z]:[\\/]+(?:users|documents and settings)[\\/]+)([^\\/\s"'<>|:*?\[\]]+)`)
	reUnixHome    = regexp.MustCompile(`(^|[\s"'=:(\[,])((?:/[A-Za-z])?/(?:Users|home)/)([^/\r\n"'<>:]+)(/)`)
	reUnixHomeEnd = regexp.MustCompile(`(^|[\s"'=:(\[,])((?:/[A-Za-z])?/(?:Users|home)/)([^/\s"'<>:\[\]]+)`)

	// Mainland mobile numbers (11 digits starting 13–19, optional +86 / 86)
	// not embedded in a longer digit run.
	reMobile = regexp.MustCompile(`(^|[^0-9])((?:\+?86)?1[3-9][0-9])([0-9]{6})([0-9]{2})($|[^0-9])`)
)

// kvSecretNames are the field names whose value is a secret wherever it shows
// up: as key=value / "key":"value" in a log line (reKV) and as a key of the
// generated core config (SecretField, used by the diagnostics snapshot). One
// list, so the two can never disagree. "_" also matches no separator.
var kvSecretNames = []string{
	"password", "passwd", "pass", "pwd", "secret", "token", "access_token", "refresh_token", "api_token",
	"private_key_passphrase", "passphrase", "private_key", "public_key", "short_id", "uuid", "psk", "pre_shared_key",
	"auth_str", "auth", "obfs_password", "plugin_opts", "lan_pass", "lan_user", "username", "user",
}

func kvSecretPattern() string {
	return strings.ReplaceAll(strings.Join(kvSecretNames, "|"), "_", "_?")
}

var kvSecretSet = func() map[string]bool {
	m := make(map[string]bool, len(kvSecretNames))
	for _, n := range kvSecretNames {
		m[strings.ReplaceAll(n, "_", "")] = true
	}
	return m
}()

// SecretField reports whether a config field name (any case, "_" or "-"
// separated) is one whose value Sanitize would redact in a log line.
func SecretField(name string) bool {
	return kvSecretSet[strings.NewReplacer("_", "", "-", "").Replace(strings.ToLower(name))]
}

// sharedHome lists profile folders that are not a person.
var sharedHome = map[string]bool{"public": true, "shared": true, "default": true, "all users": true, "default user": true}

// maskHomePaths replaces the account-name segment of home paths with [user].
func maskHomePaths(s string) string {
	win := func(re *regexp.Regexp, tail bool) {
		s = re.ReplaceAllStringFunc(s, func(m string) string {
			g := re.FindStringSubmatch(m)
			if sharedHome[strings.ToLower(g[2])] {
				return m
			}
			if tail {
				return g[1] + "[user]" + g[3]
			}
			return g[1] + "[user]"
		})
	}
	unix := func(re *regexp.Regexp, tail bool) {
		s = re.ReplaceAllStringFunc(s, func(m string) string {
			g := re.FindStringSubmatch(m)
			if sharedHome[strings.ToLower(g[3])] {
				return m
			}
			if tail {
				return g[1] + g[2] + "[user]" + g[4]
			}
			return g[1] + g[2] + "[user]"
		})
	}
	win(reWinHome, true)
	win(reWinHomeEnd, false)
	unix(reUnixHome, true)
	unix(reUnixHomeEnd, false)
	return s
}

// maskPhones keeps the first 3 and last 2 digits of phone numbers.
func maskPhones(s string) string {
	for range 2 { // adjacent numbers share a separator; a second pass catches them
		s = reMobile.ReplaceAllString(s, "${1}${2}******${4}${5}")
	}
	return s
}

// Sanitize redacts secrets from one log line or error text. The result is at
// most maxLineLen UTF-16 units, suffix included (see limits.go).
func Sanitize(s string) string {
	if s == "" {
		return s
	}
	// Bound the regex work first. Redaction can lengthen a line, so the limit
	// itself is applied after it; the first cut is generous and drops the
	// half-token it may leave at the end, which the rules could not recognise.
	if len(s) > 4*maxLineLen {
		s = s[:4*maxLineLen]
		if i := strings.LastIndexAny(s, " \t"); i > len(s)-256 {
			s = s[:i]
		}
		s = strings.ToValidUTF8(s, "") + truncatedSuffix
	}
	return truncate(redact(s), maxLineLen)
}

func redact(s string) string {
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
	s = maskHomePaths(s)
	s = maskPhones(s)
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
