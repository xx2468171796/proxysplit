package capture

import (
	"sync"

	"proxysplit/internal/divert"
)

// udpEntry is one captured UDP port: where its datagrams go and which process
// registered it (a reused port with another owner is not captured).
type udpEntry struct {
	inbound int // sing-box inbound port; -1 = drop (拦截)
	pid     uint32
}

// dataSet owns the data handle whose filter lists exactly the captured local
// ports. Changes are batched (FilterBatchWindow): one replacement handle is
// opened for many new ports BEFORE the old one is shut down (no gap), and a
// held SYN is released only after the swap that covers its port.
type dataSet struct {
	e       *Engine
	mu      sync.Mutex
	tcp     map[uint16]bool
	applied map[uint16]bool // tcp ports covered by the live handle
	udp     map[uint16]udpEntry
	h       *divert.Handle
	filter  string
	closed  bool
	batch   *batcher
}

func newDataSet(e *Engine) *dataSet {
	d := &dataSet{e: e, tcp: map[uint16]bool{}, applied: map[uint16]bool{}, udp: map[uint16]udpEntry{}}
	d.batch = newBatcher(d.rebuild, FilterBatchWindow)
	return d
}

func keys[V any](m map[uint16]V) []uint16 {
	out := make([]uint16, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// rebuild swaps in a handle for the current port sets. Only the constructor
// and the batch goroutine call it, so swaps never race each other.
func (d *dataSet) rebuild() error {
	d.mu.Lock()
	if d.closed {
		d.mu.Unlock()
		return errBatchClosed
	}
	tcp := make(map[uint16]bool, len(d.tcp))
	for p := range d.tcp {
		tcp[p] = true
	}
	f := DataFilter(keys(d.tcp), keys(d.udp))
	same := f == d.filter && d.h != nil
	d.mu.Unlock()
	if same {
		d.setApplied(tcp)
		return nil
	}
	h, err := divert.Open(f, divert.LayerNetwork, prioData, 0) // filter compile: outside mu
	if err != nil {
		return err
	}
	d.mu.Lock()
	if d.closed {
		d.mu.Unlock()
		_ = h.Close()
		return errBatchClosed
	}
	old := d.h
	d.h, d.filter, d.applied = h, f, tcp
	d.e.wg.Add(1)
	d.mu.Unlock()
	go d.e.dataLoop(h)
	if old != nil {
		old.Shutdown(divert.ShutdownRecv) // its loop drains the queue, then closes it
	}
	return nil
}

func (d *dataSet) setApplied(tcp map[uint16]bool) {
	d.mu.Lock()
	d.applied = tcp
	d.mu.Unlock()
}

// addTCP registers a captured TCP port; done runs once the filter covers it
// (immediately when it already does).
func (d *dataSet) addTCP(port uint16, done func(error)) {
	d.mu.Lock()
	switch {
	case d.closed:
		d.mu.Unlock()
		done(errBatchClosed)
		return
	case d.applied[port]:
		d.tcp[port] = true
		d.mu.Unlock()
		done(nil)
		return
	}
	d.tcp[port] = true
	d.mu.Unlock()
	d.batch.request(done)
}

// setUDP registers a captured UDP port (inbound > 0 relay, -1 drop).
func (d *dataSet) setUDP(port uint16, ent udpEntry) {
	d.mu.Lock()
	if d.closed || d.udp[port] == ent {
		d.mu.Unlock()
		return
	}
	d.udp[port] = ent
	d.mu.Unlock()
	d.batch.request(nil)
}

func (d *dataSet) udpEntry(port uint16) (udpEntry, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	v, ok := d.udp[port]
	return v, ok
}

// remove drops ports (TCP or UDP); the next batch rebuilds once.
func (d *dataSet) remove(proto uint8, ports []uint16) {
	d.mu.Lock()
	if d.closed {
		d.mu.Unlock()
		return
	}
	for _, p := range ports {
		if proto == divert.ProtoTCP {
			delete(d.tcp, p)
		} else {
			delete(d.udp, p)
		}
	}
	d.mu.Unlock()
	d.batch.request(nil)
}

func (d *dataSet) close() {
	d.batch.close()
	d.mu.Lock()
	defer d.mu.Unlock()
	d.closed = true
	if d.h != nil {
		d.h.Shutdown(divert.ShutdownBoth)
	}
}
