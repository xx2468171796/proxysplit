package capture

import (
	"sync"

	"proxysplit/internal/divert"
)

// dataSet owns the data handle: its filter lists the captured TCP ports and
// the UDP pass list (filter.go). Changes are batched (FilterBatchWindow): one
// replacement handle is opened for many changes BEFORE the old one is shut
// down (no gap), and a held SYN is released only after the swap that covers
// its port. UDP needs no such wait: an unclassified port is diverted already.
type dataSet struct {
	e       *Engine
	mu      sync.Mutex
	tcp     map[uint16]bool
	applied map[uint16]bool // tcp ports covered by the live handle
	udp     *udpPorts
	h       *divert.Handle
	filter  string
	closed  bool
	batch   *batcher
}

func newDataSet(e *Engine) *dataSet {
	d := &dataSet{e: e, tcp: map[uint16]bool{}, applied: map[uint16]bool{}, udp: newUDPPorts()}
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
	f := DataFilter(keys(d.tcp), d.udp.passList())
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

// removeTCP drops captured TCP ports; the next batch rebuilds once.
func (d *dataSet) removeTCP(ports []uint16) {
	d.mu.Lock()
	if d.closed {
		d.mu.Unlock()
		return
	}
	for _, p := range ports {
		delete(d.tcp, p)
	}
	d.mu.Unlock()
	d.batch.request(nil)
}

// udpChange runs fn on the UDP classification and schedules a filter swap
// when fn reports that the pass list changed.
func (d *dataSet) udpChange(fn func(u *udpPorts) bool) {
	d.mu.Lock()
	if d.closed {
		d.mu.Unlock()
		return
	}
	changed := fn(d.udp)
	d.mu.Unlock()
	if changed {
		d.batch.request(nil)
	}
}

func (d *dataSet) udpEntry(port uint16) (udpEntry, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.udp.entry(port)
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
