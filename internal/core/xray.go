package core

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"proxysplit/internal/nodes"
	"proxysplit/internal/xray"
)

// Xray dual core: nodes sing-box cannot carry (nodes.Node.NeedsXray) are served
// by an Xray sidecar on a loopback SOCKS port; in the sing-box config such a
// node's outbound is {"type":"socks","server":"127.0.0.1","server_port":port,
// "username":…,"password":…} under the node's own tag. Every other node is
// generated exactly as before.

var (
	xrayFetchMu sync.Mutex
	xrayFetch   func() error
	xraySetup   chan struct{} // open while the app installs the bundled xray.exe
)

// xraySetupTimeout caps how long a start waits for the bundled install.
const xraySetupTimeout = 60 * time.Second

// SetXrayFetcher registers the lazy downloader used when a node needs Xray but
// xray.exe is missing (wired by the service to coreupdate.EnsureXray).
func SetXrayFetcher(fn func() error) {
	xrayFetchMu.Lock()
	xrayFetch = fn
	xrayFetchMu.Unlock()
}

func currentXrayFetcher() func() error {
	xrayFetchMu.Lock()
	defer xrayFetchMu.Unlock()
	return xrayFetch
}

// BeginXraySetup marks the bundled-Xray install as in progress (it runs in a
// goroutine, off the UI path); sidecar starts wait until finish is called.
// finish is idempotent.
func BeginXraySetup() (finish func()) {
	ch := make(chan struct{})
	xrayFetchMu.Lock()
	xraySetup = ch
	xrayFetchMu.Unlock()
	var once sync.Once
	return func() { once.Do(func() { close(ch) }) }
}

func waitXraySetup() {
	xrayFetchMu.Lock()
	ch := xraySetup
	xrayFetchMu.Unlock()
	if ch == nil {
		return
	}
	select {
	case <-ch:
	case <-time.After(xraySetupTimeout):
	}
}

// XrayBinPath is where xray.exe lives: next to sing-box.exe.
func XrayBinPath(singBoxPath string) string {
	return filepath.Join(filepath.Dir(singBoxPath), xray.ExeName)
}

// newSidecar creates a sidecar for xray.exe next to singBoxPath, using dir.
func newSidecar(singBoxPath, dir string, onLog LogFunc) *xray.Sidecar {
	sc := xray.NewSidecar(XrayBinPath(singBoxPath), dir, onLog)
	sc.WaitReady = waitXraySetup
	sc.Fetch = func() error { // looked up late: the service wires it after NewManager
		fetch := currentXrayFetcher()
		if fetch == nil {
			return errors.New("没有可用的下载源")
		}
		return fetch()
	}
	return sc
}

// probeDirPrefix is the name pattern of StartProbe's temp dirs.
const probeDirPrefix = "node-probe-"

// CleanProbeStrays kills Xray sidecars of latency probes orphaned by a crash
// and removes their leftover temp dirs (only our own node-probe-* dirs under
// probeBase). Call once at startup, before any probe runs.
func CleanProbeStrays(binPath, probeBase string) {
	xray.KillStrays(XrayBinPath(binPath), filepath.Join(probeBase, probeDirPrefix))
	dirs, _ := filepath.Glob(filepath.Join(probeBase, probeDirPrefix+"*"))
	for _, d := range dirs {
		if fi, err := os.Stat(d); err == nil && fi.IsDir() {
			_ = os.RemoveAll(d)
		}
	}
}

// deadXrayPort is where an extra (non-primary) Xray node points when the
// sidecar is unavailable: connections fail fast, the rest of the config works.
const deadXrayPort = 1

