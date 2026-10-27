package xray

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
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

// ExeName is the sidecar binary, kept next to sing-box.exe.
const ExeName = "xray.exe"

// ErrMissing: a node needs Xray but xray.exe is absent and could not be fetched.
var ErrMissing = errors.New("该节点需要 Xray 内核")

// errNotUp: the process did not open its ports (bind race, bad config, crash).
var errNotUp = errors.New("xray not listening")

const (
	startTimeout  = 5 * time.Second
	restartDelay  = 2 * time.Second  // backoff before the one automatic restart
	restartWindow = 60 * time.Second // a second crash within this = give up
)

// Sidecar owns one Xray process serving every Xray-only node of one sing-box
// instance (main core, a proxy port, or a latency probe).
type Sidecar struct {
	binPath string
	dir     string // config + log live here
	onLog   func(string)
	// Fetch, if set, downloads xray.exe when it is missing (lazy install).
	Fetch func() error
	// WaitReady, if set, blocks until the app finished installing the bundled
	// xray.exe (it runs off the UI path); called only when a node needs Xray.
	WaitReady func()
	// AutoRestart: after an unexpected exit restart once (same ports and
	// credentials, so the running sing-box config stays valid). A second crash
	// within restartWindow, or a failed restart, calls OnDead instead.
	AutoRestart bool
	OnDead      func()

	life sync.Mutex // serialises Ensure / Stop / the automatic restart

	mu          sync.Mutex
	cmd         *exec.Cmd
	done        chan struct{}
	live        bool   // cmd passed its start check (exits after this are unexpected)
	gen         uint64 // bumped by every start / stop; a pending restart checks it
	entries     map[string]Entry
	lastRestart time.Time
}

// NewSidecar prepares (does not start) a sidecar. binPath is xray.exe, dir a
// writable directory used only by this sidecar.
func NewSidecar(binPath, dir string, onLog func(string)) *Sidecar {
	if onLog == nil {
		onLog = func(string) {}
	}
	return &Sidecar{binPath: binPath, dir: dir, onLog: onLog}
}

// BinPath is the xray.exe this sidecar runs.
func (s *Sidecar) BinPath() string { return s.binPath }

func (s *Sidecar) cfgPath() string { return filepath.Join(s.dir, "xray.json") }

// Ports returns the inbound endpoint per Key of the running sidecar.
func (s *Sidecar) Ports() map[string]Endpoint {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[string]Endpoint, len(s.entries))
	for k, e := range s.entries {
		out[k] = e.Endpoint
	}
	return out
}

// Ensure makes the sidecar serve exactly the Xray-only nodes among ns and
// returns their endpoints by Key. Nodes not needing Xray are ignored; with
// none left the sidecar is stopped. Already-served nodes keep their port; the
// process restarts only when the node set changes. A start that does not come
// up (e.g. a port taken between allocation and Xray's bind) is retried once
// with fresh ports.
func (s *Sidecar) Ensure(ns []*nodes.Node) (map[string]Endpoint, error) {
	want := map[string]*nodes.Node{}
	for _, n := range ns {
		if n.UseXray() {
			want[Key(n)] = n
		}
	}
	s.life.Lock()
	defer s.life.Unlock()
	if len(want) == 0 {
		s.stop()
		return map[string]Endpoint{}, nil
	}
	if s.WaitReady != nil {
		s.WaitReady()
	}
	if s.serving(want) {
		return s.Ports(), nil
	}
	if err := s.ensureBinary(); err != nil {
		return nil, err
	}
	old := s.Ports()
	s.stop()
	var err error
	for attempt := 0; attempt < 2; attempt++ {
		entries, aerr := allocate(want, old, newSecret(), newSecret())
		if aerr != nil {
			return nil, aerr
		}
		if err = s.start(entries); err == nil {
			return s.Ports(), nil
		}
		if !errors.Is(err, errNotUp) {
			break
		}
		old = nil
	}
	return nil, err
}

