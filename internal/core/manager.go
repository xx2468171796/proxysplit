package core

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"proxysplit/internal/nodes"
)

// LogFunc receives a single line of core output.
type LogFunc func(line string)

// Manager owns the lifecycle of the bundled sing-box process.
type Manager struct {
	binPath string
	dataDir string
	onLog   LogFunc
	onExit  func() // invoked (unlocked) whenever the process exits, if set

	mu      sync.Mutex
	cmd     *exec.Cmd
	running bool
	port    int
	node    *nodes.Node
}

// SetOnExit registers a callback fired after the core process exits for any
// reason (clean stop or crash). Set once before the first Start; never called
// while holding the Manager lock.
func (m *Manager) SetOnExit(fn func()) { m.onExit = fn }

// NewManager creates a Manager. binPath is the path to sing-box.exe; dataDir is
// a writable directory for the generated config. onLog may be nil.
func NewManager(binPath, dataDir string, onLog LogFunc) *Manager {
	if onLog == nil {
		onLog = func(string) {}
	}
	return &Manager{binPath: binPath, dataDir: dataDir, onLog: onLog}
}

// Running reports whether the core process is currently up.
func (m *Manager) Running() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.running
}

// Port returns the local mixed-inbound port of the running core (0 if stopped).
func (m *Manager) Port() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.port
}

// Version returns the bundled sing-box version (e.g. "1.13.14"), best effort.
func (m *Manager) Version() string {
	out, err := exec.Command(m.binPath, "version").Output()
	if err != nil {
		return ""
	}
	line := strings.SplitN(strings.TrimSpace(string(out)), "\n", 2)[0]
	if f := strings.Fields(line); len(f) >= 3 {
		return f[2] // "sing-box version X" -> X
	}
	return strings.TrimSpace(line)
}

// PID returns the process id of the running core (0 if stopped).
func (m *Manager) PID() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cmd == nil || m.cmd.Process == nil {
		return 0
	}
	return m.cmd.Process.Pid
}

// Node returns the node the core is currently configured with.
func (m *Manager) Node() *nodes.Node {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.node
}

// Check validates a generated config using `sing-box check` without starting it.
func (m *Manager) Check(node *nodes.Node, opts Options) error {
	cfg, err := BuildConfig(node, 17890, "info", opts)
	if err != nil {
		return err
	}
	path := filepath.Join(m.dataDir, "check.json")
	if err := os.WriteFile(path, cfg, 0o600); err != nil {
		return err
	}
	out, err := exec.Command(m.binPath, "check", "-c", path).CombinedOutput()
	if err != nil {
		return fmt.Errorf("sing-box check failed: %s", string(out))
	}
	return nil
}

// Start generates a config for node, launches sing-box on the given inbound port
// and waits until the port accepts connections. A port of 0 picks a free one.
func (m *Manager) Start(node *nodes.Node, inboundPort int, logLevel string, opts Options) (int, error) {
	m.mu.Lock()
	if m.running {
		m.mu.Unlock()
		return 0, fmt.Errorf("core already running")
	}
	m.mu.Unlock()

	if inboundPort == 0 {
		p, err := freePort()
		if err != nil {
			return 0, err
		}
		inboundPort = p
	}
	line := LineConfig{Key: "proxy", InboundPort: inboundPort, Node: node, RouteMode: opts.RouteMode, RouteRules: opts.RouteRules}
	if err := m.StartLines([]LineConfig{line}, logLevel, opts); err != nil {
		return 0, err
	}
	return inboundPort, nil
}

