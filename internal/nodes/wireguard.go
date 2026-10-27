package nodes

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// WireGuard nodes (v2rayN 导入 WireGuard): Password = interface private key,
// PublicKey = peer public key; the rest lives in the WG* fields of Node.

// wireguard://<private key>@host:port?publickey=..&address=10.0.0.2/32,fd00::2/128
// &presharedkey=..&reserved=1,2,3&mtu=1280#name
func parseWireGuard(link string) (*Node, error) {
	u, err := url.Parse(link)
	if err != nil {
		return nil, err
	}
	port, _ := strconv.Atoi(u.Port())
	q := u.Query()
	priv := u.User.Username()
	if p, ok := u.User.Password(); ok && p != "" { // some exporters write key:… pairs
		priv = priv + ":" + p
	}
	n := &Node{
		Type:        "wireguard",
		Server:      u.Hostname(),
		Port:        port,
		Password:    priv,
		PublicKey:   firstNonEmpty(q.Get("publickey"), q.Get("publicKey"), q.Get("public_key")),
		WGPreShared: firstNonEmpty(q.Get("presharedkey"), q.Get("preSharedKey"), q.Get("pre_shared_key")),
		WGAddress:   splitCSV(firstNonEmpty(q.Get("address"), q.Get("ip"))),
		WGReserved:  parseReserved(q.Get("reserved")),
		WGMTU:       toInt(q.Get("mtu")),
		Name:        decodeFragment(u.Fragment),
	}
	return n, n.checkWireGuard()
}

func (n *Node) checkWireGuard() error {
	if n.Server == "" || n.Port == 0 || n.Password == "" || n.PublicKey == "" {
		return fmt.Errorf("wireguard: missing endpoint / private key / peer public key")
	}
	if len(n.WGAddress) == 0 {
		return fmt.Errorf("wireguard: missing interface address")
	}
	for i, a := range n.WGAddress {
		if !strings.Contains(a, "/") { // bare IP → host prefix
			if strings.Contains(a, ":") {
				n.WGAddress[i] = a + "/128"
			} else {
				n.WGAddress[i] = a + "/32"
			}
		}
	}
	return nil
}

func parseReserved(s string) []int {
	var out []int
	for _, p := range splitCSV(s) {
		v, err := strconv.Atoi(p)
		if err != nil || v < 0 || v > 255 {
			return nil
		}
		out = append(out, v)
	}
	if len(out) != 3 {
		return nil
	}
	return out
}

// IsWireGuardConf reports whether text is a WireGuard .conf ([Interface] +
// [Peer]) rather than a list of share links.
func IsWireGuardConf(text string) bool {
	l := strings.ToLower(text)
	return strings.Contains(l, "[interface]") && strings.Contains(l, "[peer]")
}

// WireGuardConfLink turns a WireGuard .conf (first peer only) into an
// equivalent wireguard:// link, so it imports, dedupes and exports like one.
func WireGuardConfLink(text, name string) (string, error) {
	sec := ""
	kv := map[string]string{}
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		line = strings.TrimSpace(line)
		if c := strings.IndexAny(line, "#;"); c >= 0 {
			line = strings.TrimSpace(line[:c])
		}
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "[") {
			s := strings.ToLower(strings.Trim(line, "[]"))
			if s == "peer" && sec == "peer" {
				break // first peer only
			}
			sec = s
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key := sec + "." + strings.ToLower(strings.TrimSpace(k))
		if prev := kv[key]; prev != "" { // repeated Address lines
			kv[key] = prev + "," + strings.TrimSpace(v)
		} else {
			kv[key] = strings.TrimSpace(v)
		}
	}
	ep := kv["peer.endpoint"]
	if ep == "" || kv["interface.privatekey"] == "" {
		return "", fmt.Errorf("wireguard conf: missing Endpoint or PrivateKey")
	}
	q := url.Values{}
	q.Set("publickey", kv["peer.publickey"])
	q.Set("address", strings.ReplaceAll(kv["interface.address"], " ", ""))
	for src, dst := range map[string]string{"peer.presharedkey": "presharedkey", "interface.mtu": "mtu"} {
		if v := kv[src]; v != "" {
			q.Set(dst, v)
		}
	}
	if name == "" {
		name = ep
	}
	return "wireguard://" + url.PathEscape(kv["interface.privatekey"]) + "@" + ep + "?" + q.Encode() + "#" + url.PathEscape(name), nil
}
