package capture

import (
	"math/rand"
	"strconv"
	"strings"
	"testing"
)

// pktFacts is what the data filter can see of one packet.
type pktFacts struct {
	outbound, loopback, ipv6, tcp, syn bool
	src, dst                           uint16
}

// filterEval evaluates the subset of the WinDivert filter language that
// DataFilter emits (tests joined by and / or, parentheses, ! on a field), so
// the generated string is checked for what it matches, not how it is spelled.
type filterEval struct {
	toks []string
	i    int
	p    pktFacts
	t    *testing.T
}

func matches(t *testing.T, filter string, p pktFacts) bool {
	t.Helper()
	spaced := strings.NewReplacer("(", " ( ", ")", " ) ", "!=", " != ", "!", " ! ").Replace(filter)
	spaced = strings.ReplaceAll(spaced, "!  =", "!=")
	e := &filterEval{toks: strings.Fields(spaced), p: p, t: t}
	v := e.or()
	if e.i != len(e.toks) {
		t.Fatalf("filter not fully parsed at %q: %s", e.toks[e.i], filter)
	}
	return v
}

func (e *filterEval) peek() string {
	if e.i < len(e.toks) {
		return e.toks[e.i]
	}
	return ""
}

func (e *filterEval) or() bool {
	v := e.and()
	for e.peek() == "or" {
		e.i++
		r := e.and()
		v = v || r
	}
	return v
}

func (e *filterEval) and() bool {
	v := e.unary()
	for e.peek() == "and" {
		e.i++
		r := e.unary()
		v = v && r
	}
	return v
}

func (e *filterEval) unary() bool {
	switch tok := e.peek(); tok {
	case "!":
		e.i++
		if e.peek() == "(" {
			e.t.Fatal("negated parenthesised expressions are not portable WinDivert")
		}
		return !e.unary()
	case "(":
		e.i++
		v := e.or()
		if e.peek() != ")" {
			e.t.Fatalf("missing ) near token %d", e.i)
		}
		e.i++
		return v
	default:
		e.i++
		return e.test(tok)
	}
}

func (e *filterEval) test(field string) bool {
	flags := map[string]bool{"outbound": e.p.outbound, "loopback": e.p.loopback, "ip": !e.p.ipv6, "ipv6": e.p.ipv6,
		"tcp": e.p.tcp, "udp": !e.p.tcp, "tcp.Syn": e.p.tcp && e.p.syn}
	if v, ok := flags[field]; ok {
		return v
	}
	var have int
	switch field {
	case "tcp.SrcPort", "udp.SrcPort":
		if (field == "tcp.SrcPort") != e.p.tcp {
			e.i += 2
			return false // a field of the other protocol never matches
		}
		have = int(e.p.src)
	case "udp.DstPort":
		if e.p.tcp {
			e.i += 2
			return false
		}
		have = int(e.p.dst)
	default:
		e.t.Fatalf("unknown filter field %q", field)
	}
	op := e.toks[e.i]
	want, err := strconv.Atoi(e.toks[e.i+1])
	if err != nil {
		e.t.Fatalf("bad number after %s %s", field, op)
	}
	e.i += 2
	switch op {
	case "==":
		return have == want
	case "!=":
		return have != want
	case "<":
		return have < want
	case ">":
		return have > want
	case "<=":
		return have <= want
	case ">=":
		return have >= want
	}
	e.t.Fatalf("unknown operator %q", op)
	return false
}

func udpPkt(src, dst uint16, v6 bool) pktFacts {
	return pktFacts{outbound: true, ipv6: v6, src: src, dst: dst}
}

// The heart of the fix: a datagram from a port nobody classified yet — IPv4 or
// IPv6 — is diverted; only ports on the pass list stay in the kernel.
func TestDataFilterDivertsUnknownUDP(t *testing.T) {
	for _, tcp := range [][]uint16{nil, {4000, 5001}} {
		f := DataFilter(tcp, []uint16{6000, 6001, 6002, 7000})
		for _, v6 := range []bool{false, true} {
			if !matches(t, f, udpPkt(50000, 443, v6)) {
				t.Fatalf("unknown UDP port must be diverted (ipv6=%v): %s", v6, f)
			}
			for _, pass := range []uint16{6000, 6001, 6002, 7000} {
				if matches(t, f, udpPkt(pass, 443, v6)) {
					t.Fatalf("pass port %d must not be diverted (ipv6=%v): %s", pass, v6, f)
				}
			}
			for _, near := range []uint16{5999, 6003, 6999, 7001} {
				if !matches(t, f, udpPkt(near, 443, v6)) {
					t.Fatalf("port %d next to a pass range must still be diverted: %s", near, f)
				}
			}
			if matches(t, f, udpPkt(50000, 53, v6)) {
				t.Fatal("DNS belongs to the probe handle")
			}
		}
		if matches(t, f, pktFacts{outbound: true, loopback: true, src: 50000, dst: 443}) ||
			matches(t, f, pktFacts{src: 50000, dst: 443}) {
			t.Fatal("loopback and inbound datagrams are never diverted")
		}
	}
}

