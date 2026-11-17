package capture

import (
	"fmt"
	"sort"
	"strings"
)

// Filter design (lowest overhead WinDivert allows without a WFP connect-redirect
// driver; see docs/memory/routing.md):
//   - probe handle: only the FIRST packet of each outbound TCP connection (pure
//     SYN) plus DNS queries. One packet per connection for unmatched programs.
//   - data handle, TCP: only packets whose local port belongs to a captured
//     flow. The ports are compiled into the filter as ranges and the handle is
//     replaced in batches, so unmatched data packets are never diverted.
//   - data handle, UDP: every non-DNS datagram (IPv4 and IPv6) except those
//     from ports known to belong to unselected programs (udpports.go). The
//     NETWORK layer cannot match a process, and a socket event always arrives
//     after the program may already be sending, so "divert until known" is
//     the only order in which a selected program's first datagrams cannot
//     leave directly. An unselected program pays its first few datagrams per
//     socket through userspace, as it pays one SYN per TCP connection.
//   - reply handle: loopback packets from our relay listener only.

// FilterBudget caps the port comparisons compiled into the data filter
// (WinDivert compiles at most 256 filter objects; the rest is fixed overhead).
// A single port costs 1, a range 2. Past the budget the closest ranges are
// merged, so a few unrelated ports in the gaps get diverted and reinjected
// untouched — the filter never widens to every program's traffic.
const FilterBudget = 200

// ProbeFilter catches new outbound connections (pure SYN, v4 and v6) and DNS.
func ProbeFilter() string {
	return "outbound and !loopback and ((tcp and tcp.Syn and !tcp.Ack) or (udp and udp.DstPort == 53))"
}

// SocketFilter sniffs socket events that tell us which process owns a local
// port (no packets, one event per socket operation).
func SocketFilter() string {
	return "!loopback and (event == CONNECT or event == BIND or event == CLOSE)"
}

// ReplyFilter catches the relay listener's loopback replies.
func ReplyFilter(relayPort int) string {
	return fmt.Sprintf("loopback and ip and tcp and tcp.SrcPort == %d", relayPort)
}

// DataFilter diverts the captured TCP ports (IPv4: IPv6 connections of
// selected programs are refused at their SYN) and every non-DNS UDP datagram
// of either family whose source port is not in udpPass. udpPass is in priority
// order: when the budget cannot hold all of it the tail is left out — those
// ports stay diverted and are reinjected from userspace, never the reverse.
// Only tests (==, !=, <, >, <=, >=) joined by and / or are used: negating a
// parenthesised expression is not portable across WinDivert versions.
func DataFilter(tcpPorts, udpPass []uint16) string {
	tb, ub := FilterBudget, FilterBudget
	if len(tcpPorts) > 0 && len(udpPass) > 0 {
		tb = FilterBudget * len(tcpPorts) / (len(tcpPorts) + len(udpPass))
		tb = min(max(tb, 2), FilterBudget-2)
		ub = FilterBudget - tb
	}
	udp := "udp and udp.DstPort != 53"
	if ex := exceptList("udp.SrcPort", exactRanges(udpPass, ub)); ex != "" {
		udp += " and " + ex
	}
	if len(tcpPorts) == 0 {
		return "outbound and !loopback and " + udp
	}
	return "outbound and !loopback and ((ip and tcp and !tcp.Syn and (" + rangeList("tcp.SrcPort", compactRanges(tcpPorts, tb)) + ")) or (" + udp + "))"
}

type portRange struct{ lo, hi uint16 }

func rangeCost(rs []portRange) int {
	c := 0
	for _, r := range rs {
		c++
		if r.hi != r.lo {
			c++
		}
	}
	return c
}

// compactRanges turns ports into sorted ranges (adjacent ports merge for free)
// and, while the cost exceeds budget, merges across the smallest gaps.
func compactRanges(ports []uint16, budget int) []portRange {
	s := append([]uint16(nil), ports...)
	sort.Slice(s, func(i, j int) bool { return s[i] < s[j] })
	var rs []portRange
	for _, p := range s {
		if n := len(rs); n > 0 && (p == rs[n-1].hi || p == rs[n-1].hi+1) {
			rs[n-1].hi = p
			continue
		}
		rs = append(rs, portRange{p, p})
	}
	if rangeCost(rs) <= budget || len(rs) < 2 {
		return rs
	}
	keep := max(budget/2, 1) // every range costs at most 2
	type gap struct{ i, size int }
	gaps := make([]gap, len(rs)-1)
	for i := range gaps {
		gaps[i] = gap{i, int(rs[i+1].lo) - int(rs[i].hi)}
	}
	sort.SliceStable(gaps, func(a, b int) bool { return gaps[a].size < gaps[b].size })
	join := make([]bool, len(rs)-1) // join[i]: merge rs[i] with rs[i+1]
	for _, g := range gaps[:len(rs)-keep] {
		join[g.i] = true
	}
	out := []portRange{rs[0]}
	for i := 1; i < len(rs); i++ {
		if join[i-1] {
			out[len(out)-1].hi = rs[i].hi
		} else {
			out = append(out, rs[i])
		}
	}
	return out
}

func rangeList(field string, rs []portRange) string {
	terms := make([]string, len(rs))
	for i, r := range rs {
		if r.lo == r.hi {
			terms[i] = fmt.Sprintf("%s == %d", field, r.lo)
		} else {
			terms[i] = fmt.Sprintf("(%s >= %d and %s <= %d)", field, r.lo, field, r.hi)
		}
	}
	return strings.Join(terms, " or ")
}

// exactRanges turns ports (priority order) into ranges that cover exactly
// those ports — never a gap, unlike compactRanges — and, when their cost
// exceeds budget, keeps the ranges holding the highest-priority ports.
func exactRanges(ports []uint16, budget int) []portRange {
	if len(ports) == 0 {
		return nil
	}
	rank := make(map[uint16]int, len(ports))
	for i, p := range ports {
		if _, dup := rank[p]; !dup {
			rank[p] = i
		}
	}
	type ranked struct {
		portRange
		best int // best (lowest) priority index among its ports
	}
	var rs []ranked
	for _, r := range compactRanges(ports, 1<<30) {
		best := rank[r.lo]
		for p := int(r.lo) + 1; p <= int(r.hi); p++ {
			best = min(best, rank[uint16(p)])
		}
		rs = append(rs, ranked{r, best})
	}
	sort.SliceStable(rs, func(i, j int) bool { return rs[i].best < rs[j].best })
	var out []portRange
	cost := 0
	for _, r := range rs {
		c := rangeCost([]portRange{r.portRange})
		if cost+c > budget {
			continue // a cheaper (single-port) range further down may still fit
		}
		cost += c
		out = append(out, r.portRange)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].lo < out[j].lo })
	return out
}

// exceptList is the condition "field is in none of rs" ("" for no ranges).
func exceptList(field string, rs []portRange) string {
	terms := make([]string, len(rs))
	for i, r := range rs {
		if r.lo == r.hi {
			terms[i] = fmt.Sprintf("%s != %d", field, r.lo)
		} else {
			terms[i] = fmt.Sprintf("(%s < %d or %s > %d)", field, r.lo, field, r.hi)
		}
	}
	return strings.Join(terms, " and ")
}
