// Package noderesolve resolves a node's server domain through many resolvers
// at once (the carrier / system DNS, AliDNS, DNSPod, 114, Baidu, plus DoH),
// drops bogus answers, TCP-probes the candidates and picks the fastest IP.
// A single public resolver can be flaky, hijacked or hand out a CDN address
// that is poor for the user's carrier; voting across all of them and probing
// is what makes domain nodes connect reliably. See docs/memory/routing.md.
package noderesolve

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"sync"
	"time"

	"golang.org/x/net/dns/dnsmessage"
)

// Answer is one resolver's outcome.
type Answer struct {
	Name    string   `json:"name"`
	OK      bool     `json:"ok"`
	Ms      int      `json:"ms"`
	IPs     []string `json:"ips,omitempty"`
	ErrCode string   `json:"errorCode,omitempty"`
}

// Result of resolving one host:port.
type Result struct {
	Host      string   `json:"host"`
	Port      int      `json:"port"`
	IPs       []string `json:"ips"`  // ranked best first
	Best      string   `json:"best"` // = IPs[0]
	BestMs    int      `json:"bestMs"`
	Resolvers []Answer `json:"resolvers"`
	ProbeMs   int      `json:"probeMs"`
	// Fallback: no candidate answered the TCP probe (or probing was off), so
	// the order is by vote count only.
	Fallback bool `json:"fallback"`
	Cached   bool `json:"-"`
}

// Config tunes a Resolver; zero values take the defaults.
type Config struct {
	Servers       func() []Server     // default: DefaultServers()
	QueryTimeout  time.Duration       // per resolver, default 1.5 s
	Overall       time.Duration       // whole resolve + probe, default 2.5 s
	ProbeTimeout  time.Duration       // per TCP probe, default 1 s
	MaxCandidates int                 // default 8
	WantIPv6      func() bool         // default: never ask AAAA
	Dialer        func() *net.Dialer  // default: DirectDialer()
	HTTPClient    func() *http.Client // default: direct DoH client
	DoHOnly       func() bool         // e.g. TUN up without interface binding
	OnResult      func(Result, error) // telemetry hook (fresh results only)
	Now           func() time.Time    // tests
	TTL, FailTTL  time.Duration       // cache: default 10 min / 30 s
	probe         func(ctx context.Context, d *net.Dialer, addr string) error
}

// Resolver resolves node hosts with a cache and single-flight.
type Resolver struct {
	cfg   Config
	mu    sync.Mutex
	cache map[string]cacheEntry
	calls map[string]*call
}

type cacheEntry struct {
	res Result
	err error
	exp time.Time
}

type call struct {
	done chan struct{}
	res  Result
	err  error
}

// lateGrace: how long slower resolvers may still add votes after the first
// answer.
const lateGrace = 400 * time.Millisecond

// ErrNoAddress: nothing resolved; callers keep the domain unchanged.
var ErrNoAddress = errors.New("节点域名没有解析到可用 IP")

// errBogusOnly: the resolver answered only bogus addresses.
var errBogusOnly = errors.New("only bogus addresses")

// New returns a resolver with defaults filled in.
func New(cfg Config) *Resolver {
	if cfg.Servers == nil {
		cfg.Servers = DefaultServers
	}
	if cfg.QueryTimeout <= 0 {
		cfg.QueryTimeout = 1500 * time.Millisecond
	}
	if cfg.Overall <= 0 {
		cfg.Overall = 2500 * time.Millisecond
	}
	if cfg.ProbeTimeout <= 0 {
		cfg.ProbeTimeout = time.Second
	}
	if cfg.MaxCandidates <= 0 {
		cfg.MaxCandidates = 8
	}
	if cfg.Dialer == nil {
		cfg.Dialer = DirectDialer
	}
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = func() *http.Client { return dohClient(cfg.Dialer()) }
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.TTL <= 0 {
		cfg.TTL = 10 * time.Minute
	}
	if cfg.FailTTL <= 0 {
		cfg.FailTTL = 30 * time.Second
	}
	if cfg.probe == nil {
		cfg.probe = tcpProbe
	}
	return &Resolver{cfg: cfg, cache: map[string]cacheEntry{}, calls: map[string]*call{}}
}

// Resolve returns host's ranked addresses. An IP literal comes back as is.
// port <= 0 disables the TCP probe (UDP-only protocols such as hysteria2).
func (r *Resolver) Resolve(ctx context.Context, host string, port int) (Result, error) {
	return r.resolve(ctx, host, port, false)
}

// Refresh is Resolve bypassing the cache (node came back after an outage).
func (r *Resolver) Refresh(ctx context.Context, host string, port int) (Result, error) {
	return r.resolve(ctx, host, port, true)
}

// Invalidate drops cached results of host (any port).
func (r *Resolver) Invalidate(host string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for k, e := range r.cache {
		if e.res.Host == host {
			delete(r.cache, k)
		}
	}
}

