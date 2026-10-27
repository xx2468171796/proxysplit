package dnswarm

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestObserveDecayPersist(t *testing.T) {
	p := filepath.Join(t.TempDir(), "dnswarm.json")
	now := time.Unix(1_000_000, 0)
	s := Load(p, now)
	for range 3 {
		s.Observe([]string{"www.google.com", "WWW.GOOGLE.COM.", "1.2.3.4", "baidu.cn", "x", "github.com"}, now)
	}
	s.Observe([]string{"github.com"}, now)
	if got := strings.Join(s.Top(10), ","); got != "github.com,www.google.com" {
		t.Fatalf("top %s", got)
	}
	for i := range 120 {
		s.Observe([]string{fmt.Sprintf("d%03d.example.com", i)}, now)
	}
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
	// Six days later (two half-lives): scores quartered, order kept, 50 max.
	s2 := Load(p, now.Add(144*time.Hour))
	top := s2.Top(100)
	if len(top) != MaxDomains || top[0] != "github.com" {
		t.Fatalf("reloaded %d %v", len(top), top[:2])
	}
	if v := s2.scores["github.com"]; v < 0.99 || v > 1.01 {
		t.Fatalf("decayed score %v, want 1", v)
	}
	// Fresh visits beat old favourites.
	for range 2 {
		s2.Observe([]string{"new.example.org"}, now.Add(144*time.Hour))
	}
	if s2.Top(1)[0] != "new.example.org" {
		t.Fatalf("top %v", s2.Top(3))
	}
}

func TestPrewarmSkipsAndCaps(t *testing.T) {
	var cur, peak, calls atomic.Int32
	skip := func(d string) bool { return strings.HasSuffix(d, "openai.com") }
	q := func(ctx context.Context, d string) error {
		calls.Add(1)
		c := cur.Add(1)
		for p := peak.Load(); c > p && !peak.CompareAndSwap(p, c); p = peak.Load() {
		}
		time.Sleep(10 * time.Millisecond)
		cur.Add(-1)
		if d == "bad.example" {
			return errors.New("x")
		}
		return nil
	}
	ds := []string{"api.openai.com", "bad.example"}
	for i := range 12 {
		ds = append(ds, fmt.Sprintf("d%d.example", i))
	}
	sum := Prewarm(context.Background(), ds, 4, skip, q)
	if sum.Count != 13 || sum.OK != 12 || calls.Load() != 13 || peak.Load() > 4 {
		t.Fatalf("%+v calls=%d peak=%d", sum, calls.Load(), peak.Load())
	}
}
