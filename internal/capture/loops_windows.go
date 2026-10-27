package capture

import (
	"errors"

	"proxysplit/internal/divert"
)

const loopbackIfIdx = 1

// sockLoop records which process owns each local port (sniffed socket events).
func (e *Engine) sockLoop() {
	defer e.wg.Done()
	var a divert.Address
	for {
		if _, err := e.sock.Recv(nil, &a); err != nil {
			if e.recvFailed() {
				return
			}
			continue
		}
		s := a.Socket()
		if s.Protocol != divert.ProtoTCP && s.Protocol != divert.ProtoUDP {
			continue
		}
		switch a.Event() {
		case divert.EventSocketConnect, divert.EventSocketBind:
			e.own.set(s.Protocol, s.LocalPort, s.ProcessID)
			if s.Protocol == divert.ProtoUDP && a.Event() == divert.EventSocketBind {
				e.noteUDPBind(s.LocalPort, s.ProcessID)
			}
		case divert.EventSocketClose:
			e.own.forget(s.Protocol, s.LocalPort)
			if s.Protocol == divert.ProtoTCP {
				e.ct.markClosed(s.LocalPort)
			} else if _, ok := e.data.udpEntry(s.LocalPort); ok {
				e.data.remove(divert.ProtoUDP, []uint16{s.LocalPort})
			}
		}
	}
}

// noteUDPBind puts a captured program's UDP port into the data filter as soon
// as it is bound, ahead of its first datagram where the race allows.
func (e *Engine) noteUDPBind(port uint16, pid uint32) {
	if ent, ok := udpEntryFor(e.verdictPID(pid), pid); ok {
		e.data.setUDP(port, ent)
	}
}

// probeLoop decides every new outbound TCP connection (its SYN) and DNS query.
// It never waits: packets whose owner is unknown go to resolveLoop.
func (e *Engine) probeLoop() {
	defer e.wg.Done()
	slot := e.wd.slot()
	defer e.wd.release(slot)
	buf := make([]byte, 65535)
	var a divert.Address
	for {
		n, err := e.probe.Recv(buf, &a)
		if err != nil {
			if e.recvFailed() {
				return
			}
			continue
		}
		slot.busy()
		pkt := buf[:n]
		switch divert.Protocol(pkt) {
		case divert.ProtoTCP:
			e.onSYN(pkt, &a)
		case divert.ProtoUDP:
			e.onDNS(pkt, &a)
		default:
			_ = e.probe.Send(pkt, &a)
		}
		slot.idle()
	}
}

func (e *Engine) onSYN(pkt []byte, a *divert.Address) {
	pid, ok := e.own.peek(divert.ProtoTCP, divert.SrcPort(pkt))
	if !ok {
		e.hold(pkt, a)
		return
	}
	e.decideSYN(pkt, a, e.verdictPID(pid))
}

// decideSYN applies v to a new connection's SYN. A captured SYN is held (a
// copy) until the batched data filter covers its port, then relayed.
func (e *Engine) decideSYN(pkt []byte, a *divert.Address, v Verdict) {
	sport := divert.SrcPort(pkt)
	switch {
	case v.Action == Pass:
		if e.ct.delete(sport) {
			e.data.remove(divert.ProtoTCP, []uint16{sport})
		}
		_ = e.probe.Send(pkt, a)
	case v.Action == Drop:
		// 拦截
	case divert.IsIPv6(pkt):
		// IPv6 from a captured program (relay is IPv4-only): refuse it so the app
		// falls back to IPv4 at once (a silent drop left non-browser apps waiting
		// ~21 s of SYN retries on dual-stack PCs) and never leaks direct.
		if rst := divert.BuildRSTv6(pkt); rst != nil {
			back := *a
			back.SetOutbound(false)
			_ = e.sender.Send(rst, &back)
		}
	default:
		ifIdx, sub := a.IfIdx()
		e.ct.put(sport, Flow{LocalIP: divert.SrcIP(pkt), DstIP: divert.DstIP(pkt), DstPort: divert.DstPort(pkt),
			Inbound: v.Port, IfIdx: ifIdx, SubIfIdx: sub})
		syn, addr, ticket := append([]byte(nil), pkt...), *a, e.wd.begin()
		e.data.addTCP(sport, func(err error) {
			defer e.wd.end(ticket)
			if err != nil {
				// fail open: the flow goes direct rather than hanging
				e.ct.delete(sport)
				_ = e.probe.Send(syn, &addr)
				if !errors.Is(err, errBatchClosed) {
					e.log("[capture] 更新抓包过滤器失败: " + err.Error())
				}
				return
			}
			e.forward(syn, &addr)
		})
	}
}

