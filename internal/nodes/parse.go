package nodes

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// ParseLink parses a single share link (vless://, vmess://, trojan://, ss://)
// into a Node. It returns an error for empty input or unsupported schemes.
func ParseLink(link string) (*Node, error) {
	link = strings.TrimSpace(link)
	if link == "" {
		return nil, fmt.Errorf("empty link")
	}
	lower := strings.ToLower(link)
	var (
		n   *Node
		err error
	)
	switch {
	case strings.HasPrefix(lower, "vless://"):
		n, err = parseVLESS(link)
	case strings.HasPrefix(lower, "vmess://"):
		n, err = parseVMess(link)
	case strings.HasPrefix(lower, "trojan://"):
		n, err = parseTrojan(link)
	case strings.HasPrefix(lower, "ss://"):
		n, err = parseShadowsocks(link)
	case strings.HasPrefix(lower, "socks://"), strings.HasPrefix(lower, "socks5://"):
		n, err = parseSocks(link)
	case strings.HasPrefix(lower, "http://"), strings.HasPrefix(lower, "https://"):
		n, err = parseHTTP(link)
	case strings.HasPrefix(lower, "hysteria2://"), strings.HasPrefix(lower, "hy2://"):
		n, err = parseHysteria2(link)
	case strings.HasPrefix(lower, "tuic://"):
		n, err = parseTUIC(link)
	case strings.HasPrefix(lower, "anytls://"):
		n, err = parseAnyTLS(link)
	case strings.HasPrefix(lower, "wireguard://"), strings.HasPrefix(lower, "wg://"):
		n, err = parseWireGuard(link)
	default:
		u, ok := bareSocksURL(link)
		if !ok {
			return nil, fmt.Errorf("unsupported scheme in %q", truncate(link, 24))
		}
		n, err = parseSocks(u)
	}
	if err != nil {
		return nil, err
	}
	n.Raw = link
	if n.Name == "" {
		n.Name = fmt.Sprintf("%s:%d", n.Server, n.Port)
	}
	n.ID = shortHash(link)
	return n, nil
}

// anytls://password@host:port?sni=..&insecure=1#name
func parseAnyTLS(link string) (*Node, error) {
	u, err := url.Parse(link)
	if err != nil {
		return nil, err
	}
	port, _ := strconv.Atoi(u.Port())
	q := u.Query()
	pass := u.User.Username()
	if p, ok := u.User.Password(); ok {
		pass += ":" + p
	}
	n := &Node{
		Type:     "anytls",
		Server:   u.Hostname(),
		Port:     port,
		Password: pass,
		Name:     decodeFragment(u.Fragment),
		Security: "tls",
		SNI:      firstNonEmpty(q.Get("sni"), q.Get("peer"), u.Hostname()),
		ALPN:     splitCSV(q.Get("alpn")),
		Insecure: q.Get("insecure") == "1" || q.Get("allowInsecure") == "1",
	}
	if n.Server == "" || n.Port == 0 || n.Password == "" {
		return nil, fmt.Errorf("anytls: missing server/port/password")
	}
	return n, nil
}

// Manual builds a node from hand-entered fields (for protocols like socks/http
// that are usually given as host:port + credentials rather than a share link).
func Manual(nodeType, name, server string, port int, username, password string) (*Node, error) {
	nodeType = strings.ToLower(strings.TrimSpace(nodeType))
	if nodeType == "socks5" {
		nodeType = "socks"
	}
	if server == "" || port == 0 {
		return nil, fmt.Errorf("missing server/port")
	}
	n := &Node{
		Type:     nodeType,
		Name:     strings.TrimSpace(name),
		Server:   strings.TrimSpace(server),
		Port:     port,
		Username: username,
		Password: password,
	}
	if n.Name == "" {
		n.Name = fmt.Sprintf("%s:%d", n.Server, n.Port)
	}
	n.ID = shortHash(fmt.Sprintf("%s|%s|%d|%s|%s", nodeType, n.Server, port, username, password))
	return n, nil
}

// ParseMany parses newline- or whitespace-separated links, skipping blanks and
// lines that fail to parse. It returns the successfully parsed nodes plus the
// count of lines that were skipped.
func ParseMany(text string) (out []*Node, skipped int) {
	// A whole WireGuard .conf (and nothing else) is one node.
	if IsWireGuardConf(text) && !strings.Contains(text, "://") {
		link, err := WireGuardConfLink(text, "")
		if err != nil {
			return nil, 1
		}
		n, err := ParseLink(link)
		if err != nil {
			return nil, 1
		}
		return []*Node{n}, 0
	}
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if n, err := ParseLink(line); err == nil {
			out = append(out, n)
		} else {
			skipped++
		}
	}
	return out, skipped
}

