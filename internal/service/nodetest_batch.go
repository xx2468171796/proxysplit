package service

import (
	"fmt"
	"sync"
)

// latencyConcurrency caps how many nodes TestAllLatency probes at once (each
// non-selected node runs its own short-lived probe core).
const latencyConcurrency = 8

// forEachBounded calls fn(0..n-1) with at most limit calls in flight and
// returns when all are done. A panic in one call is recovered so the rest of
// the batch still runs (probe cores are closed by the callee's defer).
func forEachBounded(n, limit int, fn func(i int)) {
	if limit < 1 {
		limit = 1
	}
	sem := make(chan struct{}, limit)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int) {
			defer wg.Done()
			defer func() { <-sem }()
			defer func() { _ = recover() }()
			fn(i)
		}(i)
	}
	wg.Wait()
}

// SpeedAllSummary reports a 「测通再测速」 run.
type SpeedAllSummary struct {
	Total   int `json:"total"`   // nodes tested for latency
	Passed  int `json:"passed"`  // nodes whose Google 延迟 succeeded
	SpeedOK int `json:"speedOk"` // passed nodes whose download test succeeded
}

// TestThenSpeedAll tests every node's latency (bounded concurrency), then
// speed-tests only the nodes that passed, one at a time so they do not compete
// for bandwidth.
func (s *Service) TestThenSpeedAll() SpeedAllSummary {
	s.TestAllLatency()
	s.mu.Lock()
	sum := SpeedAllSummary{Total: len(s.cfg.Nodes)}
	var passed []string
	for _, n := range s.cfg.Nodes {
		if n != nil && n.Latency > 0 {
			passed = append(passed, n.ID)
		}
	}
	s.mu.Unlock()
	sum.Passed = len(passed)
	for _, id := range passed {
		if _, err := s.SpeedTestNode(id); err == nil {
			sum.SpeedOK++
		} else {
			s.log(fmt.Sprintf("[speed] %s: %v", id, err))
		}
	}
	return sum
}
