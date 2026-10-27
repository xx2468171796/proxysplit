package noderesolve

import (
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"time"
)

// publicServers are the mainland resolvers asked next to the system ones.
// DoH endpoints are addressed by IP (both certificates carry the IP), so no
// bootstrap lookup is needed and port-53 hijacking cannot touch them.
var publicServers = []Server{
	{Name: "alidns", Kind: KindUDP, Addr: "223.5.5.5:53"},
	{Name: "alidns2", Kind: KindUDP, Addr: "223.6.6.6:53"},
	{Name: "dnspod", Kind: KindUDP, Addr: "119.29.29.29:53"},
	{Name: "114dns", Kind: KindUDP, Addr: "114.114.114.114:53"},
	{Name: "baidu", Kind: KindUDP, Addr: "180.76.76.76:53"},
	{Name: "alidns-doh", Kind: KindDoH, Addr: "https://223.5.5.5/dns-query"},
	{Name: "dnspod-doh", Kind: KindDoH, Addr: "https://1.12.12.12/dns-query"},
}

// DefaultServers is the carrier / system DNS of the active physical adapters
// followed by the public resolvers (duplicates dropped).
func DefaultServers() []Server {
	seen := map[string]bool{}
	var out []Server
	add := func(s Server) {
		if !seen[s.Addr] {
			seen[s.Addr] = true
			out = append(out, s)
		}
	}
	for _, a := range systemDNS() {
		add(Server{Name: "system:" + a.String(), Kind: KindUDP, Addr: net.JoinHostPort(a.String(), "53")})
	}
	for _, s := range publicServers {
		add(s)
	}
	return out
}

// usableSystemDNS filters adapter DNS servers: no loopback (127.0.0.53 is
// the AI-guard NRPT stub), no link-local, nothing inside our own TUN.
func usableSystemDNS(a netip.Addr) bool {
	a = a.Unmap()
	if !a.IsValid() || a.IsLoopback() || a.IsUnspecified() || a.IsLinkLocalUnicast() || a.IsMulticast() {
		return false
	}
	return !ourTUN4.Contains(a) && !ourTUN6.Contains(a) && !siteLocal6.Contains(a)
}

var (
	ourTUN4 = netip.MustParsePrefix("172.19.0.0/30")
	ourTUN6 = netip.MustParsePrefix("fdfe:dcba:9876::/48")
	// fec0:0:0:ffff::1-3 are Windows' placeholder IPv6 DNS servers.
	siteLocal6 = netip.MustParsePrefix("fec0::/10")
)

// DirectDialer dials outside the TUN: on Windows it binds sockets to the
// physical default adapter (IP_UNICAST_IF), so lookups and probes never loop
// into our own tunnel even while the core runs.
func DirectDialer() *net.Dialer {
	d := &net.Dialer{Timeout: 3 * time.Second}
	if ctl := bindControl(); ctl != nil {
		d.Control = ctl
	}
	return d
}

// dohClient is an HTTPS client that never uses a proxy and dials via d.
func dohClient(d *net.Dialer) *http.Client {
	return &http.Client{
		Timeout: 3 * time.Second,
		Transport: &http.Transport{
			Proxy:               nil,
			DialContext:         d.DialContext,
			ForceAttemptHTTP2:   true,
			TLSHandshakeTimeout: 1500 * time.Millisecond,
			TLSClientConfig:     &tls.Config{MinVersion: tls.VersionTLS12},
			DisableKeepAlives:   true,
		},
	}
}

// Summary is the one-line Chinese log of a result, e.g.
// 节点域名 a.example 解析：8 个 DNS 返回 3 个 IP，选 1.2.3.4（连通 35 ms）
func Summary(res Result, err error) string {
	if err != nil {
		return fmt.Sprintf("节点域名 %s 解析：%d 个 DNS 都没有返回可用 IP，沿用域名交给内核解析", res.Host, len(res.Resolvers))
	}
	ok := 0
	for _, a := range res.Resolvers {
		if a.OK {
			ok++
		}
	}
	pick := fmt.Sprintf("（连通 %d ms）", res.BestMs)
	if res.Fallback {
		pick = "（探测都没连上，按票数选）"
	}
	return fmt.Sprintf("节点域名 %s 解析：%d 个 DNS（%d 个成功）返回 %d 个 IP，选 %s%s", res.Host, len(res.Resolvers), ok, len(res.IPs), res.Best, pick)
}

// Payload is the node.resolve telemetry payload (domain + IPs only).
func Payload(res Result, err error) map[string]any {
	rs := make([]map[string]any, 0, len(res.Resolvers))
	for _, a := range res.Resolvers {
		m := map[string]any{"name": a.Name, "ok": a.OK, "ms": a.Ms, "ips": len(a.IPs)}
		if a.ErrCode != "" {
			m["error_code"] = a.ErrCode
		}
		rs = append(rs, m)
	}
	return map[string]any{
		"host": res.Host, "resolvers": rs, "candidates": len(res.IPs), "chosen_ip": res.Best,
		"probe_ms": res.ProbeMs, "best_ms": res.BestMs, "fallback": err != nil || res.Fallback,
	}
}
