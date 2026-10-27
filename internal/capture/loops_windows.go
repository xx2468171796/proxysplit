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
			} else if _, ok := e.data.udpVerdict(s.LocalPort); ok {
				e.data.remove(divert.ProtoUDP, []uint16{s.LocalPort})
			}
		}
	}
}

// noteUDPBind puts a captured program's UDP port into the data filter as soon
// as it is bound, ahead of its first datagram where the race allows.
func (e *Engine) noteUDPBind(port uint16, pid uint32) {
	if pid == e.selfPID || pid <= 4 {
		return
	}
	path := e.own.exe(pid)
	if path == "" || e.exclude[normPath(path)] {
		return
	}
	switch v := e.routes.Load().Decide(path); v.Action {
	case Proxy:
		e.data.setUDP(port, v.Port)
	case Drop:
		e.data.setUDP(port, -1)
	}
}

// probeLoop decides every new outbound TCP connection (its SYN) and DNS query.
func (e *Engine) probeLoop() {
	defer e.wg.Done()
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
		pkt := buf[:n]
		switch divert.Protocol(pkt) {
		case divert.ProtoTCP:
			e.onSYN(pkt, &a)
		case divert.ProtoUDP:
			e.onUDP(e.probe, pkt, &a, true)
		default:
			_ = e.probe.Send(pkt, &a)
		}
	}
}

func (e *Engine) onSYN(pkt []byte, a *divert.Address) {
	sport := divert.SrcPort(pkt)
	v := e.verdict(divert.ProtoTCP, sport)
	switch {
	case v.Action == Pass:
		if e.ct.delete(sport) {
			e.data.remove(divert.ProtoTCP, []uint16{sport})
		}
		_ = e.probe.Send(pkt, a)
	case v.Action == Drop || divert.IsIPv6(pkt):
		// 拦截, or IPv6 from a captured program (relay is IPv4-only): drop so the
		// app falls back to IPv4 instead of leaking direct.
	default:
		ifIdx, sub := a.IfIdx()
		e.ct.put(sport, Flow{LocalIP: divert.SrcIP(pkt), DstIP: divert.DstIP(pkt), DstPort: divert.DstPort(pkt),
			Inbound: v.Port, IfIdx: ifIdx, SubIfIdx: sub})
		if err := e.data.addTCP(sport); err != nil {
			e.log("[capture] 更新抓包过滤器失败: " + err.Error())
			return
		}
		e.forward(pkt, a)
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

// onUDP relays / drops a captured program's datagram, else reinjects it on h.
// probe=true: a DNS query whose owner is not yet known.
func (e *Engine) onUDP(h *divert.Handle, pkt []byte, a *divert.Address, probe bool) {
	sport := divert.SrcPort(pkt)
	inbound, ok := e.data.udpVerdict(sport)
	if !ok && probe {
		switch v := e.verdict(divert.ProtoUDP, sport); v.Action {
		case Proxy:
			inbound, ok = v.Port, true
		case Drop:
			inbound, ok = -1, true
		}
	}
	switch {
	case !ok:
		_ = h.Send(pkt, a)
	case inbound < 0 || divert.IsIPv6(pkt):
		// dropped: 拦截, or IPv6 from a captured program
	default:
		ifIdx, sub := a.IfIdx()
		if err := e.udp.send(pkt, inbound, ifIdx, sub); err != nil {
			e.log("[capture] UDP 中转失败: " + err.Error())
		}
	}
}

// dataLoop serves one generation of the data handle until it is shut down.
func (e *Engine) dataLoop(h *divert.Handle) {
	defer e.wg.Done()
	defer h.Close()
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
		pkt := buf[:n]
		switch divert.Protocol(pkt) {
		case divert.ProtoTCP:
			if f, ok := e.ct.get(divert.SrcPort(pkt)); ok && f.DstIP == divert.DstIP(pkt) {
				e.forward(pkt, &a)
				continue
			}
			_ = h.Send(pkt, &a)
		case divert.ProtoUDP:
			e.onUDP(h, pkt, &a, false)
		default:
			_ = h.Send(pkt, &a)
		}
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
