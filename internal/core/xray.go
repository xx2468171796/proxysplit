package core

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"proxysplit/internal/nodes"
	"proxysplit/internal/xray"
)

// Xray dual core: nodes sing-box cannot carry (nodes.Node.NeedsXray) are served
// by an Xray sidecar on a loopback SOCKS port; in the sing-box config such a
// node's outbound is {"type":"socks","server":"127.0.0.1","server_port":port}
// under the node's own tag. Every other node is generated exactly as before.

var (
	xrayFetchMu sync.Mutex
	xrayFetch   func() error
)

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

// XrayBinPath is where xray.exe lives: next to sing-box.exe.
func XrayBinPath(singBoxPath string) string {
	return filepath.Join(filepath.Dir(singBoxPath), xray.ExeName)
}

// newSidecar creates a sidecar for xray.exe next to singBoxPath, using dir.
func newSidecar(singBoxPath, dir string, onLog LogFunc) *xray.Sidecar {
	sc := xray.NewSidecar(XrayBinPath(singBoxPath), dir, onLog)
	sc.Fetch = func() error { // looked up late: the service wires it after NewManager
		fetch := currentXrayFetcher()
		if fetch == nil {
			return errors.New("没有可用的下载源")
		}
		return fetch()
	}
	return sc
}

// deadXrayPort is where an extra (non-primary) Xray node points when the
// sidecar is unavailable: connections fail fast, the rest of the config works.
const deadXrayPort = 1

// viaSidecar returns the node sing-box should dial: n itself, or for an
// Xray-only node a local SOCKS node pointing at its sidecar inbound. strict
// (the primary node) turns a missing sidecar into an error.
func viaSidecar(n *nodes.Node, ports map[string]int, strict bool) (*nodes.Node, error) {
	if !n.NeedsXray() {
		return n, nil
	}
	port := ports[xray.Key(n)]
	if port == 0 {
		if strict {
			return nil, fmt.Errorf("节点「%s」%w，但 Xray 内核没有就绪", n.Name, xray.ErrMissing)
		}
		port = deadXrayPort
	}
	c := *n
	c.Type, c.Server, c.Port = "socks", "127.0.0.1", port
	c.Username, c.Password = "", ""
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
func xrayRules(opts Options) []M {
	if opts.XrayPath == "" {
		return nil
	}
	return []M{{"process_path": []string{opts.XrayPath}, "outbound": "direct"}}
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

// xrayOpts sets the sidecar fields from the given ports.
func (m *Manager) xrayOpts(opts Options, ports map[string]int) Options {
	opts.XrayPorts = ports
	if len(ports) == 0 {
		opts.XrayPorts = nil
	}
	if _, err := os.Stat(m.xray.BinPath()); err == nil {
		opts.XrayPath = filepath.Clean(m.xray.BinPath())
	}
	return opts
}

// isXrayErr reports whether err comes from a missing / failed sidecar.
func isXrayErr(err error) bool { return errors.Is(err, xray.ErrMissing) }