func (r *Resolver) resolve(ctx context.Context, host string, port int, fresh bool) (Result, error) {
	if a, err := netip.ParseAddr(host); err == nil {
		s := a.Unmap().String()
		return Result{Host: host, Port: port, IPs: []string{s}, Best: s}, nil
	}
	key := net.JoinHostPort(host, strconv.Itoa(port))
	r.mu.Lock()
	if e, ok := r.cache[key]; ok && !fresh && r.cfg.Now().Before(e.exp) {
		r.mu.Unlock()
		e.res.Cached = true
		return e.res, e.err
	}
	if c, ok := r.calls[key]; ok {
		r.mu.Unlock()
		select {
		case <-c.done:
			return c.res, c.err
		case <-ctx.Done():
			return Result{Host: host, Port: port}, ctx.Err()
		}
	}
	c := &call{done: make(chan struct{})}
	r.calls[key] = c
	r.mu.Unlock()

	// Detached from ctx so a cancelled caller does not poison the shared
	// call; the overall bound still applies.
	c.res, c.err = r.lookup(context.WithoutCancel(ctx), host, port)
	ttl := r.cfg.TTL
	if c.err != nil {
		ttl = r.cfg.FailTTL
	}
	r.mu.Lock()
	r.cache[key] = cacheEntry{res: c.res, err: c.err, exp: r.cfg.Now().Add(ttl)}
	delete(r.calls, key)
	r.mu.Unlock()
	close(c.done)
	if r.cfg.OnResult != nil {
		r.cfg.OnResult(c.res, c.err)
	}
	return c.res, c.err
}

// lookup queries every resolver, unions the answers and probes them.
func (r *Resolver) lookup(ctx context.Context, host string, port int) (Result, error) {
	ctx, cancel := context.WithTimeout(ctx, r.cfg.Overall)
	defer cancel()
	res := Result{Host: host, Port: port}
	res.Resolvers = r.queryAll(ctx, host)
	cands := union(res.Resolvers)
	if len(cands) == 0 {
		return res, ErrNoAddress
	}
	if len(cands) > r.cfg.MaxCandidates {
		cands = cands[:r.cfg.MaxCandidates]
	}
	start := time.Now()
	ranked, bestMs := r.rank(ctx, cands, port)
	res.ProbeMs = int(time.Since(start) / time.Millisecond)
	res.IPs, res.Best, res.BestMs, res.Fallback = ranked, ranked[0], bestMs, bestMs < 0
	return res, nil
}

// queryAll asks every server in parallel; the result keeps server order.
func (r *Resolver) queryAll(ctx context.Context, host string) []Answer {
	servers := r.cfg.Servers()
	if r.cfg.DoHOnly != nil && r.cfg.DoHOnly() {
		kept := servers[:0:0]
		for _, s := range servers {
			if s.Kind == KindDoH {
				kept = append(kept, s)
			}
		}
		servers = kept
	}
	types := []dnsmessage.Type{dnsmessage.TypeA}
	if r.cfg.WantIPv6 != nil && r.cfg.WantIPv6() {
		types = append(types, dnsmessage.TypeAAAA)
	}
	// Once one resolver has answered, the stragglers get lateGrace more and
	// are then cancelled (code "late"): with another TUN's strict_route up,
	// plain UDP to port 53 is silently dropped and would otherwise always
	// cost the full query timeout.
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var graceOnce sync.Once
	out := make([]Answer, len(servers))
	var wg sync.WaitGroup
	d := r.cfg.Dialer()
	hc := r.cfg.HTTPClient()
	for i, s := range servers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			out[i] = r.queryOne(ctx, d, hc, s, host, types)
			if out[i].OK {
				graceOnce.Do(func() { time.AfterFunc(lateGrace, cancel) })
			}
		}()
	}
	wg.Wait()
	return out
}

// queryOne asks one server for every wanted type.
func (r *Resolver) queryOne(ctx context.Context, d *net.Dialer, hc *http.Client, s Server, host string, types []dnsmessage.Type) Answer {
	ctx, cancel := context.WithTimeout(ctx, r.cfg.QueryTimeout)
	defer cancel()
	start := time.Now()
	a := Answer{Name: s.Name}
	var firstErr error
	for _, t := range types {
		q, id, err := buildQuery(host, t)
		if err != nil {
			firstErr = err
			break
		}
		var ips []netip.Addr
		if s.Kind == KindDoH {
			ips, err = exchangeDoH(ctx, hc, s.Addr, q)
		} else {
			ips, err = exchangeUDP(ctx, d, s.Addr, q, id)
		}
		if err == nil {
			if ips = filterBogus(ips); len(ips) == 0 {
				err = errBogusOnly
			}
		}
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		for _, ip := range ips {
			a.IPs = append(a.IPs, ip.String())
		}
	}
	a.Ms = int(time.Since(start) / time.Millisecond)
	a.OK = len(a.IPs) > 0
	if !a.OK {
		a.ErrCode = errorCode(firstErr)
	}
	return a
}
