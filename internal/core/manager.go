package core

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
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
	done    chan struct{} // closed when the current cmd exits (for Stop to await)
	tunCfg  []byte        // config the running TUN core was started with (for hot updates)
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
	done := make(chan struct{})
	m.mu.Lock()
	m.cmd = cmd
	m.running = true
	m.port = primary
	m.node = lines[0].Node
	m.done = done
	m.mu.Unlock()

	go func() {
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

	cfg, opts, err := m.tunConfig(node, logLevel, routeMode, routeRules, opts)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(m.dataDir, 0o755); err != nil {
		return err
	}
	if err := writeRuleSets(opts); err != nil {
		return err
	}
	cfgPath := filepath.Join(m.dataDir, "sing-box.json")
	if err := os.WriteFile(cfgPath, cfg, 0o600); err != nil {
		return err
	}

	m.killStrays() // clean slate: remove any orphaned sing-box before starting

	// Spawn with a retry: a TUN start can transiently fail if a previous wintun
	// adapter is still being released by the driver. Retry once after a short
	// settle delay before giving up.
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			m.onLog(fmt.Sprintf("[core] TUN 启动失败，重试 (%d/2)…", attempt))
			time.Sleep(time.Duration(attempt) * 900 * time.Millisecond)
		}
		if err := m.spawn(cfgPath); err != nil {
			lastErr = err
			continue
		}
		// TUN has no port to probe; a config/wintun failure makes the process
		// exit quickly, so a short wait + liveness check is the readiness signal.
		time.Sleep(2500 * time.Millisecond)
		if m.Running() {
			m.mu.Lock()
			m.node = node
			m.tunCfg = cfg
			m.mu.Unlock()
			m.onLog(fmt.Sprintf("[core] sing-box TUN up (%s) via %s", routeMode, node.Name))
			return nil
		}
		lastErr = fmt.Errorf("core exited on start (TUN/wintun error — check the log)")
		m.Stop() // clean up before the next attempt
	}
	return lastErr
}

// tunConfig builds the TUN config; app-split rule-sets default to <dataDir>/rules.
func (m *Manager) tunConfig(node *nodes.Node, logLevel, routeMode string, routeRules []RouteRule, opts Options) ([]byte, Options, error) {
	opts.RouteMode = routeMode
	opts.RouteRules = routeRules
	if opts.Split && opts.RuleDir == "" {
		opts.RuleDir = filepath.Join(m.dataDir, "rules")
	}
	cfg, err := BuildTUNConfig(node, logLevel, opts)
	return cfg, opts, err
}

// ApplySplitLists re-routes apps on the running core without a restart. It only
// applies when the new options build exactly the config the core is running
// (same groups, nodes, rules and settings): then only the per-app rule-set
// files differ, and sing-box reloads those by itself. It returns false when the
// core is not running a TUN config or the config differs (restart needed).
func (m *Manager) ApplySplitLists(node *nodes.Node, logLevel, routeMode string, routeRules []RouteRule, opts Options) (bool, error) {
	cfg, opts, err := m.tunConfig(node, logLevel, routeMode, routeRules, opts)
	if err != nil {
		return false, err
	}
	m.mu.Lock()
	same := m.running && m.tunCfg != nil && string(m.tunCfg) == string(cfg)
	m.mu.Unlock()
	if !same || !opts.Split {
		return false, nil
	}
	return true, writeRuleSets(opts)
}

