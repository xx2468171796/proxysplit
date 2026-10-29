package capture

import (
	"net/netip"
	"sync"
	"time"

	"proxysplit/internal/divert"
)

var loopbackIP = netip.MustParseAddr("127.0.0.1")

// Flow is one captured TCP connection, keyed by the app's local port.
type Flow struct {
	LocalIP  netip.Addr
	DstIP    netip.Addr
	DstPort  uint16
	Inbound  int // sing-box mixed inbound port
	IfIdx    uint32
	SubIfIdx uint32
	Exe      string // owning program (exe path)
	last     time.Time
	closedAt time.Time // socket closed: forget after a grace period
}

// conntrack maps local port -> flow.
type conntrack struct {
	mu    sync.Mutex
	flows map[uint16]*Flow
}

func newConntrack() *conntrack { return &conntrack{flows: map[uint16]*Flow{}} }

func (c *conntrack) put(port uint16, f Flow) {
	f.last = time.Now()
	c.mu.Lock()
	c.flows[port] = &f
	c.mu.Unlock()
}

// get returns a copy and refreshes the idle timer.
func (c *conntrack) get(port uint16) (Flow, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	f, ok := c.flows[port]
	if !ok {
		return Flow{}, false
	}
	f.last = time.Now()
	return *f, true
}

func (c *conntrack) delete(port uint16) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, ok := c.flows[port]
	delete(c.flows, port)
	return ok
}

func (c *conntrack) markClosed(port uint16) {
	c.mu.Lock()
	if f, ok := c.flows[port]; ok && f.closedAt.IsZero() {
		f.closedAt = time.Now()
	}
	c.mu.Unlock()
}

// sweep removes idle and closed flows; returns the removed ports.
func (c *conntrack) sweep(now time.Time, idle, grace time.Duration) []uint16 {
	c.mu.Lock()
	defer c.mu.Unlock()
	var gone []uint16
	for p, f := range c.flows {
		if now.Sub(f.last) > idle || (!f.closedAt.IsZero() && now.Sub(f.closedAt) > grace) {
			delete(c.flows, p)
			gone = append(gone, p)
		}
	}
	return gone
}

func (c *conntrack) ports() []uint16 {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]uint16, 0, len(c.flows))
	for p := range c.flows {
		out = append(out, p)
	}
	return out
}

func (c *conntrack) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.flows)
}

// RewriteForward turns an app -> remote IPv4 TCP segment into a loopback
// segment for the relay listener (127.0.0.1:relayPort), keeping the app's
// source port as the conntrack key. Checksums are recomputed.
func RewriteForward(pkt []byte, relayPort uint16) bool {
	if !divert.IsIPv4(pkt) || divert.Protocol(pkt) != divert.ProtoTCP {
		return false
	}
	divert.SetSrcIP(pkt, loopbackIP)
	divert.SetDstIP(pkt, loopbackIP)
	divert.SetDstPort(pkt, relayPort)
	return divert.FixChecksums(pkt)
}

// RewriteReply turns a relay -> app loopback segment back into what the remote
// would have sent: src = original destination, dst = the app's local address.
func RewriteReply(pkt []byte, f Flow) bool {
	if !divert.IsIPv4(pkt) || divert.Protocol(pkt) != divert.ProtoTCP {
		return false
	}
	divert.SetSrcIP(pkt, f.DstIP)
	divert.SetSrcPort(pkt, f.DstPort)
	divert.SetDstIP(pkt, f.LocalIP)
	return divert.FixChecksums(pkt)
}
