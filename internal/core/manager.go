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
	"proxysplit/internal/procjob"
	"proxysplit/internal/xray"
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
	done    chan struct{} // closed when the current cmd exits (for Stop to await)
	tunCfg  []byte        // config the running TUN core was started with (for hot updates)
	xray    *xray.Sidecar // Xray-only nodes (xray.go); started before and stopped after sing-box
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
	m := &Manager{binPath: binPath, dataDir: dataDir, onLog: onLog, xray: newSidecar(binPath, filepath.Join(dataDir, "xray"), onLog)}
	m.xray.AutoRestart, m.xray.OnDead = true, m.xrayDead // sidecar crash: restart once, then xrayDead
	return m
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
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, m.binPath, "version")
	hideWindow(cmd)
	out, err := cmd.Output()
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
	if node.UseXray() { // sing-box only sees the sidecar's SOCKS outbound
		opts.XrayPorts = map[string]xray.Endpoint{xray.Key(node): {Port: deadXrayPort}}
	}
	cfg, err := BuildConfig(node, 17890, "info", opts)
	if err != nil {
		return err
	}
	path := filepath.Join(m.dataDir, "check.json")
	if err := os.WriteFile(path, cfg, 0o600); err != nil {
		return err
	}
	check := exec.Command(m.binPath, "check", "-c", path)
	hideWindow(check)
	out, err := check.CombinedOutput()
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

	cfgPath, err := m.writeLinesConfig(lines, logLevel, opts)
	if err != nil {
		return err
	}
	cmd, err := m.launchSingBox(cfgPath)
	if err != nil {
		return err
	}

	primary := lines[0].InboundPort
	done := make(chan struct{})
	m.mu.Lock()
	m.cmd = cmd
	m.running = true
	m.port = primary
	m.node = lines[0].Node
	m.done = done
	m.mu.Unlock()
	go m.watchLinesExit(cmd, done)

	if err := waitPort(primary, 5*time.Second); err != nil {
		_ = m.Stop()
		return fmt.Errorf("core did not open port %d: %w", primary, err)
	}
	m.onLog(fmt.Sprintf("[core] sing-box up (%d line(s), primary 127.0.0.1:%d)", len(lines), primary))
	return nil
}

// writeLinesConfig starts any sidecar the lines need, builds the multi-line
// config and writes it to the data dir, returning its path.
func (m *Manager) writeLinesConfig(lines []LineConfig, logLevel string, opts Options) (string, error) {
	lineNodes := make([]*nodes.Node, 0, len(lines))
	for _, ln := range lines {
		lineNodes = append(lineNodes, ln.Node)
	}
	opts, err := m.withSidecar(lineNodes, opts)
	if err != nil {
		return "", err
	}
	cfg, err := BuildMultiConfig(lines, logLevel, opts)
	if err != nil {
		m.xray.Stop()
		return "", err
	}
	if err := os.MkdirAll(m.dataDir, 0o755); err != nil {
		return "", err
	}
	cfgPath := filepath.Join(m.dataDir, "sing-box.json")
	if err := os.WriteFile(cfgPath, cfg, 0o600); err != nil {
		return "", err
	}
	return cfgPath, nil
}

// launchSingBox starts sing-box on cfgPath with its output pumped to the log.
func (m *Manager) launchSingBox(cfgPath string) (*exec.Cmd, error) {
	cmd := exec.Command(m.binPath, "run", "-c", cfgPath)
	cmd.Dir = m.dataDir
	hideWindow(cmd)
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start sing-box: %w", err)
	}
	procjob.Attach(cmd) // dies with us if we crash (Job Object)
	go m.pump(stdout)
	go m.pump(stderr)
	return cmd, nil
}

// watchLinesExit waits for cmd to exit, clears state if it is still the
// active core, and closes done.
func (m *Manager) watchLinesExit(cmd *exec.Cmd, done chan struct{}) {
	{
		_ = cmd.Wait()
		m.mu.Lock()
		active := m.cmd == cmd
		if active {
			m.running = false
			m.tunCfg = nil
			m.port = 0
			m.cmd = nil
		}
		m.mu.Unlock()
		close(done)
		m.onLog("[core] sing-box exited")
		// A killed old process can exit after a replacement core has started.
		// It must not run the service crash handler and clear the new core's
		// system-proxy setting.
		if active && m.onExit != nil {
			m.onExit()
		}
	}
}

// spawn starts sing-box with the given config and wires up the exit watcher.
// It does NOT wait for readiness (the caller does). Safe to call only when the
// core is stopped.
func (m *Manager) spawn(cfgPath string) error {
	cmd, err := m.tunCommand(cfgPath)
	if err != nil {
		return err
	}
	cmd.Dir = m.dataDir
	hideWindow(cmd)
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start sing-box: %w", err)
	}
	procjob.Attach(cmd) // dies with us if we crash (Job Object)
	go m.pump(stdout)
	go m.pump(stderr)

	done := make(chan struct{})
	m.mu.Lock()
	m.cmd = cmd
	m.running = true
	m.port = 0
	m.done = done
	m.mu.Unlock()

	go func() {
		_ = cmd.Wait()
		m.mu.Lock()
		// Only clear state if this is STILL the active process — otherwise a
		// stale exit (from a killed old process) would clobber a fresh start
		// and make it falsely report "启动失败".
		active := m.cmd == cmd
		if active {
			m.running = false
			m.tunCfg = nil
			m.port = 0
			m.cmd = nil
		}
		m.mu.Unlock()
		close(done)
		m.onLog("[core] sing-box exited")
		// Do not let a stale exit clear state belonging to a replacement core.
		if active && m.onExit != nil {
			m.onExit()
		}
	}()
	return nil
}

// Stop terminates the core process and WAITS for it to actually exit, so the
// wintun adapter + routes are fully released before any following Start.
func (m *Manager) Stop() error {
	m.mu.Lock()
	cmd := m.cmd
	done := m.done
	m.cmd = nil
	m.running = false
	m.tunCfg = nil
	m.port = 0
	m.mu.Unlock()
	if cmd == nil || cmd.Process == nil {
		m.xray.Stop()
		return nil
	}
	terminate(cmd)
	if done != nil {
		select {
		case <-done:
		case <-time.After(4 * time.Second):
		}
	}
	m.killStrays()                     // nuke any orphaned sing-box (else Stop leaves proxying alive)
	m.xray.Stop()                      // sidecar after sing-box: nothing dials it any more
	time.Sleep(300 * time.Millisecond) // grace for the wintun driver to release
	return nil
}

// CleanStrays kills orphaned sing-box (and Xray sidecar) processes from a
// prior crash. Call once on startup so a leftover core isn't left proxying
// after the app restarts.
func (m *Manager) CleanStrays() {
	m.killStrays()
	m.xray.CleanStrays()
}

// killStrays force-kills every sing-box.exe running from OUR bin path. This
// catches orphans left by a crash or a botched restart that would otherwise
// keep the TUN adapter up (proxying) after Stop, or collide with a new Start.
func (m *Manager) killStrays() { killCoreProcs(m.binPath, false) }

func (m *Manager) pump(r interface{ Read([]byte) (int, error) }) { pumpLines(r, m.onLog) }

func pumpLines(r interface{ Read([]byte) (int, error) }, onLog LogFunc) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		onLog(sc.Text())
	}
}

// FreePort returns an unused loopback TCP port.
func FreePort() (int, error) { return freePort() }

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
