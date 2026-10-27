// Package nodewarm keeps the nodes in use "warm" while the proxy runs: every
// interval it TCP-connects (direct, no TLS, no payload) to each node's
// pre-resolved IP:port, keeps the last RTTs, and marks a node down after
// FailThreshold consecutive failures. A down node is left alone for Backoff
// (fail2ban-style protection: no hammering a node that is blocking us), then
// probed again; coming back up triggers a fresh DNS resolve. Purely
// observational: it never changes routing (AI 劫持 included).
package nodewarm

import (
	"context"
	"net"
	"sort"
	"strconv"
	"sync"
	"time"
)

// Node states.
const (
	StateUnknown = "unknown"
	StateUp      = "up"
	StateDown    = "down"
)

// ringSize: RTT samples kept per node.
const ringSize = 20

// Target is one node to keep warm.
type Target struct {
	Key  string // node ID
	Name string
	Host string // server as configured (domain or IP)
	IP   string // pre-resolved address to dial ("" = Host)
	Port int
}

// Stats is one node's health snapshot (diag / UI).
type Stats struct {
	Key       string `json:"id"`
	Name      string `json:"name"`
	Addr      string `json:"addr"`
	State     string `json:"state"`
	LastRttMs int    `json:"lastRttMs"` // -1 = last probe failed
	P50Ms     int    `json:"p50Ms"`     // -1 = no successful sample
	Fails     int    `json:"fails"`     // consecutive
	Samples   int    `json:"samples"`
}

// Change is a state transition (only transitions are reported).
type Change struct {
	Stats
	From string
}

// Config tunes a Monitor; zero values take the defaults.
type Config struct {
	Interval      time.Duration // default 30 s
	Backoff       time.Duration // default 5 min after a node goes down
	FailThreshold int           // default 3
	Concurrency   int           // default 3 probes at once
	Timeout       time.Duration // per probe, default 3 s
	Dial          func(ctx context.Context, addr string) error
	Now           func() time.Time
	OnChange      func(Change)
	// Reresolve returns a fresh address for a node that came back (cache
	// bypassed); "" keeps the old one.
	Reresolve func(host string, port int) string
}

type node struct {
	t        Target
	state    string
	ring     []int
	last     int
	fails    int
	downAt   time.Time
	inFlight bool
}

// Monitor probes a fixed target set until Stop.
type Monitor struct {
	cfg   Config
	sem   chan struct{}
	mu    sync.Mutex
	nodes []*node
	stop  chan struct{}
	ctx   context.Context // cancelled by Stop: in-flight dials end at once
	quit  context.CancelFunc
	done  sync.WaitGroup
	once  sync.Once
}