// vless://uuid@host:port?type=ws&security=tls&sni=..&flow=..&pbk=..&sid=..#name
func parseVLESS(link string) (*Node, error) {
	u, err := url.Parse(link)
	if err != nil {
		return nil, err
	}
	port, _ := strconv.Atoi(u.Port())
	q := u.Query()
	n := &Node{
		Type:        "vless",
		Server:      u.Hostname(),
		Port:        port,
		UUID:        u.User.Username(),
		Name:        decodeFragment(u.Fragment),
		Network:     firstNonEmpty(q.Get("type"), "tcp"),
		Security:    firstNonEmpty(q.Get("security"), "none"),
		SNI:         q.Get("sni"),
		Fingerprint: q.Get("fp"),
		Flow:        q.Get("flow"),
		PublicKey:   q.Get("pbk"),
		ShortID:     q.Get("sid"),
		Host:        firstNonEmpty(q.Get("host"), q.Get("sni")),
		Path:        firstNonEmpty(q.Get("path"), q.Get("serviceName")),
		ALPN:        splitCSV(q.Get("alpn")),
		Insecure:    q.Get("allowInsecure") == "1" || q.Get("insecure") == "1",
	}
	applyXrayQuery(n, q)
	if n.Server == "" || n.Port == 0 || n.UUID == "" {
		return nil, fmt.Errorf("vless: missing server/port/uuid")
	}
	return n, nil
}

// vmess://<base64 json>
func parseVMess(link string) (*Node, error) {
	raw := strings.TrimPrefix(strings.TrimPrefix(link, "vmess://"), "VMESS://")
	data, err := b64decode(raw)
	if err != nil {
		return nil, fmt.Errorf("vmess: base64 decode: %w", err)
	}
	var v struct {
		Ps   string      `json:"ps"`
		Add  string      `json:"add"`
		Port interface{} `json:"port"`
		ID   string      `json:"id"`
		Aid  interface{} `json:"aid"`
		Scy  string      `json:"scy"`
		Net  string      `json:"net"`
		Host string      `json:"host"`
		Path string      `json:"path"`
		TLS  string      `json:"tls"`
		SNI  string      `json:"sni"`
		ALPN string      `json:"alpn"`
		FP   string      `json:"fp"`
		Type string      `json:"type"` // header type (mKCP) / xhttp mode
	}
	if err := json.Unmarshal(data, &v); err != nil {
		return nil, fmt.Errorf("vmess: json: %w", err)
	}
	n := &Node{
		Type:        "vmess",
		Server:      v.Add,
		Port:        toInt(v.Port),
		UUID:        v.ID,
		AlterID:     toInt(v.Aid),
		Cipher:      firstNonEmpty(v.Scy, "auto"),
		Name:        v.Ps,
		Network:     firstNonEmpty(v.Net, "tcp"),
		Security:    firstNonEmpty(v.TLS, "none"),
		SNI:         firstNonEmpty(v.SNI, v.Host),
		Fingerprint: v.FP,
		Host:        v.Host,
		Path:        v.Path,
		ALPN:        splitCSV(v.ALPN),
	}
	if n.Security == "" {
		n.Security = "none"
	}
	applyVMessXray(n, v.Type)
	if n.Server == "" || n.Port == 0 || n.UUID == "" {
		return nil, fmt.Errorf("vmess: missing add/port/id")
	}
	return n, nil
}

// trojan://password@host:port?sni=..&type=..&path=..#name
func parseTrojan(link string) (*Node, error) {
	u, err := url.Parse(link)
	if err != nil {
		return nil, err
	}
	port, _ := strconv.Atoi(u.Port())
	q := u.Query()
	n := &Node{
		Type:        "trojan",
		Server:      u.Hostname(),
		Port:        port,
		Password:    u.User.Username(),
		Name:        decodeFragment(u.Fragment),
		Network:     firstNonEmpty(q.Get("type"), "tcp"),
		Security:    firstNonEmpty(q.Get("security"), "tls"),
		SNI:         firstNonEmpty(q.Get("sni"), q.Get("peer")),
		Fingerprint: q.Get("fp"),
		Host:        q.Get("host"),
		Path:        firstNonEmpty(q.Get("path"), q.Get("serviceName")),
		ALPN:        splitCSV(q.Get("alpn")),
		Insecure:    q.Get("allowInsecure") == "1" || q.Get("insecure") == "1",
	}
	applyTLSExtras(n, q)
	if n.Server == "" || n.Port == 0 || n.Password == "" {
		return nil, fmt.Errorf("trojan: missing server/port/password")
	}
	return n, nil
}