// viaSidecar returns the node sing-box should dial: n itself, or for an
// Xray-only node a local SOCKS node pointing at its sidecar inbound (with the
// sidecar's per-launch credentials). strict (the primary node) turns a
// missing sidecar into an error.
func viaSidecar(n *nodes.Node, eps map[string]xray.Endpoint, strict bool) (*nodes.Node, error) {
	if !n.NeedsXray() {
		return n, nil
	}
	ep := eps[xray.Key(n)]
	if ep.Port == 0 {
		if strict {
			return nil, fmt.Errorf("节点「%s」%w，但 Xray 内核没有就绪", n.Name, xray.ErrMissing)
		}
		ep = xray.Endpoint{Port: deadXrayPort}
	}
	c := *n
	c.Type, c.Server, c.Port = "socks", "127.0.0.1", ep.Port
	c.Username, c.Password = ep.User, ep.Pass
	c.Outbounds, c.Multiplex = nil, nil
	return &c, nil
}

// buildNodeOutbounds is buildOutbounds behind the sidecar substitution.
func buildNodeOutbounds(n *nodes.Node, tag string, opts Options, strict bool) ([]M, error) {
	sn, err := viaSidecar(n, opts.XrayPorts, strict)
	if err != nil {
		return nil, err
	}
	return buildOutbounds(sn, tag, opts.RealityHybrid)
}

// xrayRules keeps the sidecar's own (already-proxied) traffic out of the TUN.
// They must come BEFORE hijack-dns: Xray resolves its node servers itself
// (UDP to the China resolvers in its "dns" block) and that query must leave
// directly — hijacked into dns-remote it would go through the proxy, i.e.
// through Xray itself, and never resolve.
func xrayRules(opts Options) []M {
	if opts.XrayPath == "" {
		return nil
	}
	return []M{{"process_path": []string{opts.XrayPath}, "outbound": "direct"}}
}

// xrayDNSRules: any Xray lookup that still reaches sing-box's DNS (e.g. via
// the OS resolver) is answered by the direct China resolver, never through
// the proxy.
func xrayDNSRules(opts Options) []M {
	if opts.XrayPath == "" {
		return nil
	}
	return []M{{"process_path": []string{opts.XrayPath}, "server": "dns-direct"}}
}

// withSidecar starts / reuses the manager's sidecar for the Xray-only nodes
// among primary + opts.ExtraNodes and fills opts.XrayPorts / XrayPath. A
// failure is fatal only when a primary node needs Xray; otherwise it is
// logged and those extra nodes fail on their own.
func (m *Manager) withSidecar(primary []*nodes.Node, opts Options) (Options, error) {
	all := append([]*nodes.Node(nil), primary...)
	for _, en := range opts.ExtraNodes {
		if en.Node != nil {
			all = append(all, en.Node)
		}
	}
	ports, err := m.xray.Ensure(all)
	if err != nil {
		for _, n := range primary {
			if n.NeedsXray() {
				return opts, fmt.Errorf("节点「%s」：%w", n.Name, err)
			}
		}
		m.onLog("[xray] " + err.Error())
	}
	return m.xrayOpts(opts, ports), nil
}

// xrayOpts sets the sidecar fields from the given endpoints.
func (m *Manager) xrayOpts(opts Options, ports map[string]xray.Endpoint) Options {
	opts.XrayPorts = ports
	if len(ports) == 0 {
		opts.XrayPorts = nil
	}
	if _, err := os.Stat(m.xray.BinPath()); err == nil {
		opts.XrayPath = filepath.Clean(m.xray.BinPath())
	}
	return opts
}

// xrayDead runs when the main sidecar crashed and its one automatic restart
// failed. If the primary node needs Xray the core is killed (not Stopped), so
// the regular unexpected-exit path runs (onExit → service clears the system
// proxy / capture) instead of leaving a proxy that goes nowhere. Extra nodes
// only: they fail on their own, the core keeps serving everything else.
func (m *Manager) xrayDead() {
	m.mu.Lock()
	cmd, node := m.cmd, m.node
	m.mu.Unlock()
	if cmd == nil || cmd.Process == nil || node == nil || !node.NeedsXray() {
		m.onLog("[xray] Xray 内核不可用，依赖它的附加节点将连不上")
		return
	}
	m.onLog("[xray] Xray 内核重启失败，停止代理以免流量无处可去")
	_ = cmd.Process.Kill()
}

// isXrayErr reports whether err comes from a missing / failed sidecar.
func isXrayErr(err error) bool { return errors.Is(err, xray.ErrMissing) }
