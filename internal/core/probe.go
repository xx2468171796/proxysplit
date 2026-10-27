package core

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"proxysplit/internal/nodes"
	"proxysplit/internal/xray"
)

// Probe is an isolated, short-lived sing-box process used to test one node.
// Unlike Manager.Stop, Close only terminates this exact process, so a latency
// test can never stop the user's main proxy core.
type Probe struct {
	cmd  *exec.Cmd
	dir  string
	addr string
	xray *xray.Sidecar // Xray-only node: its sidecar (nil otherwise)
	once sync.Once
}

// StartProbe starts a temporary loopback SOCKS/mixed inbound routed through
// node. This exercises the complete proxy protocol (including authentication,
// WebSocket, Reality and UDP-based node setup) instead of merely checking
// whether the remote TCP port accepts connections.
func StartProbe(binPath, tempBase string, node *nodes.Node, startupTimeout time.Duration) (*Probe, error) {
	if node == nil {
		return nil, fmt.Errorf("probe node is nil")
	}
	if startupTimeout <= 0 {
		startupTimeout = 4 * time.Second
	}
	if _, err := os.Stat(binPath); err != nil {
		return nil, fmt.Errorf("sing-box binary not found at %s: %w", binPath, err)
	}
	if err := os.MkdirAll(tempBase, 0o755); err != nil {
		return nil, err
	}

	port, err := freePort()
	if err != nil {
		return nil, err
	}
	dir, err := os.MkdirTemp(tempBase, probeDirPrefix+"*")
	if err != nil {
		return nil, err
	}
	opts := Options{RouteMode: RouteGlobal}
	var sc *xray.Sidecar
	if node.UseXray() {
		// Xray-only node: its own short-lived sidecar inside the probe dir.
		sc = newSidecar(binPath, filepath.Join(dir, "xray"), nil)
		ports, err := sc.Ensure([]*nodes.Node{node})
		if err != nil {
			_ = os.RemoveAll(dir)
			return nil, err
		}
		opts.XrayPorts = ports
	}
	cleanup := func() {
		if sc != nil {
			sc.Stop()
		}
		_ = os.RemoveAll(dir)
	}

	cfg, err := BuildConfig(node, port, "error", opts)
	if err != nil {
		cleanup()
		return nil, err
	}
	cfgPath := filepath.Join(dir, "sing-box.json")
	if err := os.WriteFile(cfgPath, cfg, 0o600); err != nil {
		cleanup()
		return nil, err
	}

	cmd := exec.Command(binPath, "run", "-c", cfgPath)
	cmd.Dir = dir
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	hideWindow(cmd)
	if err := cmd.Start(); err != nil {
		cleanup()
		return nil, fmt.Errorf("start probe core: %w", err)
	}

	p := &Probe{cmd: cmd, dir: dir, addr: fmt.Sprintf("127.0.0.1:%d", port), xray: sc}
	if err := waitPort(port, startupTimeout); err != nil {
		_ = p.Close()
		return nil, fmt.Errorf("probe core did not open port %d: %w", port, err)
	}
	return p, nil
}

// Addr returns the loopback mixed/SOCKS address exposed by this probe.
func (p *Probe) Addr() string {
	if p == nil {
		return ""
	}
	return p.addr
}

// Close stops only the temporary process represented by p and removes its
// generated configuration.
func (p *Probe) Close() error {
	if p == nil {
		return nil
	}
	var closeErr error
	p.once.Do(func() {
		if p.cmd != nil && p.cmd.Process != nil {
			if err := p.cmd.Process.Kill(); err != nil && !isProcessDone(err) {
				closeErr = err
			}
			_ = p.cmd.Wait()
		}
		if p.xray != nil {
			p.xray.Stop()
		}
		if err := os.RemoveAll(p.dir); closeErr == nil && err != nil {
			closeErr = err
		}
	})
	return closeErr
}

func isProcessDone(err error) bool {
	return err == nil || errors.Is(err, os.ErrProcessDone)
}