// ss://base64(method:password)@host:port#name  OR  ss://base64(method:password@host:port)#name
func parseShadowsocks(link string) (*Node, error) {
	body := strings.TrimPrefix(strings.TrimPrefix(link, "ss://"), "SS://")
	name := ""
	if i := strings.Index(body, "#"); i >= 0 {
		name = decodeFragment(body[i+1:])
		body = body[:i]
	}
	n := &Node{Type: "shadowsocks", Name: name}
	if parts := strings.SplitN(body, "?", 2); len(parts) == 2 {
		body = strings.TrimSuffix(parts[0], "/")
		if q, err := url.ParseQuery(parts[1]); err == nil {
			if plugin := strings.TrimSpace(q.Get("plugin")); plugin != "" {
				// SIP002: plugin=name;opt=a;opt2=b
				name, opts, _ := strings.Cut(plugin, ";")
				switch strings.ToLower(name) {
				case "obfs-local", "simple-obfs":
					n.Plugin, n.PluginOpts = "obfs-local", opts
				case "v2ray-plugin":
					n.Plugin, n.PluginOpts = "v2ray-plugin", opts
				default:
					n.Name += "（插件 " + name + " 不支持）"
				}
			}
		}
	}
	if at := strings.LastIndex(body, "@"); at >= 0 {
		// SIP002: userinfo is base64(method:password), host:port is plain
		userinfo, err := b64decode(body[:at])
		if err != nil {
			// some links leave userinfo un-encoded
			userinfo = []byte(body[:at])
		}
		mp := strings.SplitN(string(userinfo), ":", 2)
		if len(mp) != 2 {
			return nil, fmt.Errorf("ss: bad method:password")
		}
		n.Method, n.Password = mp[0], mp[1]
		host, port, err := splitHostPort(body[at+1:])
		if err != nil {
			return nil, err
		}
		n.Server, n.Port = host, port
	} else {
		// legacy: whole thing is base64(method:password@host:port)
		dec, err := b64decode(body)
		if err != nil {
			return nil, fmt.Errorf("ss: base64 decode: %w", err)
		}
		s := string(dec)
		at := strings.LastIndex(s, "@")
		if at < 0 {
			return nil, fmt.Errorf("ss: malformed legacy link")
		}
		mp := strings.SplitN(s[:at], ":", 2)
		if len(mp) != 2 {
			return nil, fmt.Errorf("ss: bad method:password")
		}
		n.Method, n.Password = mp[0], mp[1]
		host, port, err := splitHostPort(s[at+1:])
		if err != nil {
			return nil, err
		}
		n.Server, n.Port = host, port
	}
	if n.Server == "" || n.Port == 0 || n.Method == "" {
		return nil, fmt.Errorf("ss: missing server/port/method")
	}
	return n, nil
}

// socks://[base64(user:pass) | user:pass]@host:port#name  (also socks5://)
func parseSocks(link string) (*Node, error) {
	u, err := url.Parse(link)
	if err != nil {
		return nil, err
	}
	port, _ := strconv.Atoi(u.Port())
	n := &Node{Type: "socks", Server: u.Hostname(), Port: port, Name: decodeFragment(u.Fragment)}
	if u.User != nil {
		user := u.User.Username()
		pass, has := u.User.Password()
		if !has { // userinfo may be base64(user:pass)
			if dec, e := b64decode(user); e == nil && strings.Contains(string(dec), ":") {
				p := strings.SplitN(string(dec), ":", 2)
				user, pass = p[0], p[1]
			}
		}
		n.Username, n.Password = user, pass
	}
	if n.Server == "" || n.Port == 0 {
		return nil, fmt.Errorf("socks: missing server/port")
	}
	return n, nil
}

// bareSocksURL turns the scheme-less forms residential-proxy sellers hand out
// into a socks5:// link (业主 2026-10-28, a customer's IP:端口:用户名:密码 could
// not be imported): host:port:user:pass, user:pass:host:port, user:pass@host:port
// and host:port. The password may itself contain ':' in the host-first form.
func bareSocksURL(s string) (string, bool) {
	if strings.ContainsAny(s, " /?#[]") {
		return "", false
	}
	if user, hostport, ok := strings.Cut(s, "@"); ok {
		p := strings.SplitN(user, ":", 2)
		if len(p) != 2 {
			return "", false
		}
		return socksURL(hostport, p[0], p[1])
	}
	p := strings.Split(s, ":")
	switch {
	case len(p) == 2:
		return socksURL(s, "", "")
	case len(p) >= 4 && isPort(p[1]):
		return socksURL(p[0]+":"+p[1], p[2], strings.Join(p[3:], ":"))
	case len(p) == 4 && isPort(p[3]) && looksLikeHost(p[2]):
		return socksURL(p[2]+":"+p[3], p[0], p[1])
	}
	return "", false
}