// writeRuleSets writes the per-app process rule-sets atomically (temp + rename),
// so the core never reads a half-written file.
//
// Order matters: the core reloads each file on its own as soon as it changes.
// An app moved between two lists must be added to its new list before it is
// removed from the old one; the other way round it is briefly in no list at all
// and falls to the default route (in 默认全走代理 a 直连 / 拦截 app would go
// through the proxy for a moment). So files that gain processes are written
// first (sorted, for a deterministic order), then those that only lose some.
// (Writing in Go map order made TestHotReloadMoveHasNoGap fail ~1 run in 3.)
func writeRuleSets(opts Options) error {
	sets := SplitRuleSets(opts)
	if len(sets) == 0 {
		return nil
	}
	if err := os.MkdirAll(opts.RuleDir, 0o755); err != nil {
		return err
	}
	var gains, losses []string
	for tag, data := range sets {
		old, err := os.ReadFile(filepath.Join(opts.RuleDir, tag+".json"))
		if err == nil && string(old) == string(data) {
			continue
		}
		if err != nil || setGains(old, data) {
			gains = append(gains, tag)
		} else {
			losses = append(losses, tag)
		}
	}
	sort.Strings(gains)
	sort.Strings(losses)
	write := func(tag string) error {
		path := filepath.Join(opts.RuleDir, tag+".json")
		tmp := path + ".tmp"
		if err := os.WriteFile(tmp, sets[tag], 0o600); err != nil {
			return err
		}
		return os.Rename(tmp, path)
	}
	for _, tag := range gains {
		if err := write(tag); err != nil {
			return err
		}
	}
	for _, tag := range losses {
		if err := write(tag); err != nil {
			return err
		}
	}
	return nil
}

// setGains reports whether the new process list has a name the old one lacks.
// An unreadable old file counts as a gain (write it early: safe either way).
func setGains(old, next []byte) bool {
	oldNames, ok1 := processNames(old)
	newNames, ok2 := processNames(next)
	if !ok1 || !ok2 {
		return true
	}
	have := make(map[string]bool, len(oldNames))
	for _, n := range oldNames {
		have[strings.ToLower(n)] = true
	}
	for _, n := range newNames {
		// The empty-list placeholder is no process: a list that just lost its
		// last app only loses.
		if n != noProcess && !have[strings.ToLower(n)] {
			return true
		}
	}
	return false
}

func processNames(data []byte) ([]string, bool) {
	var doc struct {
		Rules []struct {
			ProcessName []string `json:"process_name"`
		} `json:"rules"`
	}
	if err := json.Unmarshal(data, &doc); err != nil {
		return nil, false
	}
	var names []string
	for _, r := range doc.Rules {
		names = append(names, r.ProcessName...)
	}
	return names, true
}

// spawn starts sing-box with the given config and wires up the exit watcher.
// It does NOT wait for readiness (the caller does). Safe to call only when the
// core is stopped.
func (m *Manager) spawn(cfgPath string) error {
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
		return nil
	}
	_ = cmd.Process.Kill()
	if done != nil {
		select {
		case <-done:
		case <-time.After(4 * time.Second):
		}
	}
	m.killStrays()                     // nuke any orphaned sing-box (else Stop leaves proxying alive)
	time.Sleep(300 * time.Millisecond) // grace for the wintun driver to release
	return nil
}

// CleanStrays kills orphaned sing-box processes from a prior crash. Call once
// on startup so a leftover core isn't left proxying after the app restarts.
func (m *Manager) CleanStrays() { m.killStrays() }

// killStrays force-kills every sing-box.exe running from OUR bin path. This
// catches orphans left by a crash or a botched restart that would otherwise
// keep the TUN adapter up (proxying) after Stop, or collide with a new Start.
func (m *Manager) killStrays() {
	// The path comes from %APPDATA% (contains the user name) and is passed as an
	// environment variable: PowerShell ends a '…' string at typographic quotes
	// too, so quoting it into the script text would break on such names.
	ps := "Get-CimInstance Win32_Process -Filter \"Name='sing-box.exe'\" | " +
		"Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -ieq $env:PS_SINGBOX_PATH) } | " +
		"ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive", "-Command", ps)
	cmd.Env = append(os.Environ(), "PS_SINGBOX_PATH="+filepath.Clean(m.binPath))
	hideWindow(cmd)
	_ = cmd.Run()
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
