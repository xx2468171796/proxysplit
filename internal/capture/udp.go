package capture

import (
	"net"
	"net/netip"
	"strconv"
	"sync"
	"time"

	"proxysplit/internal/divert"
)

// injectFunc delivers a built inbound IPv4 packet to the app on the given
// interface (the one its datagram left on).
type injectFunc func(pkt []byte, ifIdx, subIfIdx uint32)

// udpSession relays one captured local UDP port through a SOCKS5 association
// on its group's inbound. Replies are rebuilt as packets from the original
// remote and injected inbound, so the app never knows.
type udpSession struct {
	local    netip.AddrPort
	ifIdx    uint32
	subIfIdx uint32
	ctrl     net.Conn
	conn     *net.UDPConn
	mu       sync.Mutex
	last     time.Time
}

type udpTable struct {
	mu       sync.Mutex
	sessions map[uint16]*udpSession
	inject   injectFunc
}

func newUDPTable(inject injectFunc) *udpTable {
	return &udpTable{sessions: map[uint16]*udpSession{}, inject: inject}
}

// send relays one app datagram (IPv4 packet) via inbound.
func (t *udpTable) send(pkt []byte, inbound int, ifIdx, subIfIdx uint32) error {
	src := netip.AddrPortFrom(divert.SrcIP(pkt), divert.SrcPort(pkt))
	dst := netip.AddrPortFrom(divert.DstIP(pkt), divert.DstPort(pkt))
	s, err := t.session(src, inbound, ifIdx, subIfIdx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.last = time.Now()
	s.mu.Unlock()
	_, err = s.conn.Write(EncodeUDPHeader(dst, divert.UDPPayload(pkt)))
	return err
}

func (t *udpTable) session(src netip.AddrPort, inbound int, ifIdx, subIfIdx uint32) (*udpSession, error) {
	t.mu.Lock()
	s := t.sessions[src.Port()]
	t.mu.Unlock()
	if s != nil && s.local == src {
		return s, nil
	}
	ctrl, raddr, err := udpAssociate("127.0.0.1:"+strconv.Itoa(inbound), 3*time.Second)
	if err != nil {
		return nil, err
	}
	conn, err := net.DialUDP("udp4", nil, raddr)
	if err != nil {
		ctrl.Close()
		return nil, err
	}
	s = &udpSession{local: src, ifIdx: ifIdx, subIfIdx: subIfIdx, ctrl: ctrl, conn: conn, last: time.Now()}
	t.mu.Lock()
	if old := t.sessions[src.Port()]; old != nil {
		old.close()
	}
	t.sessions[src.Port()] = s
	t.mu.Unlock()
	go t.readLoop(s)
	return s, nil
}

func (t *udpTable) readLoop(s *udpSession) {
	buf := make([]byte, 65535)
	for {
		n, err := s.conn.Read(buf)
		if err != nil {
			return
		}
		from, payload, err := DecodeUDPHeader(buf[:n])
		if err != nil || !from.Addr().Is4() {
			continue
		}
		s.mu.Lock()
		s.last = time.Now()
		s.mu.Unlock()
		t.inject(divert.BuildUDPv4(from, s.local, payload), s.ifIdx, s.subIfIdx)
	}
}

func (s *udpSession) close() {
	_ = s.conn.Close()
	_ = s.ctrl.Close()
}

// sweep closes idle sessions.
func (t *udpTable) sweep(now time.Time, idle time.Duration) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for p, s := range t.sessions {
		s.mu.Lock()
		stale := now.Sub(s.last) > idle
		s.mu.Unlock()
		if stale {
			s.close()
			delete(t.sessions, p)
		}
	}
}

func (t *udpTable) closeAll() {
	t.sweep(time.Now().Add(time.Hour*24*365), 0)
}
