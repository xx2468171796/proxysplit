package capture

import (
	"sync"
	"sync/atomic"
	"time"
)

// StallLimit is how long a packet may sit in our hands (a loop processing it,
// or a held SYN / DNS query) before the engine is declared stuck and stopped.
// Stopping closes the handles, so traffic fails open (direct) instead of the
// whole machine's new connections hanging behind a wedged loop.
const StallLimit = 3 * time.Second

// StallMessage is logged / reported when the watchdog stops the engine.
const StallMessage = "仅接管选中程序处理卡住超过 3 秒，已自动停止接管（流量暂时直连）。如果反复出现，请在设置里改用「整机虚拟网卡」"

// watchdog tracks work in progress: each packet a loop is processing and each
// packet held for an owner lookup or filter swap is a ticket with a start
// time. stalled() reports when the oldest open ticket is older than limit.
// Idle loops (blocked in Recv) hold no ticket, so quiet periods never trip it.
type watchdog struct {
	mu    sync.Mutex
	next  uint64
	open  map[uint64]time.Time
	slots []*loopSlot
	now   func() time.Time
	limit time.Duration
}

func newWatchdog(limit time.Duration, now func() time.Time) *watchdog {
	if now == nil {
		now = time.Now
	}
	return &watchdog{open: map[uint64]time.Time{}, now: now, limit: limit}
}

// begin opens a ticket; end(ticket) closes it (idempotent).
func (w *watchdog) begin() uint64 {
	w.mu.Lock()
	w.next++
	id := w.next
	w.open[id] = w.now()
	w.mu.Unlock()
	return id
}

func (w *watchdog) end(id uint64) {
	w.mu.Lock()
	delete(w.open, id)
	w.mu.Unlock()
}

// loopSlot is a per-loop ticket without locking on the packet path: busy()
// before handling a packet, idle() after.
type loopSlot struct {
	w     *watchdog
	since atomic.Int64 // unix nanos; 0 = idle
}

func (w *watchdog) slot() *loopSlot {
	s := &loopSlot{w: w}
	w.mu.Lock()
	w.slots = append(w.slots, s)
	w.mu.Unlock()
	return s
}

// release unregisters a slot whose loop has exited.
func (w *watchdog) release(s *loopSlot) {
	w.mu.Lock()
	defer w.mu.Unlock()
	for i, x := range w.slots {
		if x == s {
			w.slots = append(w.slots[:i], w.slots[i+1:]...)
			return
		}
	}
}

func (s *loopSlot) busy() { s.since.Store(s.w.now().UnixNano()) }
func (s *loopSlot) idle() { s.since.Store(0) }

// stalled reports whether any ticket has been open longer than the limit.
func (w *watchdog) stalled() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	now := w.now()
	for _, at := range w.open {
		if now.Sub(at) > w.limit {
			return true
		}
	}
	for _, s := range w.slots {
		if ns := s.since.Load(); ns != 0 && now.Sub(time.Unix(0, ns)) > w.limit {
			return true
		}
	}
	return false
}

// pending is the number of open tickets (diagnostics / tests).
func (w *watchdog) pending() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return len(w.open)
}
