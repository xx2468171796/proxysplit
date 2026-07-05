package engine

import (
	"net/netip"
	"sync"
	"time"
)

// flow records the original addressing of a redirected connection, keyed by the
// client's local TCP port. It lets the redirector recover the true destination
// and lets the reply path restore the original source address.
type flow struct {
	localIP  netip.Addr // app's original local address (restored as reply dst)
	dstIP    netip.Addr // app's original remote address (restored as reply src)
	dstPort  uint16
	target   string // upstream key naming which line's dialer forwards this flow
	ifIdx    uint32 // real interface index of the original SYN (for reply injection)
	subIfIdx uint32
	seen     time.Time // last packet time; drives idle eviction
}

type conntrack struct {
	mu sync.RWMutex
	m  map[uint16]flow
}

func newConntrack() *conntrack {
	return &conntrack{m: map[uint16]flow{}}
}

func (c *conntrack) put(localPort uint16, f flow) {
	f.seen = time.Now()
	c.mu.Lock()
	c.m[localPort] = f
	c.mu.Unlock()
}

func (c *conntrack) get(localPort uint16) (flow, bool) {
	c.mu.RLock()
	f, ok := c.m[localPort]
	c.mu.RUnlock()
	return f, ok
}

// touch refreshes the last-seen time of a live flow so active connections are
// never evicted by the idle GC.
func (c *conntrack) touch(localPort uint16) {
	now := time.Now()
	c.mu.Lock()
	if f, ok := c.m[localPort]; ok {
		f.seen = now
		c.m[localPort] = f
	}
	c.mu.Unlock()
}

func (c *conntrack) delete(localPort uint16) {
	c.mu.Lock()
	delete(c.m, localPort)
	c.mu.Unlock()
}

// gc drops entries idle longer than ttl (based on last packet seen, not creation
// time) so long-lived active connections survive while dead ones are reclaimed.
func (c *conntrack) gc(ttl time.Duration) {
	cutoff := time.Now().Add(-ttl)
	c.mu.Lock()
	for k, v := range c.m {
		if v.seen.Before(cutoff) {
			delete(c.m, k)
		}
	}
	c.mu.Unlock()
}

func (c *conntrack) count() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.m)
}