func (s *Sidecar) ensureBinary() error {
	if _, err := os.Stat(s.binPath); err == nil {
		return nil
	}
	if s.Fetch == nil {
		return fmt.Errorf("%w，但本机缺少 %s", ErrMissing, ExeName)
	}
	s.onLog("[xray] 该节点需要 Xray 内核，正在下载…")
	if err := s.Fetch(); err != nil {
		return fmt.Errorf("%w，下载失败：%v", ErrMissing, err)
	}
	if _, err := os.Stat(s.binPath); err != nil {
		return fmt.Errorf("%w，下载后仍找不到 %s", ErrMissing, ExeName)
	}
	return nil
}

func (s *Sidecar) serving(want map[string]*nodes.Node) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cmd == nil || len(s.entries) != len(want) {
		return false
	}
	for k, n := range want {
		e, ok := s.entries[k]
		if !ok || e.Node.Raw != n.Raw || e.Node.Server != n.Server || e.Node.Port != n.Port {
			return false
		}
	}
	return true
}

// allocate reuses a node's previous port when still free, else picks a new
// one. All inbounds of one launch share the given credentials.
func allocate(want map[string]*nodes.Node, old map[string]Endpoint, user, pass string) ([]Entry, error) {
	keys := make([]string, 0, len(want))
	for k := range want {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	entries := make([]Entry, 0, len(keys))
	for _, k := range keys {
		port := old[k].Port
		if port == 0 || !portFree(port) {
			p, err := FreePort()
			if err != nil {
				return nil, err
			}
			port = p
		}
		entries = append(entries, Entry{Key: k, Endpoint: Endpoint{Port: port, User: user, Pass: pass}, Node: want[k]})
	}
	return entries, nil
}

// newSecret returns 16 random bytes in hex (SOCKS user / password).
func newSecret() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// start launches Xray for entries and waits until every inbound listens.
// Caller holds s.life and has stopped any previous process.
func (s *Sidecar) start(entries []Entry) error {
	cfg, err := BuildConfig(entries, "warning")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(s.cfgPath(), cfg, 0o600); err != nil {
		return err
	}
	KillStrays(s.binPath, s.cfgPath())
	cmd, done, err := s.launch(entries)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if err := waitPort(e.Port, startTimeout, done); err != nil {
			s.stop()
			return fmt.Errorf("Xray 内核没有起来（端口 %d 未监听，看 %s）：%w", e.Port, filepath.Join(s.dir, "xray.log"), errNotUp)
		}
	}
	s.mu.Lock()
	if s.cmd == cmd {
		s.live = true
	}
	s.mu.Unlock()
	s.onLog(fmt.Sprintf("[xray] Xray 内核已启动（%d 个节点）", len(entries)))
	return nil
}

// launch starts the process and its exit watcher.
func (s *Sidecar) launch(entries []Entry) (*exec.Cmd, chan struct{}, error) {
	logFile, _ := os.OpenFile(filepath.Join(s.dir, "xray.log"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	cmd := exec.Command(s.binPath, "run", "-c", s.cfgPath())
	cmd.Dir = s.dir
	hideWindow(cmd)
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		closeFile(logFile)
		return nil, nil, fmt.Errorf("启动 Xray 内核失败：%w", err)
	}
	var wg sync.WaitGroup
	wg.Add(2)
	var logMu sync.Mutex
	go func() { defer wg.Done(); s.pump(stdout, logFile, &logMu) }()
	go func() { defer wg.Done(); s.pump(stderr, logFile, &logMu) }()
	done := make(chan struct{})
	byKey := make(map[string]Entry, len(entries))
	for _, e := range entries {
		byKey[e.Key] = e
	}
	s.mu.Lock()
	s.gen++
	s.cmd, s.done, s.entries, s.live = cmd, done, byKey, false
	s.mu.Unlock()
	go func() {
		_ = cmd.Wait()
		wg.Wait()
		closeFile(logFile)
		s.mu.Lock()
		unexpected := s.cmd == cmd && s.live
		if s.cmd == cmd {
			s.cmd, s.live = nil, false
		}
		gen := s.gen
		s.mu.Unlock()
		close(done)
		if !unexpected {
			s.onLog("[xray] Xray 内核已退出")
			return
		}
		s.onLog("[xray] Xray 内核意外退出（看 " + filepath.Join(s.dir, "xray.log") + "）")
		go s.recover(entries, gen)
	}()
	return cmd, done, nil
}

// recover handles an unexpected exit: one restart with the same entries after
// a short backoff, else OnDead. gen guards against a Stop / Ensure meanwhile.
func (s *Sidecar) recover(entries []Entry, gen uint64) {
	s.mu.Lock()
	retry := s.AutoRestart && time.Since(s.lastRestart) > restartWindow
	if retry {
		s.lastRestart = time.Now()
	}
	s.mu.Unlock()
	if retry {
		time.Sleep(restartDelay)
		s.life.Lock()
		s.mu.Lock()
		stale := s.gen != gen
		s.mu.Unlock()
		if stale {
			s.life.Unlock()
			return
		}
		s.onLog("[xray] 正在重启 Xray 内核…")
		err := s.start(entries)
		s.life.Unlock()
		if err == nil {
			return
		}
		s.onLog("[xray] Xray 内核重启失败：" + err.Error())
	}
	s.mu.Lock()
	stale := s.gen != gen
	s.mu.Unlock()
	if !stale && s.OnDead != nil {
		s.OnDead()
	}
}

func (s *Sidecar) pump(r io.Reader, f *os.File, mu *sync.Mutex) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		line := sc.Text()
		s.onLog("[xray] " + line)
		if f != nil {
			mu.Lock()
			_, _ = f.WriteString(line + "\n")
			mu.Unlock()
		}
	}
}

