package noderesolve

import (
	"context"
	"net"
	"net/netip"
	"sort"
	"strconv"
	"sync"
	"time"
)

// bogus ranges: never a usable public node address. 198.18.0.0/15 is where
// fake-IP DNS (another proxy tool on the machine) hands out addresses;
// 100.64.0.0/10 is carrier NAT; 172.19.0.0/30 / fdfe: are our own TUN.
var bogus = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("fdfe:dcba:9876::/48"),
}

// usable reports whether a is a plausible public node address.
func usable(a netip.Addr) bool {
	a = a.Unmap()
	if !a.IsValid() || a.IsUnspecified() || a.IsLoopback() || a.IsPrivate() ||
		a.IsLinkLocalUnicast() || a.IsMulticast() || a.IsInterfaceLocalMulticast() || !a.IsGlobalUnicast() {
		return false
	}
	for _, p := range bogus {
		if p.Contains(a) {
			return false
		}
	}
	return true
}

// filterBogus keeps the usable addresses (unmapped).
func filterBogus(in []netip.Addr) []netip.Addr {
	out := in[:0:0]
	for _, a := range in {
		if usable(a) {
			out = append(out, a.Unmap())
		}
	}
	return out
}

// union merges the answers, most votes first (ties: first seen first).
func union(answers []Answer) []string {
	votes := map[string]int{}
	var order []string
	for _, a := range answers {
		seen := map[string]bool{}
		for _, ip := range a.IPs {
			if seen[ip] {
				continue
			}
			seen[ip] = true
			if votes[ip] == 0 {
				order = append(order, ip)
			}
			votes[ip]++
		}
	}
	sort.SliceStable(order, func(i, j int) bool { return votes[order[i]] > votes[order[j]] })
	return order
}

// rank TCP-probes the candidates in parallel: reachable ones by connect time,
// then the rest in vote order. bestMs is -1 when nothing answered (or port
// <= 0, i.e. probing is off).
func (r *Resolver) rank(ctx context.Context, cands []string, port int) ([]string, int) {
	if port <= 0 {
		return cands, -1
	}
	ms := make([]int, len(cands))
	var wg sync.WaitGroup
	d := r.cfg.Dialer()
	for i, ip := range cands {
		wg.Add(1)
		go func() {
			defer wg.Done()
			pctx, cancel := context.WithTimeout(ctx, r.cfg.ProbeTimeout)
			defer cancel()
			start := time.Now()
			if err := r.cfg.probe(pctx, d, net.JoinHostPort(ip, strconv.Itoa(port))); err != nil {
				ms[i] = -1
				return
			}
			ms[i] = max(int(time.Since(start)/time.Millisecond), 0)
		}()
	}
	wg.Wait()
	idx := make([]int, len(cands))
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(a, b int) bool {
		ma, mb := ms[idx[a]], ms[idx[b]]
		if (ma >= 0) != (mb >= 0) {
			return ma >= 0
		}
		return ma >= 0 && ma < mb
	})
	out := make([]string, len(cands))
	for i, j := range idx {
		out[i] = cands[j]
	}
	return out, ms[idx[0]]
}

// tcpProbe opens and closes a TCP connection (no payload).
func tcpProbe(ctx context.Context, d *net.Dialer, addr string) error {
	c, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return err
	}
	return c.Close()
}
