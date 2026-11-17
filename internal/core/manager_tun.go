package core

// TUN start and hot-reload of the app split lists (moved out of manager.go).

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"proxysplit/internal/nodes"
	"proxysplit/internal/xray"
)

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

	opts, err := m.withSidecar([]*nodes.Node{node}, opts)
	if err != nil {
		return err
	}
	cfg, opts, err := m.tunConfig(node, logLevel, routeMode, routeRules, opts)
	if err != nil {
		m.xray.Stop()
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
	m.xray.Stop()
	return lastErr
}

// tunConfig builds the TUN config; app-split rule-sets default to <dataDir>/rules.
func (m *Manager) tunConfig(node *nodes.Node, logLevel, routeMode string, routeRules []RouteRule, opts Options) ([]byte, Options, error) {
	opts.RouteMode = routeMode
	opts.RouteRules = routeRules
	if opts.Split && opts.RuleDir == "" {
		opts.RuleDir = filepath.Join(m.dataDir, "rules")
	}
	if opts.Process != nil {
		cfg, err := BuildProcessConfig(node, logLevel, opts)
		return cfg, opts, err
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
	same, opts, err := m.sameAsRunning(node, logLevel, routeMode, routeRules, opts)
	if err != nil || !same || !opts.Split {
		return false, err
	}
	return true, writeRuleSets(opts)
}

// RunningConfigIs reports whether the running core was started with exactly
// the config these options build (then a reload has nothing to do).
func (m *Manager) RunningConfigIs(node *nodes.Node, logLevel, routeMode string, opts Options) (bool, error) {
	same, _, err := m.sameAsRunning(node, logLevel, routeMode, nil, opts)
	return same, err
}

// sameAsRunning builds the TUN config for the options and compares it, byte
// for byte, with the one the running core was started with.
func (m *Manager) sameAsRunning(node *nodes.Node, logLevel, routeMode string, routeRules []RouteRule, opts Options) (bool, Options, error) {
	// The running sidecar's ports: a changed Xray node set builds a different
	// config (or none) and so takes the restart path.
	cfg, opts, err := m.tunConfig(node, logLevel, routeMode, routeRules, m.xrayOpts(opts, m.xray.Ports()))
	if isXrayErr(err) {
		return false, opts, nil
	}
	if err != nil {
		return false, opts, err
	}
	m.mu.Lock()
	same := m.running && m.tunCfg != nil && string(m.tunCfg) == string(cfg)
	m.mu.Unlock()
	return same, opts, nil
}

// checkTimeout bounds one `sing-box check` run.
const checkTimeout = 20 * time.Second

// CheckTUN validates the TUN / process-capture config these options build with
// `sing-box check`, without starting anything and without touching the running
// core or its files. A reload calls it before the old core is stopped.
func (m *Manager) CheckTUN(node *nodes.Node, logLevel, routeMode string, opts Options) error {
	opts = m.xrayOpts(opts, m.xray.Ports())
	if node.UseXray() {
		// The sidecar for this node may not run yet: sing-box only sees its
		// SOCKS outbound, any port validates the same.
		key := xray.Key(PinNode(node, opts.ServerIPs))
		if opts.XrayPorts[key].Port == 0 {
			ports := map[string]xray.Endpoint{key: {Port: deadXrayPort}}
			for k, v := range opts.XrayPorts {
				ports[k] = v
			}
			opts.XrayPorts = ports
		}
	}
	if opts.Split {
		// `check` opens the app rule-set files: give it its own copies, the
		// running core is watching the real ones.
		opts.RuleDir = filepath.Join(m.dataDir, "check-rules")
		defer os.RemoveAll(opts.RuleDir)
	}
	cfg, opts, err := m.tunConfig(node, logLevel, routeMode, nil, opts)
	if err != nil {
		return err
	}
	if err := writeRuleSets(opts); err != nil {
		return err
	}
	return m.checkConfig(cfg)
}

// checkConfig runs `sing-box check` on cfg (written next to the live config,
// under its own name).
func (m *Manager) checkConfig(cfg []byte) error {
	if err := os.MkdirAll(m.dataDir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(m.dataDir, "check.json")
	if err := os.WriteFile(path, cfg, 0o600); err != nil {
		return err
	}
	defer os.Remove(path)
	ctx, cancel := context.WithTimeout(context.Background(), checkTimeout)
	defer cancel()
	check := exec.CommandContext(ctx, m.binPath, "check", "-c", path)
	check.Dir = m.dataDir
	hideWindow(check)
	out, err := check.CombinedOutput()
	if err != nil {
		return fmt.Errorf("sing-box check failed: %s", strings.TrimSpace(string(out)+" "+err.Error()))
	}
	return nil
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
	if len(sets) == 0 || opts.Process != nil { // process capture keeps the lists in memory
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
