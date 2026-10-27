package service

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestForEachBoundedCapsConcurrency(t *testing.T) {
	var inFlight, peak int32
	var mu sync.Mutex
	done := make([]bool, 30)
	forEachBounded(len(done), 8, func(i int) {
		cur := atomic.AddInt32(&inFlight, 1)
		for {
			p := atomic.LoadInt32(&peak)
			if cur <= p || atomic.CompareAndSwapInt32(&peak, p, cur) {
				break
			}
		}
		time.Sleep(5 * time.Millisecond)
		atomic.AddInt32(&inFlight, -1)
		mu.Lock()
		done[i] = true
		mu.Unlock()
	})
	if peak > 8 || peak < 2 {
		t.Fatalf("peak concurrency %d, want 2..8", peak)
	}
	for i, d := range done {
		if !d {
			t.Fatalf("job %d not run", i)
		}
	}
}

func TestForEachBoundedSurvivesPanic(t *testing.T) {
	var ran int32
	forEachBounded(5, 2, func(i int) {
		atomic.AddInt32(&ran, 1)
		if i == 1 {
			panic("boom")
		}
	})
	if ran != 5 {
		t.Fatalf("ran %d, want 5", ran)
	}
}
