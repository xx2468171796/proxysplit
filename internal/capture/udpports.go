package capture

import "sort"

// UDP is fail-closed by construction: the data filter diverts every outbound
// non-DNS datagram EXCEPT those from ports known to belong to programs that
// are not selected (the pass list). A new socket's datagrams therefore always
// reach us first — whatever the address family, and however fast the program
// sends after binding — and are relayed, dropped or reinjected once the owner
// is known. Only then, after udpPassAfter datagrams, does an unselected
// program's port join the pass list and leave userspace for good.

// udpPassAfter is how many datagrams an unselected program's port sends
// through us before it is compiled into the filter's pass list. Short-lived
// sockets (one-shot lookups, probes) never cost a filter swap.
const udpPassAfter = 8

// udpSeenCap bounds the per-port counters of ports not yet in the pass list.
const udpSeenCap = 4096

// udpEntry is one captured UDP port: where its datagrams go and which process
// registered it (a reused port with another owner is not captured).
type udpEntry struct {
	inbound int // sing-box inbound port; -1 = drop (拦截)
	pid     uint32
}

// udpEntryFor maps a verdict to a UDP registration (ok=false: not captured).
func udpEntryFor(v Verdict, pid uint32) (udpEntry, bool) {
	switch v.Action {
	case Proxy:
		return udpEntry{inbound: v.Port, pid: pid}, true
	case Drop:
		return udpEntry{inbound: -1, pid: pid}, true
	}
	return udpEntry{}, false
}

// udpAction is what happens to one diverted datagram.
type udpAction int

const (
	udpReinject udpAction = iota // not ours: back on the wire untouched
	udpDrop
	udpRelay // through the program's inbound (IPv4 only)
)

// udpDecision decides one datagram of a classified port. A selected program's
// datagram is never reinjected: IPv6 (the relay is IPv4-only) and anything
// sent while the core is down (held) are dropped, like 拦截.
func udpDecision(ent udpEntry, captured, ipv6, held bool) udpAction {
	switch {
	case !captured:
		return udpReinject
	case ent.inbound < 0 || ipv6 || held:
		return udpDrop
	default:
		return udpRelay
	}
}

type udpPass struct {
	pid uint32 // 0 = no owner found in the system tables
	seq uint64 // promotion order (older = longer-lived = kept first)
}

type udpSeen struct {
	pid uint32
	n   int
}

// udpPorts is the classification of local UDP ports. Methods that return
// "changed" report that the pass list — and so the filter — changed. Not safe
// for concurrent use (dataSet guards it).
type udpPorts struct {
	captured map[uint16]udpEntry
	pass     map[uint16]udpPass
	seen     map[uint16]udpSeen
	seq      uint64
}

func newUDPPorts() *udpPorts {
	return &udpPorts{captured: map[uint16]udpEntry{}, pass: map[uint16]udpPass{}, seen: map[uint16]udpSeen{}}
}

func (u *udpPorts) unpass(port uint16) bool {
	_, was := u.pass[port]
	delete(u.pass, port)
	delete(u.seen, port)
	return was
}

// capture registers a selected program's port.
func (u *udpPorts) capture(port uint16, ent udpEntry) (changed bool) {
	u.captured[port] = ent
	return u.unpass(port)
}

func (u *udpPorts) entry(port uint16) (udpEntry, bool) {
	ent, ok := u.captured[port]
	return ent, ok
}

// notePass counts a datagram from a port whose owner (pid; 0 = none found) is
// not selected, and promotes the port to the pass list after udpPassAfter.
func (u *udpPorts) notePass(port uint16, pid uint32) (changed bool) {
	delete(u.captured, port)
	if p, ok := u.pass[port]; ok {
		if p.pid == pid {
			return false
		}
		changed = u.unpass(port) // another owner: earn it again
	}
	s := u.seen[port]
	if s.pid != pid {
		s = udpSeen{pid: pid}
	}
	s.n++
	if s.n < udpPassAfter {
		if len(u.seen) >= udpSeenCap {
			u.seen = map[uint16]udpSeen{}
		}
		u.seen[port] = s
		return changed
	}
	delete(u.seen, port)
	u.seq++
	u.pass[port] = udpPass{pid: pid, seq: u.seq}
	return true
}

// forget drops everything known about a port (its socket closed).
func (u *udpPorts) forget(port uint16) (changed bool) {
	delete(u.captured, port)
	return u.unpass(port)
}

// bound notes that pid just bound port: what was learnt about another owner
// no longer holds (the pass entry must go before the new owner sends).
func (u *udpPorts) bound(port uint16, pid uint32) (changed bool) {
	if ent, ok := u.captured[port]; ok && ent.pid != pid {
		delete(u.captured, port)
	}
	if p, ok := u.pass[port]; ok && p.pid == pid {
		return false
	}
	return u.unpass(port)
}

// reset forgets every classification (the app lists changed): each port is
// decided again on its next datagram.
func (u *udpPorts) reset() (changed bool) {
	changed = len(u.pass) > 0
	u.captured, u.pass, u.seen = map[uint16]udpEntry{}, map[uint16]udpPass{}, map[uint16]udpSeen{}
	return changed
}

// revalidate re-checks what was learnt against the current owners and lists
// (a missed close / bind event, a list change racing a datagram): captured
// entries whose verdict changed and pass entries keepPass rejects are dropped.
func (u *udpPorts) revalidate(decide func(pid uint32) (udpEntry, bool), keepPass func(port uint16, pid uint32) bool) (changed bool) {
	for port, ent := range u.captured {
		if now, ok := decide(ent.pid); !ok || now != ent {
			delete(u.captured, port)
		}
	}
	for port, p := range u.pass {
		if !keepPass(port, p.pid) {
			delete(u.pass, port)
			changed = true
		}
	}
	return changed
}

// passList returns the pass ports, oldest promotion first (DataFilter keeps
// that order when the filter budget cannot hold them all).
func (u *udpPorts) passList() []uint16 {
	out := make([]uint16, 0, len(u.pass))
	for p := range u.pass {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return u.pass[out[i]].seq < u.pass[out[j]].seq })
	return out
}

// passOwnersOK is the pass-list rule for revalidate: a port stays only while
// every process that has it bound is unselected. owners is a snapshot of the
// system UDP tables (port -> pids); selected reports whether a pid's datagrams
// must not pass. A port nobody has bound stays only if it never had an owner.
func passOwnersOK(owners map[uint16][]uint32, selected func(pid uint32) bool) func(port uint16, pid uint32) bool {
	return func(port uint16, pid uint32) bool {
		pids := owners[port]
		if len(pids) == 0 {
			return pid == 0
		}
		for _, p := range pids {
			if selected(p) {
				return false
			}
		}
		return true
	}
}
