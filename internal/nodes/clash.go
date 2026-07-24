package nodes

import (
	"fmt"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

type clashDocument struct {
	Proxies []clashProxy `yaml:"proxies"`
}

type clashProxy struct {
	Name        string   `yaml:"name"`
	Type        string   `yaml:"type"`
	Server      string   `yaml:"server"`
	Port        int      `yaml:"port"`
	UUID        string   `yaml:"uuid"`
	Password    string   `yaml:"password"`
	Username    string   `yaml:"username"`
	Cipher      string   `yaml:"cipher"`
	AlterID     int      `yaml:"alterId"`
	Network     string   `yaml:"network"`
	TLS         bool     `yaml:"tls"`
	ServerName  string   `yaml:"servername"`
	SNI         string   `yaml:"sni"`
	Flow        string   `yaml:"flow"`
	Fingerprint string   `yaml:"client-fingerprint"`
	SkipVerify  bool     `yaml:"skip-cert-verify"`
	ALPN        []string `yaml:"alpn"`

	WSOpts struct {
		Path    string         `yaml:"path"`
		Headers map[string]any `yaml:"headers"`
	} `yaml:"ws-opts"`
	GRPCOpts struct {
		ServiceName string `yaml:"grpc-service-name"`
	} `yaml:"grpc-opts"`
	RealityOpts struct {
		PublicKey string `yaml:"public-key"`
		ShortID   string `yaml:"short-id"`
	} `yaml:"reality-opts"`

	CongestionController string `yaml:"congestion-controller"`
}

// ParseClashYAML converts the proxy definitions in a Clash/Mihomo subscription
// into ProxySplit's protocol-neutral nodes. Proxy groups, DNS and routing rules
// are deliberately ignored: subscriptions provide endpoints, while the user's
// ProxySplit routing configuration remains authoritative.
func ParseClashYAML(data []byte) ([]*Node, error) {
	var doc clashDocument
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("parse Clash YAML: %w", err)
	}
	if len(doc.Proxies) == 0 {
		return nil, fmt.Errorf("Clash YAML contains no proxies")
	}

	out := make([]*Node, 0, len(doc.Proxies))
	for _, p := range doc.Proxies {
		n, err := clashNode(p)
		if err == nil {
			out = append(out, n)
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("Clash YAML contains no supported proxies")
	}
	return out, nil
}

func clashNode(p clashProxy) (*Node, error) {
	nodeType := strings.ToLower(strings.TrimSpace(p.Type))
	switch nodeType {
	case "ss":
		nodeType = "shadowsocks"
	case "socks5":
		nodeType = "socks"
	case "hy2":
		nodeType = "hysteria2"
	}
	switch nodeType {
	case "vless", "vmess", "trojan", "shadowsocks", "socks", "http", "hysteria2", "tuic", "anytls":
	default:
		return nil, fmt.Errorf("unsupported Clash proxy type %q", p.Type)
	}
	if strings.TrimSpace(p.Server) == "" || p.Port <= 0 {
		return nil, fmt.Errorf("Clash proxy missing server/port")
	}

	n := &Node{
		Name:        strings.TrimSpace(p.Name),
		Type:        nodeType,
		Server:      strings.TrimSpace(p.Server),
		Port:        p.Port,
		UUID:        strings.TrimSpace(p.UUID),
		Password:    p.Password,
		Username:    p.Username,
		AlterID:     p.AlterID,
		Network:     strings.ToLower(strings.TrimSpace(p.Network)),
		SNI:         firstNonEmpty(strings.TrimSpace(p.ServerName), strings.TrimSpace(p.SNI)),
		Flow:        strings.TrimSpace(p.Flow),
		Fingerprint: strings.TrimSpace(p.Fingerprint),
		Insecure:    p.SkipVerify,
		ALPN:        append([]string(nil), p.ALPN...),
		PublicKey:   strings.TrimSpace(p.RealityOpts.PublicKey),
		ShortID:     strings.TrimSpace(p.RealityOpts.ShortID),
		CC:          strings.TrimSpace(p.CongestionController),
	}
	if nodeType == "vmess" {
		n.Cipher = strings.TrimSpace(p.Cipher)
	}
	if nodeType == "shadowsocks" {
		n.Method = strings.TrimSpace(p.Cipher)
	}
	if n.Name == "" {
		n.Name = fmt.Sprintf("%s:%d", n.Server, n.Port)
	}
	if n.PublicKey != "" {
		n.Security = "reality"
	} else if p.TLS || nodeType == "trojan" || nodeType == "hysteria2" || nodeType == "tuic" || nodeType == "anytls" {
		n.Security = "tls"
	} else {
		n.Security = "none"
	}
	if n.Network == "ws" {
		n.Path = strings.TrimSpace(p.WSOpts.Path)
		n.Host = clashHeader(p.WSOpts.Headers, "host")
	}
	if n.Network == "grpc" {
		n.Path = strings.TrimSpace(p.GRPCOpts.ServiceName)
	}

	switch nodeType {
	case "vless", "vmess":
		if n.UUID == "" {
			return nil, fmt.Errorf("%s proxy missing uuid", nodeType)
		}
	case "trojan", "shadowsocks", "hysteria2", "anytls":
		if n.Password == "" {
			return nil, fmt.Errorf("%s proxy missing password", nodeType)
		}
	case "tuic":
		if n.UUID == "" || n.Password == "" {
			return nil, fmt.Errorf("tuic proxy missing uuid/password")
		}
	}
	n.ID = shortHash(strings.Join([]string{
		"clash", n.Type, n.Server, strconv.Itoa(n.Port), n.UUID, n.Username,
		n.Password, n.Method, n.Network, n.Host, n.Path, n.Security, n.SNI,
	}, "|"))
	return n, nil
}

func clashHeader(headers map[string]any, wanted string) string {
	for key, value := range headers {
		if strings.EqualFold(strings.TrimSpace(key), wanted) {
			return strings.TrimSpace(fmt.Sprint(value))
		}
	}
	return ""
}
