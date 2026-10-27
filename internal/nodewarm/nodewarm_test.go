package nodewarm

import (
	"context"
	"errors"
	"net"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time      { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *clock) add(d time.Duration) { c.mu.Lock(); c.t = c.t.Add(d); c.mu.Unlock() }

func TestDownBackoffAndRecovery(t *testing.T) {
	clk := &clock{t: time.Unix(1000, 0)}
	var up atomic.Bool
	var dials atomic.Int32
	var changes []Change
	var reresolved atomic.Int32
	m := New(Config{
		Now: clk.now,
		Dial: func(ctx context.Context, addr string) error {
			dials.Add(1)
			if addr != "1.2.3.4:443" && addr != "5.6.7.8:443" {
				t.Errorf("dialed %s", addr)
			}
			if up.Load() {
				return nil
			}
			return errors.New("refused")
		},
		OnChange: func(c Change) { changes = append(changes, c) },
		Reresolve: func(host string, port int) string {
			reresolved.Add(1)
			return "5.6.7.8"
		},
	}, []Target{{Key: "n1", Name: "香港", Host: "hk.example", IP: "1.2.3.4", Port: 443}})

	up.Store(true)
	m.Tick()
	if len(changes) != 0 {
		t.Fatalf("unknown→up must not be reported: %v", changes)
	}
	up.Store(false)
	for range 3 {
		m.Tick()
	}
	if len(changes) != 1 || changes[0].State != StateDown || changes[0].From != StateUp || changes[0].Fails != 3 {
		t.Fatalf("changes %+v", changes)
	}
	// Backoff: no probes for 5 minutes.
	before := dials.Load()
	clk.add(4 * time.Minute)
	m.Tick()
	if dials.Load() != before {
		t.Fatal("probed during backoff")
	}
	// Still down after backoff → probed once, backoff restarts.
	clk.add(2 * time.Minute)
	m.Tick()
	m.Tick()
	if dials.Load() != before+1 {
		t.Fatalf("dials %d, want %d", dials.Load(), before+1)
	}
	clk.add(6 * time.Minute)
	up.Store(true)
	m.Tick()
	if len(changes) != 2 || changes[1].State != StateUp || changes[1].From != StateDown {
		t.Fatalf("changes %+v", changes)
	}
	if reresolved.Load() != 1 || m.Snapshot()[0].Addr != "5.6.7.8:443" {
		t.Fatalf("re-resolve: %d %+v", reresolved.Load(), m.Snapshot())
	}
}

func TestRealListenerStatsAndRing(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			c.Close()
		}
	}()
	port := l.Addr().(*net.TCPAddr).Port
	m := New(Config{}, []Target{{Key: "a", Host: "127.0.0.1", Port: port}, {Key: "a", Host: "dup", Port: 1}, {Key: "b", Host: "127.0.0.1", Port: 1}})
	for range 25 {
		m.Tick()
	}
	s := m.Snapshot()
	if len(s) != 2 {
		t.Fatalf("snapshot %+v", s)
	}
	if s[0].State != StateUp || s[0].Samples != ringSize || s[0].P50Ms < 0 || s[0].Addr != "127.0.0.1:"+strconv.Itoa(port) {
		t.Fatalf("a: %+v", s[0])
	}
	if s[1].State != StateDown || s[1].LastRttMs != -1 || s[1].P50Ms != -1 {
		t.Fatalf("b: %+v", s[1])
	}
}

func TestConcurrencyCapAndStop(t *testing.T) {
	var cur, peak atomic.Int32
	var targets []Target
	for i := range 10 {
		targets = append(targets, Target{Key: strconv.Itoa(i), Host: "h", IP: "1.1.1.1", Port: 1})
	}
	m := New(Config{Interval: time.Hour, Dial: func(ctx context.Context, addr string) error {
		c := cur.Add(1)
		for {
			p := peak.Load()
			if c <= p || peak.CompareAndSwap(p, c) {
				break
			}
		}
		time.Sleep(20 * time.Millisecond)
		cur.Add(-1)
		return nil
	}}, targets)
	m.Start()
	time.Sleep(150 * time.Millisecond)
	m.Stop()
	if peak.Load() > 3 || peak.Load() == 0 {
		t.Fatalf("peak concurrency %d", peak.Load())
	}
	m.Stop() // idempotent
}