// TCP keeps its narrow filter: captured ports only, IPv4 only, never a SYN.
func TestDataFilterTCPStaysNarrow(t *testing.T) {
	f := DataFilter([]uint16{4000, 5001}, nil)
	tcp := func(src uint16, v6, syn bool) pktFacts {
		return pktFacts{outbound: true, tcp: true, ipv6: v6, syn: syn, src: src, dst: 443}
	}
	if !matches(t, f, tcp(4000, false, false)) || !matches(t, f, tcp(5001, false, false)) {
		t.Fatalf("captured TCP ports must be diverted: %s", f)
	}
	if matches(t, f, tcp(4001, false, false)) || matches(t, f, tcp(4000, true, false)) || matches(t, f, tcp(4000, false, true)) {
		t.Fatalf("other ports / IPv6 / SYN must not be diverted: %s", f)
	}
	if got := DataFilter(nil, nil); matches(t, got, tcp(4000, false, false)) || !matches(t, got, udpPkt(1, 2, false)) {
		t.Fatalf("no captured flow: no TCP, all unknown UDP: %s", got)
	}
}

// Over budget, the pass list is cut — never widened: every range covers pass
// ports only, the oldest ports are the ones kept, and the cost fits.
func TestExactRangesNeverCoverUnknownPorts(t *testing.T) {
	rng := rand.New(rand.NewSource(7))
	for round := range 200 {
		n := 1 + rng.Intn(400)
		in := map[uint16]bool{}
		var ports []uint16
		for len(ports) < n {
			p := uint16(49152 + rng.Intn(3000))
			if !in[p] {
				in[p] = true
				ports = append(ports, p)
			}
		}
		budget := 2 + rng.Intn(120)
		rs := exactRanges(ports, budget)
		if rangeCost(rs) > budget {
			t.Fatalf("round %d: cost %d over budget %d", round, rangeCost(rs), budget)
		}
		covered := map[uint16]bool{}
		for _, r := range rs {
			for p := int(r.lo); p <= int(r.hi); p++ {
				if !in[uint16(p)] {
					t.Fatalf("round %d: range %d-%d covers %d, which is not a pass port", round, r.lo, r.hi, p)
				}
				covered[uint16(p)] = true
			}
		}
		if !covered[ports[0]] {
			t.Fatalf("round %d: the oldest pass port was dropped (budget %d)", round, budget)
		}
	}
	f := DataFilter(nil, []uint16{6000, 6001, 7000})
	if !strings.Contains(f, "(udp.SrcPort < 6000 or udp.SrcPort > 6001)") || !strings.Contains(f, "udp.SrcPort != 7000") {
		t.Fatalf("pass ranges not compiled as exclusions: %s", f)
	}
}

// A selected program's datagram is relayed or dropped, never reinjected.
func TestUDPDecisionNeverReinjectsSelectedPrograms(t *testing.T) {
	proxied, blocked := udpEntry{inbound: 1080, pid: 9}, udpEntry{inbound: -1, pid: 9}
	cases := []struct {
		ent                  udpEntry
		captured, ipv6, held bool
		want                 udpAction
	}{
		{proxied, true, false, false, udpRelay},
		{proxied, true, true, false, udpDrop}, // IPv6: the relay is IPv4-only
		{proxied, true, false, true, udpDrop}, // core down
		{blocked, true, false, false, udpDrop},
		{blocked, true, true, false, udpDrop},
		{udpEntry{}, false, false, false, udpReinject},
		{udpEntry{}, false, true, true, udpReinject}, // other programs: untouched, also while held
	}
	for i, c := range cases {
		if got := udpDecision(c.ent, c.captured, c.ipv6, c.held); got != c.want {
			t.Fatalf("case %d: got %v want %v", i, got, c.want)
		}
	}
}