// Running reports whether the Xray process is up.
func (s *Sidecar) Running() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cmd != nil
}

// Stop kills the process (if any) and waits for it to exit.
func (s *Sidecar) Stop() {
	s.life.Lock()
	defer s.life.Unlock()
	s.stop()
}

func (s *Sidecar) stop() {
	s.mu.Lock()
	cmd, done := s.cmd, s.done
	s.cmd, s.entries, s.live = nil, nil, false
	s.gen++
	s.mu.Unlock()
	if cmd == nil || cmd.Process == nil {
		return
	}
	_ = cmd.Process.Kill()
	if done != nil {
		select {
		case <-done:
		case <-time.After(4 * time.Second):
		}
	}
}

// CleanStrays kills an Xray left running by a crash for this sidecar's config.
func (s *Sidecar) CleanStrays() { KillStrays(s.binPath, s.cfgPath()) }

// KillStrays force-kills xray.exe processes started from binPath whose config
// argument ("-c <path>") starts with prefix, so one sidecar never kills
// another's process. Without any xray.exe running (the common case) it
// returns after a cheap process snapshot — no PowerShell.
func KillStrays(binPath, prefix string) {
	if _, err := os.Stat(binPath); err != nil || !exeRunning(ExeName) {
		return
	}
	ps := "Get-CimInstance Win32_Process -Filter \"Name='" + ExeName + "'\" | " +
		"Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -ieq $env:PS_XRAY_PATH) -and $_.CommandLine -and " +
		"($_.CommandLine.ToLower().Contains('-c ' + $env:PS_XRAY_MARK) -or $_.CommandLine.ToLower().Contains('-c \"' + $env:PS_XRAY_MARK)) } | " +
		"ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive", "-Command", ps)
	cmd.Env = append(os.Environ(), "PS_XRAY_PATH="+filepath.Clean(binPath), "PS_XRAY_MARK="+strings.ToLower(filepath.Clean(prefix)))
	hideWindow(cmd)
	_ = cmd.Run()
}

// FreePort returns an unused loopback TCP port.
func FreePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

func portFree(port int) bool {
	l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return false
	}
	_ = l.Close()
	return true
}

// waitPort waits until port accepts connections; it gives up at once when
// exited is closed (the process died — no point waiting out the timeout).
func waitPort(port int, timeout time.Duration, exited <-chan struct{}) error {
	deadline := time.Now().Add(timeout)
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	for time.Now().Before(deadline) {
		if c, err := net.DialTimeout("tcp", addr, 300*time.Millisecond); err == nil {
			_ = c.Close()
			return nil
		}
		select {
		case <-exited:
			return errNotUp
		case <-time.After(100 * time.Millisecond):
		}
	}
	return context.DeadlineExceeded
}

func closeFile(f *os.File) {
	if f != nil {
		_ = f.Close()
	}
}
