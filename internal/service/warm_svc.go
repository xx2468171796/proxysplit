package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"proxysplit/internal/core"
	"proxysplit/internal/dnswarm"
	"proxysplit/internal/noderesolve"
	"proxysplit/internal/nodes"
	"proxysplit/internal/nodewarm"
)

// Telemetry event types emitted through the event hook (same strings as
// internal/telemetry's catalog; service does not import telemetry).
const (
	evNodeHealth = "node.health"
	evDNSPrewarm = "dns.prewarm"
)

const (
	prewarmDelay   = 5 * time.Second
	observeEvery   = time.Minute
	saveEvery      = 5 * time.Minute
	dnsWarmFile    = "dnswarm.json"
	dnsCacheFile   = "dns-cache.db"
	prewarmConc    = 4
	prewarmTimeout = 20 * time.Second
)

// eventHook receives service-side telemetry events (wired in the app).
var eventHook atomic.Pointer[func(typ string, err error, payload map[string]any)]

// SetEventHook installs the node.health / dns.prewarm telemetry hook.
func SetEventHook(fn func(typ string, err error, payload map[string]any)) {
	if fn == nil {
		eventHook.Store(nil)
		return
	}
	eventHook.Store(&fn)
}

func emitEvent(typ string, err error, payload map[string]any) {
	if f := eventHook.Load(); f != nil {
		(*f)(typ, err, payload)
	}
}

// warmState is the per-run keep-warm monitor and DNS prewarm loop.
type warmState struct {
	mu   sync.Mutex
	mon  *nodewarm.Monitor
	stop chan struct{}
	done chan struct{}
}

// NodeHealth is the keep-warm snapshot (diag / UI; empty when stopped).
func (s *Service) NodeHealth() []nodewarm.Stats {
	s.warm.mu.Lock()
	m := s.warm.mon
	s.warm.mu.Unlock()
	return m.Snapshot()
}

// startWarm begins keep-warm probes for the nodes of this run and the DNS
// prewarm / observation loop. Replaces any previous run's.
func (s *Service) startWarm(node *nodes.Node, opts core.Options, clashPort int, clashSecret string) {
	s.stopWarm()
	var targets []nodewarm.Target
	for _, n := range startNodes(node, &opts) {
		if n == nil || n.HasRaw() || n.Server == "" || probePort(n) == 0 {
			continue
		}
		targets = append(targets, nodewarm.Target{Key: n.ID, Name: n.Name, Host: n.Server, IP: opts.ServerIPs[n.Server], Port: n.Port})
	}
	dial := func(ctx context.Context, addr string) error {
		c, err := noderesolve.DirectDialer().DialContext(ctx, "tcp", addr)
		if err != nil {
			return err
		}
		return c.Close()
	}
	mon := nodewarm.New(nodewarm.Config{Dial: dial, OnChange: s.onNodeHealth, Reresolve: s.reresolve}, targets)
	stop, done := make(chan struct{}), make(chan struct{})
	s.warm.mu.Lock()
	s.warm.mon, s.warm.stop, s.warm.done = mon, stop, done
	s.warm.mu.Unlock()
	mon.Start()
	go s.dnsWarmLoop(clashPort, clashSecret, aiGuardSkip(opts.AIGuard), stop, done)
}

// stopWarm stops the monitor and the DNS loop (saves the domain list).
func (s *Service) stopWarm() {
	s.warm.mu.Lock()
	mon, stop, done := s.warm.mon, s.warm.stop, s.warm.done
	s.warm.mon, s.warm.stop, s.warm.done = nil, nil, nil
	s.warm.mu.Unlock()
	if stop != nil {
		close(stop)
	}
	if mon != nil {
		mon.Stop()
	}
	if done != nil {
		<-done
	}
}

// onNodeHealth logs and reports a node state change. Observational only:
// routing (AI 劫持 included) is never touched.
func (s *Service) onNodeHealth(c nodewarm.Change) {
	if c.State == nodewarm.StateDown {
		s.log(fmt.Sprintf("[warm] 节点「%s」连续 %d 次连不上（%s），5 分钟后再探测", c.Name, c.Fails, c.Addr))
	} else {
		s.log(fmt.Sprintf("[warm] 节点「%s」恢复连通（%d ms）", c.Name, c.LastRttMs))
	}
	emitEvent(evNodeHealth, nil, map[string]any{"from": c.From, "to": c.State, "rtt_p50": c.P50Ms, "fails": c.Fails})
}

