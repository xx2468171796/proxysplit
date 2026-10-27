package capture

import (
	"time"

	"proxysplit/internal/divert"
)

// ownerGrace is how long a held packet waits for its socket event before the
// kernel owner table is scanned (the event usually arrives first).
const ownerGrace = 2 * time.Millisecond

// pendingCap bounds held packets; past it new unknowns fail open (reinjected).
const pendingCap = 512

// heldPkt is a SYN / DNS query whose owner was not known when it arrived. The
// probe loop never waits for it: it is copied here and decided by resolveLoop.
type heldPkt struct {
	pkt    []byte
	addr   divert.Address
	at     time.Time
	ticket uint64
}

// hold queues pkt for an async owner lookup; reinjects when the queue is full.
func (e *Engine) hold(pkt []byte, a *divert.Address) {
	h := heldPkt{pkt: append([]byte(nil), pkt...), addr: *a, at: time.Now(), ticket: e.wd.begin()}
	select {
	case e.pending <- h:
	default:
		e.wd.end(h.ticket)
		_ = e.probe.Send(pkt, a)
	}
}

// resolveLoop decides held packets in arrival order. Each waits at most
// ownerGrace after it arrived (not per item), then falls back to the table.
func (e *Engine) resolveLoop() {
	defer e.wg.Done()
	for {
		select {
		case <-e.stop:
			e.drainPending()
			return
		case h := <-e.pending:
			if d := time.Until(h.at.Add(ownerGrace)); d > 0 {
				time.Sleep(d)
			}
			e.decideHeld(h)
			e.wd.end(h.ticket)
		}
	}
}

func (e *Engine) decideHeld(h heldPkt) {
	proto := divert.Protocol(h.pkt)
	sport := divert.SrcPort(h.pkt)
	pid, ok := e.own.peek(proto, sport)
	if !ok {
		if pid, ok = tableOwner(proto, sport); ok {
			e.own.set(proto, sport, pid)
		}
	}
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

// drainPending reinjects what is still held at shutdown (fail open).
func (e *Engine) drainPending() {
	for {
		select {
		case h := <-e.pending:
			_ = e.probe.Send(h.pkt, &h.addr)
			e.wd.end(h.ticket)
		default:
			return
		}
	}
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
