package capture

import (
	"errors"
	"sync"
	"time"
)

// FilterBatchWindow is how long filter changes are collected before one
// handle swap. Each swap recompiles the filter in the driver and starts a
// goroutine, so a burst of new connections (a browser opening 30 sockets)
// costs one swap instead of thirty; a captured SYN waits at most this long.
const FilterBatchWindow = 25 * time.Millisecond

var errBatchClosed = errors.New("抓包已停止")

// batcher debounces filter rebuilds: request() marks the set dirty and
// registers an optional callback; one flush goroutine waits the window, calls
// apply once for everything requested so far, then runs the callbacks.
type batcher struct {
	apply func() error
	wait  func() // sleeps the batch window (tests replace it)

	mu      sync.Mutex
	waiters []func(error)
	dirty   bool
	closed  bool
	kick    chan struct{}
	done    chan struct{}
}

func newBatcher(apply func() error, window time.Duration) *batcher {
	return &batcher{apply: apply, wait: func() { time.Sleep(window) },
		kick: make(chan struct{}, 1), done: make(chan struct{})}
}

// request schedules a rebuild; cb (may be nil) runs after it with its result.
func (b *batcher) request(cb func(error)) {
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		if cb != nil {
			cb(errBatchClosed)
		}
		return
	}
	b.dirty = true
	if cb != nil {
		b.waiters = append(b.waiters, cb)
	}
	b.mu.Unlock()
	select {
	case b.kick <- struct{}{}:
	default:
	}
}

// run is the flush loop; it returns after close().
func (b *batcher) run() {
	for {
		select {
		case <-b.done:
			b.fail()
			return
		case <-b.kick:
		}
		b.wait()
		b.mu.Lock()
		if b.closed {
			b.mu.Unlock()
			b.fail()
			return
		}
		ws, dirty := b.waiters, b.dirty
		b.waiters, b.dirty = nil, false
		b.mu.Unlock()
		var err error
		if dirty {
			err = b.apply()
		}
		for _, cb := range ws {
			cb(err)
		}
	}
}

// fail answers every pending callback with errBatchClosed.
func (b *batcher) fail() {
	b.mu.Lock()
	ws := b.waiters
	b.waiters = nil
	b.mu.Unlock()
	for _, cb := range ws {
		cb(errBatchClosed)
	}
}

func (b *batcher) close() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.closed {
		b.closed = true
		close(b.done)
	}
}
