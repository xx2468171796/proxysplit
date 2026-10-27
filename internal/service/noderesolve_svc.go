package service

import (
	"context"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"proxysplit/internal/core"
	"proxysplit/internal/noderesolve"
	"proxysplit/internal/nodes"
)

// resolveBound caps the whole pre-resolve step before a core start.
const resolveBound = 2500 * time.Millisecond

// nodeResolveHook receives every fresh resolve outcome (telemetry, wired in
// the app). It must not block.
var nodeResolveHook atomic.Pointer[func(noderesolve.Result, error)]

// SetNodeResolveHook installs the node.resolve telemetry hook (nil removes).
func SetNodeResolveHook(fn func(noderesolve.Result, error)) {
	if fn == nil {
		nodeResolveHook.Store(nil)
		return
	}
	nodeResolveHook.Store(&fn)
}

var (
	resolverOnce sync.Once
	resolverInst *noderesolve.Resolver
)

// nodeResolver is the process-wide resolver (shared cache for core starts,
// proxy ports and latency tests). While the core runs it only uses DoH:
// sing-box's strict_route blocks port 53 outside the TUN.
func (s *Service) nodeResolver() *noderesolve.Resolver {
	resolverOnce.Do(func() {
		resolverInst = noderesolve.New(noderesolve.Config{
			WantIPv6: s.hostIPv6, // stopped-time answer: the TUN always carries IPv6
			DoHOnly:  func() bool { return s.core != nil && s.core.Running() },
			OnResult: func(r noderesolve.Result, err error) {
				s.log("[resolve] " + noderesolve.Summary(r, err))
				if f := nodeResolveHook.Load(); f != nil {
					(*f)(r, err)
				}
			},
		})
	})
	return resolverInst
}

// probePort is the TCP port to probe for n; 0 for UDP-only transports.
func probePort(n *nodes.Node) int {
	switch strings.ToLower(n.Type) {
	case "hysteria2", "hysteria", "tuic":
		return 0
	}
	if n.XrayNetwork() == nodes.NetKCP {
		return 0
	}
	return n.Port
}

// needsResolve: a domain-addressed node whose outbound PinNode can rewrite.
func needsResolve(n *nodes.Node) bool {
	if n == nil || n.HasRaw() || n.Server == "" || isPlaceholderEndpoint(n.Server) {
		return false
	}
	return net.ParseIP(n.Server) == nil
}

// serverIPs resolves the given nodes in parallel (bounded by resolveBound)
// and returns domain → chosen IP; failures are left out (domain unchanged).
func (s *Service) serverIPs(list []*nodes.Node) map[string]string {
	ctx, cancel := context.WithTimeout(context.Background(), resolveBound)
	defer cancel()
	type job struct {
		host string
		port int
	}
	seen := map[string]bool{}
	var jobs []job
	for _, n := range list {
		if !needsResolve(n) || seen[n.Server] {
			continue
		}
		seen[n.Server] = true
		jobs = append(jobs, job{n.Server, probePort(n)})
	}
	if len(jobs) == 0 {
		return nil
	}
	r := s.nodeResolver()
	var mu sync.Mutex
	out := map[string]string{}
	var wg sync.WaitGroup
	for _, j := range jobs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			res, err := r.Resolve(ctx, j.host, j.port)
			if err != nil || res.Best == "" {
				return
			}
			mu.Lock()
			out[j.host] = res.Best
			mu.Unlock()
		}()
	}
	wg.Wait()
	if len(out) == 0 {
		return nil
	}
	return out
}

// pinned returns n dialing its pre-resolved IP (latency / speed tests and
// proxy ports use the same address the core will use).
func (s *Service) pinned(n *nodes.Node) *nodes.Node {
	return core.PinNode(n, s.serverIPs([]*nodes.Node{n}))
}

// startNodes lists the primary node and every extra node of opts.
func startNodes(node *nodes.Node, opts *core.Options) []*nodes.Node {
	list := []*nodes.Node{node}
	for _, en := range opts.ExtraNodes {
		list = append(list, en.Node)
	}
	return list
}
