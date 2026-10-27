package capture

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestCompactRanges(t *testing.T) {
	rs := compactRanges([]uint16{5, 1, 2, 3, 3, 9}, 10)
	if len(rs) != 3 || rs[0] != (portRange{1, 3}) || rs[1] != (portRange{5, 5}) || rs[2] != (portRange{9, 9}) {
		t.Fatalf("adjacent ports must merge: %v", rs)
	}
	var ports []uint16
	for p := 1000; p < 4000; p += 7 {
		ports = append(ports, uint16(p))
	}
	ports = append(ports, 60000) // far outlier: must stay its own range
	rs = compactRanges(ports, 20)
	if rangeCost(rs) > 20 {
		t.Fatalf("cost %d over budget", rangeCost(rs))
	}
	covered := func(p uint16) bool {
		for _, r := range rs {
			if p >= r.lo && p <= r.hi {
				return true
			}
		}
		return false
	}
	for _, p := range ports {
		if !covered(p) {
			t.Fatalf("port %d lost by compaction", p)
		}
	}
	if covered(50000) {
		t.Fatal("the big gap must be the last one merged")
	}
}

// gate is a fake batch window the test opens by hand.
type gate struct{ ch chan struct{} }

func (g gate) wait()    { <-g.ch }
func (g gate) release() { g.ch <- struct{}{} }

func TestBatcherCoalesces(t *testing.T) {
	var applies atomic.Int32
	b := newBatcher(func() error { applies.Add(1); return nil }, time.Hour)
	g := gate{make(chan struct{})}
	b.wait = g.wait
	go b.run()
	defer b.close()

	var wg sync.WaitGroup
	var errs atomic.Int32
	for i := 0; i < 50; i++ {
		wg.Add(1)
		b.request(func(err error) {
			if err != nil {
				errs.Add(1)
			}
			wg.Done()
		})
	}
	b.request(nil) // removals carry no callback
	g.release()
	wg.Wait()
	if n := applies.Load(); n != 1 {
		t.Fatalf("50 requests in one window must cost one apply, got %d", n)
	}
	if errs.Load() != 0 {
		t.Fatal("callbacks must see the apply result (nil)")
	}
}

func TestBatcherPropagatesErrorAndClose(t *testing.T) {
	boom := errors.New("boom")
	b := newBatcher(func() error { return boom }, time.Hour)
	g := gate{make(chan struct{})}
	b.wait = g.wait
	go b.run()
	got := make(chan error, 2)
	b.request(func(err error) { got <- err })
	g.release()
	if err := <-got; !errors.Is(err, boom) {
		t.Fatalf("want apply error, got %v", err)
	}
	b.request(func(err error) { got <- err }) // pending when closed
	b.close()
	go func() { // run may be parked in wait: let it observe close
		select {
		case g.ch <- struct{}{}:
		case <-time.After(time.Second):
		}
	}()
	if err := <-got; !errors.Is(err, errBatchClosed) {
		t.Fatalf("pending callbacks must fail on close, got %v", err)
	}
	b.request(func(err error) { got <- err })
	if err := <-got; !errors.Is(err, errBatchClosed) {
		t.Fatalf("requests after close must fail at once, got %v", err)
	}
}

func TestWatchdog(t *testing.T) {
	now := time.Unix(1000, 0)
	w := newWatchdog(3*time.Second, func() time.Time { return now })
	if w.stalled() {
		t.Fatal("idle must not stall")
	}
	tk := w.begin()
	s := w.slot()
	now = now.Add(2 * time.Second)
	if w.stalled() {
		t.Fatal("under the limit")
	}
	now = now.Add(2 * time.Second)
	if !w.stalled() {
		t.Fatal("a ticket held 4 s must trip")
	}
	w.end(tk)
	if w.stalled() || w.pending() != 0 {
		t.Fatal("closed ticket must clear")
	}
	s.busy()
	now = now.Add(4 * time.Second)
	if !w.stalled() {
		t.Fatal("a loop busy on one packet for 4 s must trip")
	}
	s.idle()
	if w.stalled() {
		t.Fatal("idle loop (blocked in Recv) must not trip")
	}
	s.busy()
	w.release(s)
	now = now.Add(10 * time.Second)
	if w.stalled() {
		t.Fatal("released slot must be ignored")
	}
}