// New builds a monitor for targets (duplicates by Key dropped).
func New(cfg Config, targets []Target) *Monitor {
	if cfg.Interval <= 0 {
		cfg.Interval = 30 * time.Second
	}
	if cfg.Backoff <= 0 {
		cfg.Backoff = 5 * time.Minute
	}
	if cfg.FailThreshold <= 0 {
		cfg.FailThreshold = 3
	}
	if cfg.Concurrency <= 0 {
		cfg.Concurrency = 3
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 3 * time.Second
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.Dial == nil {
		cfg.Dial = func(ctx context.Context, addr string) error {
			c, err := (&net.Dialer{}).DialContext(ctx, "tcp", addr)
			if err != nil {
				return err
			}
			return c.Close()
		}
	}
	m := &Monitor{cfg: cfg, sem: make(chan struct{}, cfg.Concurrency), stop: make(chan struct{})}
	m.ctx, m.quit = context.WithCancel(context.Background())
	seen := map[string]bool{}
	for _, t := range targets {
		if t.Key == "" || seen[t.Key] || t.Host == "" || t.Port <= 0 {
			continue
		}
		seen[t.Key] = true
		m.nodes = append(m.nodes, &node{t: t, state: StateUnknown, last: -1})
	}
	return m
}

// Start runs the probe loop (first round immediately).
func (m *Monitor) Start() {
	m.done.Add(1)
	go func() {
		defer m.done.Done()
		tk := time.NewTicker(m.cfg.Interval)
		defer tk.Stop()
		for {
			m.Tick()
			select {
			case <-m.stop:
				return
			case <-tk.C:
			}
		}
	}()
}

// Stop ends the loop and waits for in-flight probes.
func (m *Monitor) Stop() {
	m.once.Do(func() { close(m.stop); m.quit() })
	m.done.Wait()
}

// Tick runs one probe round (exported for tests with a fake clock).
func (m *Monitor) Tick() {
	now := m.cfg.Now()
	var wg sync.WaitGroup
	m.mu.Lock()
	for _, n := range m.nodes {
		if n.inFlight || n.state == StateDown && now.Sub(n.downAt) < m.cfg.Backoff {
			continue
		}
		n.inFlight = true
		wg.Add(1)
		go func() {
			defer wg.Done()
			m.probe(n)
		}()
	}
	m.mu.Unlock()
	wg.Wait()
}

// probe dials one node under the semaphore and records the outcome.
func (m *Monitor) probe(n *node) {
	select {
	case m.sem <- struct{}{}:
	case <-m.stop:
		m.mu.Lock()
		n.inFlight = false
		m.mu.Unlock()
		return
	}
	defer func() { <-m.sem }()
	m.mu.Lock()
	addr := n.addr()
	m.mu.Unlock()
	ctx, cancel := context.WithTimeout(m.ctx, m.cfg.Timeout)
	start := time.Now()
	err := m.cfg.Dial(ctx, addr)
	rtt := int(time.Since(start) / time.Millisecond)
	cancel()
	m.record(n, rtt, err)
}

func (n *node) addr() string {
	host := n.t.IP
	if host == "" {
		host = n.t.Host
	}
	return net.JoinHostPort(host, strconv.Itoa(n.t.Port))
}

// record applies one probe result and reports a state transition.
func (m *Monitor) record(n *node, rtt int, err error) {
	m.mu.Lock()
	n.inFlight = false
	if m.ctx.Err() != nil { // stopped: a cancelled dial is not a node failure
		m.mu.Unlock()
		return
	}
	from := n.state
	if err == nil {
		n.last, n.fails = rtt, 0
		n.ring = append(n.ring, rtt)
		if len(n.ring) > ringSize {
			n.ring = n.ring[len(n.ring)-ringSize:]
		}
		n.state = StateUp
	} else {
		n.last = -1
		n.fails++
		if n.fails >= m.cfg.FailThreshold {
			n.state = StateDown
			n.downAt = m.cfg.Now() // (re)start the backoff window
		}
	}
	changed := from != n.state && (from == StateDown || n.state == StateDown)
	st := n.stats()
	host, port := n.t.Host, n.t.Port
	m.mu.Unlock()
	if !changed {
		return
	}
	if n.state == StateUp && m.cfg.Reresolve != nil {
		if ip := m.cfg.Reresolve(host, port); ip != "" {
			m.mu.Lock()
			n.t.IP = ip
			m.mu.Unlock()
		}
	}
	if m.cfg.OnChange != nil {
		m.cfg.OnChange(Change{Stats: st, From: from})
	}
}

func (n *node) stats() Stats {
	return Stats{Key: n.t.Key, Name: n.t.Name, Addr: n.addr(), State: n.state, LastRttMs: n.last, P50Ms: p50(n.ring), Fails: n.fails, Samples: len(n.ring)}
}

// Snapshot returns every node's stats (diag).
func (m *Monitor) Snapshot() []Stats {
	if m == nil {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Stats, 0, len(m.nodes))
	for _, n := range m.nodes {
		out = append(out, n.stats())
	}
	return out
}

// p50 is the median of the samples (-1 when empty).
func p50(ring []int) int {
	if len(ring) == 0 {
		return -1
	}
	s := append([]int(nil), ring...)
	sort.Ints(s)
	return s[len(s)/2]
}