func socksURL(hostport, user, pass string) (string, bool) {
	host, port, ok := strings.Cut(hostport, ":")
	if !ok || !looksLikeHost(host) || !isPort(port) {
		return "", false
	}
	u := url.URL{Scheme: "socks5", Host: hostport}
	if user != "" {
		u.User = url.UserPassword(user, pass)
	}
	return u.String(), true
}

func isPort(s string) bool {
	n, err := strconv.Atoi(s)
	return err == nil && n > 0 && n < 65536
}

// looksLikeHost: an IPv4 address or a dotted domain name.
func looksLikeHost(s string) bool {
	if s == "" || !strings.Contains(s, ".") {
		return false
	}
	for _, r := range s {
		if !(r == '.' || r == '-' || r >= '0' && r <= '9' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z') {
			return false
		}
	}
	return true
}

// http://[user:pass@]host:port#name (also https:// with TLS). Guarded: a URL
// with a real path is treated as a subscription, not a proxy node.
func parseHTTP(link string) (*Node, error) {
	u, err := url.Parse(link)
	if err != nil {
		return nil, err
	}
	// A proxy node is host:PORT with no path/query; anything else is a URL (e.g.
	// a subscription link), which must NOT be parsed as an http proxy.
	port, _ := strconv.Atoi(u.Port())
	if port == 0 || strings.Trim(u.Path, "/") != "" || u.RawQuery != "" {
		return nil, fmt.Errorf("http: looks like a URL, not a proxy node")
	}
	n := &Node{Type: "http", Server: u.Hostname(), Port: port, Name: decodeFragment(u.Fragment)}
	if u.Scheme == "https" {
		n.Security = "tls"
		n.SNI = u.Hostname()
	}
	if u.User != nil {
		n.Username = u.User.Username()
		n.Password, _ = u.User.Password()
	}
	if n.Server == "" {
		return nil, fmt.Errorf("http: missing server")
	}
	return n, nil
}

// hysteria2://auth@host:port?sni=..&insecure=1#name  (also hy2://)
func parseHysteria2(link string) (*Node, error) {
	u, err := url.Parse(link)
	if err != nil {
		return nil, err
	}
	port, _ := strconv.Atoi(u.Port())
	q := u.Query()
	auth := u.User.Username()
	if p, ok := u.User.Password(); ok {
		auth += ":" + p
	}
	n := &Node{
		Type:     "hysteria2",
		Server:   u.Hostname(),
		Port:     port,
		Password: auth,
		Name:     decodeFragment(u.Fragment),
		Security: "tls",
		SNI:      firstNonEmpty(q.Get("sni"), q.Get("peer"), u.Hostname()),
		ALPN:     splitCSV(q.Get("alpn")),
		Insecure: q.Get("insecure") == "1" || q.Get("allowInsecure") == "1",
	}
	if n.Server == "" || n.Port == 0 {
		return nil, fmt.Errorf("hysteria2: missing server/port")
	}
	return n, nil
}

// tuic://uuid:password@host:port?sni=..&congestion_control=bbr&alpn=h3#name
func parseTUIC(link string) (*Node, error) {
	u, err := url.Parse(link)
	if err != nil {
		return nil, err
	}
	port, _ := strconv.Atoi(u.Port())
	q := u.Query()
	pass, _ := u.User.Password()
	n := &Node{
		Type:     "tuic",
		Server:   u.Hostname(),
		Port:     port,
		UUID:     u.User.Username(),
		Password: pass,
		CC:       firstNonEmpty(q.Get("congestion_control"), "bbr"),
		Name:     decodeFragment(u.Fragment),
		Security: "tls",
		SNI:      firstNonEmpty(q.Get("sni"), q.Get("peer"), u.Hostname()),
		ALPN:     splitCSV(firstNonEmpty(q.Get("alpn"), "h3")),
		Insecure: q.Get("insecure") == "1" || q.Get("allow_insecure") == "1",
	}
	if n.Server == "" || n.Port == 0 || n.UUID == "" {
		return nil, fmt.Errorf("tuic: missing server/port/uuid")
	}
	return n, nil
}