// StartLines launches sing-box with one inbound per line (multi-node routing).
// It waits until the first line's inbound accepts connections.
func (m *Manager) StartLines(lines []LineConfig, logLevel string, opts Options) error {
	m.mu.Lock()
	if m.running {
		m.mu.Unlock()
		return fmt.Errorf("core already running")
	}
	m.mu.Unlock()
	if _, err := os.Stat(m.binPath); err != nil {
		return fmt.Errorf("sing-box binary not found at %s", m.binPath)
	}
	if len(lines) == 0 {
		return fmt.Errorf("no lines")
	}

	cfg, err := BuildMultiConfig(lines, logLevel, opts)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(m.dataDir, 0o755); err != nil {
		return err
	}
	cfgPath := filepath.Join(m.dataDir, "sing-box.json")
	if err := os.WriteFile(cfgPath, cfg, 0o600); err != nil {
		return err
	}

	cmd := exec.Command(m.binPath, "run", "-c", cfgPath)
	cmd.Dir = m.dataDir
	hideWindow(cmd)
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start sing-box: %w", err)
	}
	go m.pump(stdout)
	go m.pump(stderr)

	primary := lines[0].InboundPort
	m.mu.Lock()
	m.cmd = cmd
	m.running = true
	m.port = primary
	m.node = lines[0].Node
	m.mu.Unlock()

	go func() {
		_ = cmd.Wait()
		m.mu.Lock()
		m.running = false
		m.port = 0
		m.mu.Unlock()
		m.onLog("[core] sing-box exited")
		if m.onExit != nil {
			m.onExit()
		}
	}()

	if err := waitPort(primary, 5*time.Second); err != nil {
		_ = m.Stop()
		return fmt.Errorf("core did not open port %d: %w", primary, err)
	}
	m.onLog(fmt.Sprintf("[core] sing-box up (%d line(s), primary 127.0.0.1:%d)", len(lines), primary))
	return nil
}

// StartTUN launches sing-box in system-wide TUN mode (wintun) routing all
// traffic out through the node. There is no local inbound port (Port()==0);
// utility fetches should go direct, which auto-routes through the tunnel.
func (m *Manager) StartTUN(node *nodes.Node, logLevel, routeMode string, routeRules []RouteRule, opts Options) error {
	m.mu.Lock()
	if m.running {
		m.mu.Unlock()
		return fmt.Errorf("core already running")
	}
	m.mu.Unlock()
	if _, err := os.Stat(m.binPath); err != nil {
		return fmt.Errorf("sing-box binary not found at %s", m.binPath)
	}

	opts.RouteMode = routeMode
	opts.RouteRules = routeRules
	cfg, err := BuildTUNConfig(node, logLevel, opts)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(m.dataDir, 0o755); err != nil {
		return err
	}
	cfgPath := filepath.Join(m.dataDir, "sing-box.json")
	if err := os.WriteFile(cfgPath, cfg, 0o600); err != nil {
		return err
	}

	cmd := exec.Command(m.binPath, "run", "-c", cfgPath)
	cmd.Dir = m.dataDir
	hideWindow(cmd)
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start sing-box: %w", err)
	}
	go m.pump(stdout)
	go m.pump(stderr)

	m.mu.Lock()
	m.cmd = cmd
	m.running = true
	m.port = 0 // TUN has no local SOCKS port
	m.node = node
	m.mu.Unlock()

	go func() {
		_ = cmd.Wait()
		m.mu.Lock()
		m.running = false
		m.port = 0
		m.mu.Unlock()
		m.onLog("[core] sing-box exited")
		if m.onExit != nil {
			m.onExit()
		}
	}()

	// TUN has no port to probe; a config/wintun failure makes the process exit
	// quickly, so a short wait + liveness check is the readiness signal.
	time.Sleep(2500 * time.Millisecond)
	if !m.Running() {
		return fmt.Errorf("core exited on start (TUN/wintun error — check the log)")
	}
	m.onLog(fmt.Sprintf("[core] sing-box TUN up (%s) via %s", routeMode, node.Name))
	return nil
}

// Stop terminates the core process if running.
func (m *Manager) Stop() error {
	m.mu.Lock()
	cmd := m.cmd
	m.cmd = nil
	m.running = false
	m.port = 0
	m.mu.Unlock()
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	return cmd.Process.Kill()
}

func (m *Manager) pump(r interface{ Read([]byte) (int, error) }) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		m.onLog(sc.Text())
	}
}

// FreePort returns an unused loopback TCP port.
func FreePort() (int, error) { return freePort() }

// FreePorts returns n DISTINCT unused loopback ports. It keeps every probe
// listener open until all ports are chosen, so the OS cannot hand the same
// just-freed ephemeral port to two callers.
func FreePorts(n int) ([]int, error) {
	var ls []net.Listener
	defer func() {
		for _, l := range ls {
			l.Close()
		}
	}()
	ports := make([]int, 0, n)
	for i := 0; i < n; i++ {
		l, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return nil, err
		}
		ls = append(ls, l)
		ports = append(ports, l.Addr().(*net.TCPAddr).Port)
	}
	return ports, nil
}

// --- helpers ---

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

func waitPort(port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	for time.Now().Before(deadline) {
		c, err := net.DialTimeout("tcp", addr, 300*time.Millisecond)
		if err == nil {
			c.Close()
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return context.DeadlineExceeded
}
