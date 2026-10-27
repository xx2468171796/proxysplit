package capture

import (
	"sync"

	"proxysplit/internal/divert"
)

// dataSet owns the data handle whose filter lists exactly the captured local
// ports. Adding a port opens a replacement handle BEFORE the old one is shut
// down (no gap), so the app's next packet is already diverted when its SYN is
// released. Removals are applied lazily by the sweeper.
type dataSet struct {
	e      *Engine
	mu     sync.Mutex
	tcp    map[uint16]bool
	udp    map[uint16]int // local port -> inbound (-1 = drop)
	h      *divert.Handle
	filter string
	closed bool
}

func newDataSet(e *Engine) *dataSet {
	return &dataSet{e: e, tcp: map[uint16]bool{}, udp: map[uint16]int{}}
}

func keys[V any](m map[uint16]V) []uint16 {
	out := make([]uint16, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// rebuild swaps in a handle for the current port sets. Caller holds mu (or is
// the constructor).
func (d *dataSet) rebuild() error {
	f := DataFilter(keys(d.tcp), keys(d.udp))
	if f == d.filter && d.h != nil {
		return nil
	}
	h, err := divert.Open(f, divert.LayerNetwork, prioData, 0)
	if err != nil {
		return err
	}
	old := d.h
	d.h, d.filter = h, f
	d.e.wg.Add(1)
	go d.e.dataLoop(h)
	if old != nil {
		old.Shutdown(divert.ShutdownRecv) // its loop drains the queue, then closes it
	}
	return nil
}

// addTCP registers a captured TCP port and returns once the filter covers it.
func (d *dataSet) addTCP(port uint16) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed || d.tcp[port] {
		return nil
	}
	d.tcp[port] = true
	return d.rebuild()
}

// setUDP registers a captured UDP port (inbound > 0 relay, -1 drop).
func (d *dataSet) setUDP(port uint16, inbound int) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed || d.udp[port] == inbound {
		return
	}
	d.udp[port] = inbound
	if err := d.rebuild(); err != nil {
		d.e.log("[capture] 更新抓包过滤器失败: " + err.Error())
	}
}

func (d *dataSet) udpVerdict(port uint16) (int, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	v, ok := d.udp[port]
	return v, ok
}

func (d *dataSet) hasTCP(port uint16) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.tcp[port]
}

// remove drops ports (TCP or UDP) and rebuilds once.
func (d *dataSet) remove(proto uint8, ports []uint16) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed {
		return
	}
	for _, p := range ports {
		if proto == divert.ProtoTCP {
			delete(d.tcp, p)
		} else {
			delete(d.udp, p)
		}
	}
	if err := d.rebuild(); err != nil {
		d.e.log("[capture] 更新抓包过滤器失败: " + err.Error())
	}
}

func (d *dataSet) close() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.closed = true
	if d.h != nil {
		d.h.Shutdown(divert.ShutdownBoth)
	}
}