// reresolve refreshes a recovered node's address (cache bypassed).
func (s *Service) reresolve(host string, port int) string {
	ctx, cancel := context.WithTimeout(context.Background(), resolveBound)
	defer cancel()
	res, err := s.nodeResolver().Refresh(ctx, host, port)
	if err != nil {
		return ""
	}
	return res.Best
}

// aiGuardSkip matches the AI guard's names: never prewarmed, never recorded.
func aiGuardSkip(g *core.AIGuard) func(string) bool {
	if g == nil {
		return func(string) bool { return false }
	}
	exact := map[string]bool{}
	for _, d := range g.Domains {
		exact[strings.ToLower(d)] = true
	}
	suffixes := append([]string(nil), g.DomainSuffixes...)
	return func(host string) bool {
		host = strings.ToLower(strings.TrimSuffix(host, "."))
		if exact[host] {
			return true
		}
		for _, sfx := range suffixes {
			sfx = strings.ToLower(strings.TrimPrefix(sfx, "."))
			if host == sfx || strings.HasSuffix(host, "."+sfx) {
				return true
			}
		}
		return false
	}
}

// dnsWarmLoop: prewarm 5 s after start, then record proxied domains from the
// clash connection list every minute; the list is saved periodically and on stop.
func (s *Service) dnsWarmLoop(port int, secret string, skip func(string) bool, stop, done chan struct{}) {
	defer close(done)
	store := dnswarm.Load(filepath.Join(s.dataDir, dnsWarmFile), time.Now())
	liveWarm.Store(store)
	defer liveWarm.CompareAndSwap(store, nil)
	defer func() { _ = store.Save() }()
	select {
	case <-stop:
		return
	case <-time.After(prewarmDelay):
	}
	if port > 0 {
		ctx, cancel := context.WithTimeout(context.Background(), prewarmTimeout)
		go func() {
			select {
			case <-stop:
				cancel()
			case <-ctx.Done():
			}
		}()
		sum := dnswarm.Prewarm(ctx, store.Top(dnswarm.MaxDomains), prewarmConc, skip, func(ctx context.Context, d string) error {
			return clashDNSQuery(ctx, port, secret, d)
		})
		cancel()
		if sum.Count > 0 {
			s.log(fmt.Sprintf("[warm] DNS 预热：%d 个常用域名，%d 个成功，用时 %d ms", sum.Count, sum.OK, sum.Ms))
			emitEvent(evDNSPrewarm, nil, map[string]any{"count": sum.Count, "ok": sum.OK, "ms": sum.Ms})
		}
	}
	obs, save := time.NewTicker(observeEvery), time.NewTicker(saveEvery)
	defer obs.Stop()
	defer save.Stop()
	for {
		select {
		case <-stop:
			return
		case <-obs.C:
			store.Observe(proxiedHosts(port, secret, skip), time.Now())
		case <-save.C:
			_ = store.Save()
		}
	}
}

// proxiedHosts lists domains of live connections that left through a node
// (not direct / reject), minus AI-guard names.
func proxiedHosts(port int, secret string, skip func(string) bool) []string {
	conns, err := clashConnections(port, secret)
	if err != nil {
		return nil
	}
	var out []string
	for _, c := range conns {
		switch c.OutTag {
		case "", "direct", "reject", "block":
			continue
		}
		if dnswarm.Valid(c.Host) && !skip(c.Host) {
			out = append(out, c.Host)
		}
	}
	return out
}

// clashDNSQuery resolves name through the running core (Clash API
// GET /dns/query, verified on sing-box 1.14.3): it follows the core's DNS
// rules and fills its cache.
func clashDNSQuery(ctx context.Context, port int, secret, name string) error {
	u := fmt.Sprintf("http://127.0.0.1:%d/dns/query?name=%s&type=A", port, url.QueryEscape(name))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	if secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}
	resp, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var body struct {
		Status int               `json:"Status"`
		Answer []json.RawMessage `json:"Answer"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&body); err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK || body.Status != 0 || len(body.Answer) == 0 {
		return fmt.Errorf("dns query %s: http %d status %d", name, resp.StatusCode, body.Status)
	}
	return nil
}
