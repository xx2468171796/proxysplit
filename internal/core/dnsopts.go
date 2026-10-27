package core

import "sort"

// DNSOptions are the user's DNS settings (DNS 设置). Empty fields keep the
// built-in defaults, so the zero value generates the same config as before.
type DNSOptions struct {
	Direct string              // China resolver, direct (default 223.5.5.5)
	Remote string              // foreign resolver through the node (default 8.8.8.8)
	Hosts  map[string][]string // domain → fixed IPs (自定义 hosts)
	// BlockHTTPS answers HTTPS / SVCB queries empty (v2rayN BlockBindingQuery):
	// their alpn / ipv6 hints make browsers try QUIC or IPv6 first.
	BlockHTTPS bool
}

const defaultDirectDNS = "223.5.5.5"

func (d DNSOptions) directServer() string {
	if d.Direct != "" {
		return d.Direct
	}
	return defaultDirectDNS
}

// userRules are the DNS rules that go before everything else (hosts win over
// every resolver; HTTPS / SVCB blanking), plus the hosts server if any.
func (d DNSOptions) userRules() ([]M, M) {
	var rules []M
	var srv M
	if len(d.Hosts) > 0 {
		domains := make([]string, 0, len(d.Hosts))
		for name := range d.Hosts {
			domains = append(domains, name)
		}
		sort.Strings(domains)
		srv = M{"type": "hosts", "tag": "dns-hosts", "predefined": d.Hosts}
		rules = append(rules, M{"domain": domains, "server": "dns-hosts"})
	}
	if d.BlockHTTPS {
		rules = append(rules, M{"query_type": []string{"HTTPS", "SVCB"}, "action": "predefined", "rcode": "NOERROR"})
	}
	return rules, srv
}

// tunMTU is the TUN MTU: the user's value within sane bounds, else 1500.
func tunMTU(opts Options) int {
	if opts.TunMTU >= 1280 && opts.TunMTU <= 9000 {
		return opts.TunMTU
	}
	return 1500
}
