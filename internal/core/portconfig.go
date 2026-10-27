package core

import (
	"encoding/json"
	"fmt"

	"proxysplit/internal/nodes"
)

// PortConfig describes one standalone proxy port (代理端口): a SOCKS5 / HTTP
// listener for fingerprint browsers and LAN clients, run as its own sing-box
// process so each port can be started, stopped and re-moded on its own without
// touching the main TUN core or the other ports.
type PortConfig struct {
	Listen   string // 0.0.0.0 (LAN) or 127.0.0.1 (this machine only)
	Port     int
	Protocol string // mixed | socks | http
	User     string // auth username (empty = no auth)
	Pass     string
	Node     *nodes.Node // exit node; nil only for 直连
	Mode     string      // rule | global | direct — the boot clash mode, switchable live
	LogLevel string

	ClashController string // 127.0.0.1:<port> for live mode switching + /connections
	ClashSecret     string

	GeoDir        string
	RuleSets      *RuleSetOptions
	DirectDomains []string
	RealityHybrid bool
}

// PortInboundTag is the inbound tag of every proxy-port process.
const PortInboundTag = "in-port"

// BuildPortConfig generates the sing-box config of one proxy port. Routing:
// our own API and private addresses always direct; clash mode 直连 = all
// direct, 全局 = all through the node, 规则 = ads blocked / mainland direct /
// rest through the node. The outbound binds the physical interface
// (auto_detect_interface) so it never loops back through the main TUN.
func BuildPortConfig(pc PortConfig) ([]byte, error) {
	if pc.Port <= 0 || pc.Port > 65535 {
		return nil, fmt.Errorf("端口无效：%d", pc.Port)
	}
	typ := pc.Protocol
	if typ != "socks" && typ != "http" {
		typ = "mixed"
	}
	listen := pc.Listen
	if listen == "" {
		listen = "0.0.0.0"
	}
	in := M{"type": typ, "tag": PortInboundTag, "listen": listen, "listen_port": pc.Port}
	if pc.User != "" {
		in["users"] = []M{{"username": pc.User, "password": pc.Pass}}
	}

	outs := []M{}
	proxyTag := "direct"
	if pc.Node != nil {
		obs, err := buildOutbounds(pc.Node, "proxy", pc.RealityHybrid)
		if err != nil {
			return nil, err
		}
		outs = append(outs, obs[0], M{"type": "direct", "tag": "direct"})
		outs = append(outs, obs[1:]...)
		proxyTag = "proxy"
	} else {
		outs = append(outs, M{"type": "direct", "tag": "direct"})
	}

	opts := Options{RuleSets: pc.RuleSets, DirectDomains: pc.DirectDomains, ClashController: pc.ClashController, ClashSecret: pc.ClashSecret, ClashMode: pc.Mode}
	rules := []M{{"action": "sniff"}}
	rules = append(rules, directDomainRules(opts)...)
	rules = append(rules, M{"ip_is_private": true, "outbound": "direct"})
	rules = append(rules, clashRules(proxyTag)...)
	rules = append(rules, bypassRules(opts, nil)...)

	route := M{
		"rules":                   rules,
		"final":                   proxyTag,
		"auto_detect_interface":   true,
		"default_domain_resolver": M{"server": "dns-direct"},
		"rule_set": []M{
			{"type": "local", "tag": "geosite-cn", "format": "binary", "path": srsPath(pc.GeoDir, "geosite-cn.srs")},
			{"type": "local", "tag": "geoip-cn", "format": "binary", "path": srsPath(pc.GeoDir, "geoip-cn.srs")},
			{"type": "local", "tag": "geosite-ads", "format": "binary", "path": srsPath(pc.GeoDir, "geosite-category-ads-all.srs")},
		},
	}

	dnsServers := []M{{"type": "udp", "tag": "dns-direct", "server": "223.5.5.5"}}
	dnsRules := clashDNSRules(opts)
	dnsFinal := "dns-direct"
	if pc.Node != nil {
		dnsServers = append(dnsServers, remoteDNSServer(pc.Node, proxyTag))
		dnsRules = append(dnsRules, M{"rule_set": []string{"geosite-cn"}, "server": "dns-direct"})
		dnsFinal = "dns-remote"
	}

	level := pc.LogLevel
	if level == "" {
		level = "info"
	}
	cfg := M{
		"log":       M{"level": level, "timestamp": true},
		"dns":       M{"servers": dnsServers, "rules": dnsRules, "final": dnsFinal},
		"inbounds":  []M{in},
		"outbounds": outs,
		"route":     route,
	}
	if exp := clashExperimental(opts); exp != nil {
		cfg["experimental"] = exp
	}
	return json.MarshalIndent(cfg, "", "  ")
}
