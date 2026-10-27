package service

import (
	"fmt"
	"net/netip"
	"reflect"
	"strings"

	"proxysplit/internal/core"
)

// NetSettings are the DNS and TUN advanced options (设置 → DNS 与高级网络,
// borrowed from v2rayN). The zero value keeps the built-in behaviour.
type NetSettings struct {
	DNSDirect string `json:"dnsDirect,omitempty"` // China resolver ("" = 223.5.5.5)
	DNSRemote string `json:"dnsRemote,omitempty"` // foreign resolver via the node ("" = 8.8.8.8)
	// Hosts is one "domain ip [ip…]" per line (自定义 hosts).
	Hosts          string `json:"hosts,omitempty"`
	BlockHTTPSRR   bool   `json:"blockHttpsRR,omitempty"`
	TunMTU         int    `json:"tunMtu,omitempty"` // 0 = 1500
	StrictRouteOff bool   `json:"strictRouteOff,omitempty"`
}

func (n NetSettings) changed(old NetSettings) bool { return !reflect.DeepEqual(n, old) }

// validate rejects values sing-box would refuse, so a typo can't stop the core.
func (n NetSettings) validate() error {
	for _, s := range []string{n.DNSDirect, n.DNSRemote} {
		if s != "" {
			if _, err := netip.ParseAddr(s); err != nil {
				return fmt.Errorf("DNS 服务器要填 IP 地址：%s", s)
			}
		}
	}
	if n.TunMTU != 0 && (n.TunMTU < 1280 || n.TunMTU > 9000) {
		return fmt.Errorf("MTU 要在 1280–9000 之间")
	}
	_, err := parseHosts(n.Hosts)
	return err
}

// parseHosts reads "domain ip [ip…]" lines; # starts a comment.
func parseHosts(text string) (map[string][]string, error) {
	out := map[string][]string{}
	for i, line := range strings.Split(text, "\n") {
		if c := strings.Index(line, "#"); c >= 0 {
			line = line[:c]
		}
		f := strings.Fields(line)
		if len(f) == 0 {
			continue
		}
		if len(f) < 2 {
			return nil, fmt.Errorf("hosts 第 %d 行要写成「域名 IP」", i+1)
		}
		for _, ip := range f[1:] {
			if _, err := netip.ParseAddr(ip); err != nil {
				return nil, fmt.Errorf("hosts 第 %d 行 IP 不对：%s", i+1, ip)
			}
		}
		name := strings.ToLower(strings.TrimSuffix(f[0], "."))
		out[name] = append(out[name], f[1:]...)
	}
	if len(out) == 0 {
		return nil, nil
	}
	return out, nil
}

func (n NetSettings) coreDNS() core.DNSOptions {
	hosts, _ := parseHosts(n.Hosts) // validated on save
	return core.DNSOptions{Direct: n.DNSDirect, Remote: n.DNSRemote, Hosts: hosts, BlockHTTPS: n.BlockHTTPSRR}
}

// SetNetSettings validates and saves the DNS / TUN advanced options; the core
// restarts through SetSettings when they changed.
func (s *Service) SetNetSettings(n NetSettings) error {
	n.DNSDirect, n.DNSRemote = strings.TrimSpace(n.DNSDirect), strings.TrimSpace(n.DNSRemote)
	if err := n.validate(); err != nil {
		return err
	}
	st := s.GetSettings()
	st.Net = n
	s.SetSettings(st)
	return nil
}