// forward sends an app segment to the relay over loopback.
func (e *Engine) forward(pkt []byte, a *divert.Address) {
	if !RewriteForward(pkt, e.relay.port()) {
		return
	}
	a.SetOutbound(true)
	a.SetLoopback(true)
	a.SetIfIdx(loopbackIfIdx, 0)
	a.SetChecksumsValid()
	_ = e.sender.Send(pkt, a)
}

// onDNS handles a DNS query from the probe handle.
func (e *Engine) onDNS(pkt []byte, a *divert.Address) {
	sport := divert.SrcPort(pkt)
	if ent, ok := e.liveUDP(sport); ok {
		e.decideUDP(e.probe, pkt, a, ent, true)
		return
	}
	pid, ok := e.own.peek(divert.ProtoUDP, sport)
	if !ok {
		e.hold(pkt, a)
		return
	}
	ent, captured := udpEntryFor(e.verdictPID(pid), pid)
	e.decideUDP(e.probe, pkt, a, ent, captured)
}

// liveUDP returns the registration of a captured UDP port, dropping it when
// the port now belongs to another process (missed close event / reuse).
func (e *Engine) liveUDP(port uint16) (udpEntry, bool) {
	ent, ok := e.data.udpEntry(port)
	if !ok {
		return ent, false
	}
	if cur, known := e.own.peek(divert.ProtoUDP, port); known && cur != ent.pid {
		e.data.remove(divert.ProtoUDP, []uint16{port})
		return udpEntry{}, false
	}
	return ent, true
}

// decideUDP relays / drops a captured datagram, else reinjects it on h.
func (e *Engine) decideUDP(h *divert.Handle, pkt []byte, a *divert.Address, ent udpEntry, captured bool) {
	switch {
	case !captured:
		_ = h.Send(pkt, a)
	case ent.inbound < 0 || divert.IsIPv6(pkt):
		// dropped: 拦截, or IPv6 from a captured program
	default:
		ifIdx, sub := a.IfIdx()
		if err := e.udp.send(pkt, ent.inbound, ifIdx, sub); err != nil {
			e.log("[capture] UDP 中转失败: " + err.Error())
		}
	}
}

// dataLoop serves one generation of the data handle until it is shut down.
func (e *Engine) dataLoop(h *divert.Handle) {
	defer e.wg.Done()
	defer h.Close()
	slot := e.wd.slot()
	defer e.wd.release(slot)
	buf := make([]byte, 65535)
	var a divert.Address
	for {
		n, err := h.Recv(buf, &a)
		if err != nil {
			if errors.Is(err, divert.ErrNoData) || e.recvFailed() {
				return
			}
			continue
		}
		slot.busy()
		pkt := buf[:n]
		switch divert.Protocol(pkt) {
		case divert.ProtoTCP:
			if f, ok := e.ct.get(divert.SrcPort(pkt)); ok && f.DstIP == divert.DstIP(pkt) && f.DstPort == divert.DstPort(pkt) {
				e.forward(pkt, &a)
			} else {
				_ = h.Send(pkt, &a) // range-filter neighbour or a reused port: untouched
			}
		case divert.ProtoUDP:
			ent, ok := e.liveUDP(divert.SrcPort(pkt))
			e.decideUDP(h, pkt, &a, ent, ok)
		default:
			_ = h.Send(pkt, &a)
		}
		slot.idle()
	}
}

// replyLoop turns relay -> app loopback segments back into remote -> app ones.
func (e *Engine) replyLoop() {
	defer e.wg.Done()
	buf := make([]byte, 65535)
	var a divert.Address
	for {
		n, err := e.reply.Recv(buf, &a)
		if err != nil {
			if e.recvFailed() {
				return
			}
			continue
		}
		pkt := buf[:n]
		f, ok := e.ct.get(divert.DstPort(pkt))
		if !ok || !RewriteReply(pkt, f) {
			_ = e.reply.Send(pkt, &a)
			continue
		}
		a.SetOutbound(false)
		a.SetLoopback(false)
		a.SetIfIdx(f.IfIdx, f.SubIfIdx)
		a.SetChecksumsValid()
		_ = e.sender.Send(pkt, &a)
	}
}
