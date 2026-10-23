package aiguard

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/netip"
	"sync"
	"time"
)

// 「是不是我们的出口」：公司 POWER云 落地机 / 中转机的出口地址（AI 看到的多半是 IPv6）。
// 名单放深圳 /rules/egress-ours.json（server/deploy/egress-ours.json，改机器只改它，不用发版），
// 拉不到用下面内置的那份。HiNet 家宽是动态 IP：写 DDNS 域名，检测时现解析；IPv6 按 /64 认。

// OursURL is the published list. A variable so tests can point it elsewhere.
var OursURL = "https://proxysplit.zygskins.cn/rules/egress-ours.json"

// OursList is the egress-ours.json format.
type OursList struct {
	IPs   []string `json:"ips"`   // fixed exit addresses
	CIDRs []string `json:"cidrs"` // exit ranges (IPv6 /64 of each machine)
	Hosts []string `json:"hosts"` // DDNS names of dynamic exits (A and AAAA; AAAA matches its /64)
}

// builtinOurs mirrors server/deploy/egress-ours.json (2026-10-23).
var builtinOurs = OursList{
	IPs: []string{
		"211.76.176.116", // tw-pro 台湾主力中转（也是出口）
		"122.116.1.113",  // tw-relayops 公司出海主出口（台湾固定 IP）
		"104.194.70.4",   // bigbox 美西
		"104.194.65.46",  // bwg-meg 美西
		"95.169.1.61",    // la / DC9 美西
		"103.133.154.98", // vc-relay
	},
	CIDRs: []string{
		"2405:cdc0:0:902::/64",     // tw-pro
		"2001:b011:6c11:b260::/64", // tw-relayops / tw-landing（台湾家宽）
		"2607:8700:5500:4ddb::/64", // bigbox
		"2602:f83b:a886::/64",      // vc-relay
		"2001:b030:a81d:a00::/64",  // hinet
	},
	Hosts: []string{"hinet.alonelife.top", "hinet6.alonelife.top"},
}

var (
	oursMu      sync.Mutex
	oursCache   OursList
	oursFetched time.Time
)

// ours returns the published list (cached 30 min), falling back to the
// built-in one.
func ours(ctx context.Context) OursList {
	oursMu.Lock()
	defer oursMu.Unlock()
	if time.Since(oursFetched) < 30*time.Minute {
		return oursCache
	}
	l := builtinOurs
	if got, err := fetchOurs(ctx); err == nil && len(got.IPs)+len(got.CIDRs)+len(got.Hosts) > 0 {
		l = got
	}
	oursCache, oursFetched = l, time.Now()
	return l
}

func fetchOurs(ctx context.Context) (OursList, error) {
	c, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(c, http.MethodGet, OursURL, nil)
	if err != nil {
		return OursList{}, err
	}
	resp, err := (&http.Client{Transport: &http.Transport{Proxy: nil}}).Do(req)
	if err != nil {
		return OursList{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return OursList{}, io.ErrUnexpectedEOF
	}
	var l OursList
	err = json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&l)
	return l, err
}

// IsOurExit reports whether ip is one of our POWER云 exits.
func IsOurExit(ctx context.Context, ip string) bool {
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return false
	}
	return oursMatch(ours(ctx), addr.Unmap(), func(h string) []netip.Addr {
		c, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
		got, _ := net.DefaultResolver.LookupNetIP(c, "ip", h)
		return got
	})
}

// oursMatch is IsOurExit without the network (resolve looks up a DDNS name).
func oursMatch(l OursList, addr netip.Addr, resolve func(string) []netip.Addr) bool {
	for _, s := range l.IPs {
		if a, err := netip.ParseAddr(s); err == nil && a == addr {
			return true
		}
	}
	for _, s := range l.CIDRs {
		if p, err := netip.ParsePrefix(s); err == nil && p.Contains(addr) {
			return true
		}
	}
	for _, h := range l.Hosts {
		for _, a := range resolve(h) {
			a = a.Unmap()
			if a == addr {
				return true
			}
			if a.Is6() && addr.Is6() {
				if p, err := a.Prefix(64); err == nil && p.Contains(addr) {
					return true
				}
			}
		}
	}
	return false
}
