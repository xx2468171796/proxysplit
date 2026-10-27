// Package dnswarm remembers which (proxied, foreign) domains the user visits
// most and resolves them through the running core right after a start, so
// the first page loads do not wait for remote DNS through the node. The list
// is local only (<dataDir>/dnswarm.json, top 50 with decay); nothing but
// counts ever leaves the machine.
package dnswarm

import (
	"context"
	"encoding/json"
	"math"
	"net/netip"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// MaxDomains kept on disk and prewarmed.
const MaxDomains = 50

// halfLife: a domain's score halves every 3 days without visits.
const halfLife = 72 * time.Hour

// Store is the bounded, decaying domain score table.
type Store struct {
	path   string
	mu     sync.Mutex
	scores map[string]float64
	at     time.Time // when scores were last decayed
}

type fileFormat struct {
	Updated time.Time          `json:"updated"`
	Scores  map[string]float64 `json:"scores"`
}

// Load reads path (a missing / bad file = empty store) and applies the decay
// since it was written.
func Load(path string, now time.Time) *Store {
	s := &Store{path: path, scores: map[string]float64{}, at: now}
	b, err := os.ReadFile(path)
	if err != nil {
		return s
	}
	var f fileFormat
	if json.Unmarshal(b, &f) != nil || f.Scores == nil {
		return s
	}
	s.scores, s.at = f.Scores, f.Updated
	s.decay(now)
	return s
}

func (s *Store) decay(now time.Time) {
	if el := now.Sub(s.at); el > 0 {
		k := math.Pow(0.5, float64(el)/float64(halfLife))
		for d, v := range s.scores {
			s.scores[d] = v * k
		}
	}
	s.at = now
}

// Valid reports whether host is a domain worth remembering (not an IP, has
// a dot, not a mainland .cn name, sane length).
func Valid(host string) bool {
	host = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(host), "."))
	if len(host) < 4 || len(host) > 253 || !strings.Contains(host, ".") || strings.HasSuffix(host, ".cn") {
		return false
	}
	_, err := netip.ParseAddr(host)
	return err != nil
}

// Observe counts one sighting of each host (each host once per call).
func (s *Store) Observe(hosts []string, now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.decay(now)
	seen := map[string]bool{}
	for _, h := range hosts {
		h = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(h), "."))
		if seen[h] || !Valid(h) {
			continue
		}
		seen[h] = true
		s.scores[h]++
	}
	s.trim(MaxDomains * 4) // room for newcomers to climb
}

// trim keeps the n best scores.
func (s *Store) trim(n int) {
	if len(s.scores) <= n {
		return
	}
	for _, d := range s.top(len(s.scores))[n:] {
		delete(s.scores, d)
	}
}

func (s *Store) top(n int) []string {
	out := make([]string, 0, len(s.scores))
	for d := range s.scores {
		out = append(out, d)
	}
	sort.Slice(out, func(i, j int) bool {
		if s.scores[out[i]] != s.scores[out[j]] {
			return s.scores[out[i]] > s.scores[out[j]]
		}
		return out[i] < out[j]
	})
	if len(out) > n {
		out = out[:n]
	}
	return out
}

// Top returns up to n domains, best first.
func (s *Store) Top(n int) []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.top(n)
}

// Save writes the top MaxDomains.
func (s *Store) Save() error {
	s.mu.Lock()
	keep := map[string]float64{}
	for _, d := range s.top(MaxDomains) {
		keep[d] = s.scores[d]
	}
	b, err := json.Marshal(fileFormat{Updated: s.at, Scores: keep})
	s.mu.Unlock()
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// Summary of one prewarm run (the dns.prewarm telemetry payload).
type Summary struct {
	Count int `json:"count"`
	OK    int `json:"ok"`
	Ms    int `json:"ms"`
}

// Prewarm resolves domains with query, at most conc at a time, skipping
// those skip rejects (AI-guard names).
func Prewarm(ctx context.Context, domains []string, conc int, skip func(string) bool, query func(context.Context, string) error) Summary {
	if conc <= 0 {
		conc = 4
	}
	start := time.Now()
	sem := make(chan struct{}, conc)
	var ok, count atomic.Int32
	var wg sync.WaitGroup
	for _, d := range domains {
		if skip != nil && skip(d) {
			continue
		}
		count.Add(1)
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-sem }()
			if query(ctx, d) == nil {
				ok.Add(1)
			}
		}()
	}
	wg.Wait()
	return Summary{Count: int(count.Load()), OK: int(ok.Load()), Ms: int(time.Since(start) / time.Millisecond)}
}

// Clear forgets every learnt domain and removes the file (清除与重置).
func (s *Store) Clear() error {
	s.mu.Lock()
	s.scores = map[string]float64{}
	s.mu.Unlock()
	if err := os.Remove(s.path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
