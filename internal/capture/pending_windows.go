package capture

import (
	"time"

	"proxysplit/internal/divert"
)

// ownerGrace is how long a held packet waits for its socket event before the
// kernel owner table is scanned (the event usually arrives first).
const ownerGrace = 2 * time.Millisecond

// pendingCap bounds each queue of held packets. Past it a new connection's SYN
// / DNS query fails open (reinjected: the machine's connections must not hang
// behind us); a datagram of an unclassified UDP port is dropped (UDP is lossy,
// and passing it could be a selected program's).
const pendingCap = 512

// unknownTTL is how long "no owner in the system tables" is trusted for a UDP
// port before the tables are scanned again (a flood from such a port must not
// cost one scan per datagram).
const unknownTTL = time.Second

// heldPkt is a packet whose owner was not known when it arrived. The loop that
// received it never waits: it is copied here and decided by resolveLoop.
type heldPkt struct {
	pkt    []byte
	addr   divert.Address
	at     time.Time
	ticket uint64
	data   bool // a datagram from the data handle (else a SYN / DNS query from the probe)
}

// hold queues a probe packet (SYN / DNS query) for an async owner lookup;
// reinjects when the queue is full.
func (e *Engine) hold(pkt []byte, a *divert.Address) {
	h := heldPkt{pkt: append([]byte(nil), pkt...), addr: *a, at: time.Now(), ticket: e.wd.begin()}
	select {
	case e.pending <- h:
	default:
		e.wd.end(h.ticket)
		_ = e.probe.Send(pkt, a)
	}
}

// holdUDP queues a datagram of an unclassified port; dropped when the queue
// is full.
func (e *Engine) holdUDP(pkt []byte, a *divert.Address) {
	h := heldPkt{pkt: append([]byte(nil), pkt...), addr: *a, at: time.Now(), ticket: e.wd.begin(), data: true}
	select {
	case e.pendingUDP <- h:
	default:
		e.wd.end(h.ticket)
	}
}

// resolveLoop decides held packets in arrival order. Each waits at most
// ownerGrace after it arrived (not per item), then falls back to the table.
func (e *Engine) resolveLoop() {
	defer e.wg.Done()
	unknown := map[uint16]time.Time{} // UDP ports the tables had no owner for
	for {
		var h heldPkt
		select {
		case <-e.stop:
			e.drainPending()
			return
		case h = <-e.pending:
		case h = <-e.pendingUDP:
		}
		if h.data {
			e.decideHeldUDP(h, unknown)
		} else {
			if d := time.Until(h.at.Add(ownerGrace)); d > 0 {
				time.Sleep(d)
			}
			e.decideHeld(h)
		}
		e.wd.end(h.ticket)
	}
}

// heldOwner finds the owner of a held packet's local port: the socket event
// that arrived meanwhile, else the system tables.
func (e *Engine) heldOwner(proto uint8, sport uint16) (uint32, bool) {
	pid, ok := e.own.peek(proto, sport)
	if !ok {
		if pid, ok = tableOwner(proto, sport); ok {
			e.own.set(proto, sport, pid)
		}
	}
	return pid, ok
}

func (e *Engine) decideHeld(h heldPkt) {
	proto := divert.Protocol(h.pkt)
	pid, ok := e.heldOwner(proto, divert.SrcPort(h.pkt))
	v := Verdict{}
	if ok {
		v = e.verdictPID(pid)
	}
	if proto == divert.ProtoTCP {
		e.decideSYN(h.pkt, &h.addr, v)
		return
	}
	ent, captured := udpEntryFor(v, pid)
	e.decideUDP(e.probe, h.pkt, &h.addr, ent, captured)
}

// decideHeldUDP classifies the port of a held datagram and applies the result.
// It is reinjected through the send-only handle: that one sits below the data
// handle, so the datagram is not diverted a second time.
func (e *Engine) decideHeldUDP(h heldPkt, unknown map[uint16]time.Time) {
	sport := divert.SrcPort(h.pkt)
	if ent, ok := e.liveUDP(sport); ok { // classified while it waited
		e.decideUDP(e.sender, h.pkt, &h.addr, ent, true)
		return
	}
	pid, ok := e.own.peek(divert.ProtoUDP, sport)
	if !ok && time.Since(unknown[sport]) > unknownTTL {
		if d := time.Until(h.at.Add(ownerGrace)); d > 0 {
			time.Sleep(d)
		}
		if pid, ok = e.heldOwner(divert.ProtoUDP, sport); !ok {
			if len(unknown) > udpSeenCap {
				clear(unknown)
			}
			unknown[sport] = time.Now()
		}
	}
	if !ok {
		// No process owns it (a kernel socket): nothing of ours to protect.
		e.data.udpChange(func(u *udpPorts) bool { return u.notePass(sport, 0) })
		_ = e.sender.Send(h.pkt, &h.addr)
		return
	}
	delete(unknown, sport)
	e.classifyUDP(e.sender, h.pkt, &h.addr, pid)
}

// drainPending reinjects what is still held at shutdown (fail open).
func (e *Engine) drainPending() {
	for {
		select {
		case h := <-e.pending:
			_ = e.probe.Send(h.pkt, &h.addr)
			e.wd.end(h.ticket)
		case h := <-e.pendingUDP:
			_ = e.sender.Send(h.pkt, &h.addr)
			e.wd.end(h.ticket)
		default:
			return
		}
	}
}

// watchLoop stops the engine when a packet has been stuck for StallLimit, so
// a wedged loop can never stall the machine's new connections.
func (e *Engine) watchLoop() {
	defer e.wg.Done()
	t := time.NewTicker(500 * time.Millisecond)
	defer t.Stop()
	for {
		select {
		case <-e.stop:
			return
		case <-t.C:
			if e.wd.stalled() {
				e.failOpen()
				return
			}
		}
	}
}

// failOpen shuts every handle down at once (no new packets diverted — the
// machine's traffic flows direct), reports, then stops in the background.
func (e *Engine) failOpen() {
	e.shutdownHandles()
	e.log("[capture] " + StallMessage)
	if e.onFail != nil {
		go e.onFail(StallMessage)
	}
	go e.Stop()
}