// An unselected program's port joins the pass list only after udpPassAfter
// datagrams, and leaves it the moment anything suggests another owner.
func TestUDPPortsPassListLifecycle(t *testing.T) {
	u := newUDPPorts()
	for i := 1; i < udpPassAfter; i++ {
		if u.notePass(5000, 100) {
			t.Fatalf("promoted after %d datagrams", i)
		}
	}
	if !u.notePass(5000, 100) || len(u.passList()) != 1 {
		t.Fatal("port must join the pass list at udpPassAfter")
	}
	if u.notePass(5000, 100) {
		t.Fatal("a pass port seen again changes nothing")
	}
	if u.bound(5000, 100) {
		t.Fatal("the same owner binding again keeps the entry")
	}
	if !u.bound(5000, 200) || len(u.passList()) != 0 {
		t.Fatal("another process binding the port must take it off the pass list")
	}

	for range udpPassAfter {
		u.notePass(5001, 100)
	}
	if !u.capture(5001, udpEntry{inbound: 1080, pid: 300}) {
		t.Fatal("capturing a pass port must change the filter")
	}
	if ent, ok := u.entry(5001); !ok || ent.pid != 300 || len(u.passList()) != 0 {
		t.Fatal("captured port must be registered and off the pass list")
	}
	if u.forget(5001) {
		t.Fatal("forgetting a captured port does not touch the filter")
	}
	if _, ok := u.entry(5001); ok {
		t.Fatal("closed socket must be forgotten")
	}

	for range udpPassAfter {
		u.notePass(5002, 100)
	}
	if !u.forget(5002) {
		t.Fatal("closing a pass port must take it out of the filter")
	}
	// Counting restarts when the owner changes mid-way.
	for range udpPassAfter - 1 {
		u.notePass(5003, 100)
	}
	if u.notePass(5003, 101) {
		t.Fatal("a new owner must earn the pass from zero")
	}
}

// The periodic check repairs missed socket events and list changes.
func TestUDPPortsRevalidate(t *testing.T) {
	u := newUDPPorts()
	for _, port := range []uint16{6000, 6001, 6002, 6003} {
		for range udpPassAfter {
			u.notePass(port, uint32(port))
		}
	}
	for range udpPassAfter {
		u.notePass(6004, 0) // no owner found: kernel socket
	}
	u.capture(7000, udpEntry{inbound: 1080, pid: 70})
	u.capture(7001, udpEntry{inbound: 1080, pid: 71})

	owners := map[uint16][]uint32{
		6000: {6000},     // still its unselected owner
		6001: {6001, 42}, // shared with a selected process
		6002: {999},      // reused by an unselected one: fine
		// 6003: socket gone, close event missed
	}
	selected := func(pid uint32) bool { return pid == 42 }
	decide := func(pid uint32) (udpEntry, bool) {
		if pid == 70 {
			return udpEntry{inbound: 1080, pid: 70}, true
		}
		return udpEntry{}, false // 71 was moved to 直连
	}
	if !u.revalidate(decide, passOwnersOK(owners, selected)) {
		t.Fatal("dropping pass ports must report a filter change")
	}
	got := map[uint16]bool{}
	for _, p := range u.passList() {
		got[p] = true
	}
	if !got[6000] || !got[6002] || !got[6004] || got[6001] || got[6003] {
		t.Fatalf("pass list after revalidate: %v", got)
	}
	if _, ok := u.entry(7000); !ok {
		t.Fatal("an unchanged captured port stays")
	}
	if _, ok := u.entry(7001); ok {
		t.Fatal("a captured port whose program is no longer selected is re-decided")
	}
	if u.revalidate(decide, passOwnersOK(owners, selected)) {
		t.Fatal("nothing left to drop")
	}
}

// reset (the lists changed) forgets everything: each port is decided again.
func TestUDPPortsReset(t *testing.T) {
	u := newUDPPorts()
	u.capture(7000, udpEntry{inbound: 1080, pid: 70})
	if u.reset() {
		t.Fatal("no pass port: the filter does not change")
	}
	for range udpPassAfter {
		u.notePass(6000, 1)
	}
	if !u.reset() || len(u.passList()) != 0 {
		t.Fatal("reset must empty the pass list")
	}
}
