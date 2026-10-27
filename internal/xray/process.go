package xray

import (
	"bufio"
	"context"
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

// Sidecar owns one Xray process serving every Xray-only node of one sing-box
// instance (main core, a proxy port, or a latency probe).
type Sidecar struct {
	binPath string
	dir     string // config + log live here
	onLog   func(string)
	// Fetch, if set, downloads xray.exe when it is missing (lazy install).
	Fetch func() error

	mu      sync.Mutex
	cmd     *exec.Cmd
	done    chan struct{}
	entries map[string]Entry
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

// Ports returns the inbound port per Key of the running sidecar.
func (s *Sidecar) Ports() map[string]int {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[string]int, len(s.entries))
	for k, e := range s.entries {
		out[k] = e.Port
	}
	return out
}

// Ensure makes the sidecar serve exactly the Xray-only nodes among ns and
// returns their ports by Key. Nodes not needing Xray are ignored; with none
// left the sidecar is stopped. Already-served nodes keep their port; the
// process restarts only when the node set changes.
func (s *Sidecar) Ensure(ns []*nodes.Node) (map[string]int, error) {
	want := map[string]*nodes.Node{}
	for _, n := range ns {
		if n.NeedsXray() {
			want[Key(n)] = n
		}
	}
	if len(want) == 0 {
		s.Stop()
		return map[string]int{}, nil
	}
	if s.serving(want) {
		return s.Ports(), nil
	}
	if err := s.ensureBinary(); err != nil {
		return nil, err
	}
	old := s.Ports()
	s.Stop()
	entries, err := allocate(want, old)
	if err != nil {
		return nil, err
	}
	if err := s.start(entries); err != nil {
		return nil, err
	}
	return s.Ports(), nil
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

// allocate reuses a node's previous port when still free, else picks a new one.
func allocate(want map[string]*nodes.Node, old map[string]int) ([]Entry, error) {
	keys := make([]string, 0, len(want))
	for k := range want {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	entries := make([]Entry, 0, len(keys))
	for _, k := range keys {
		port := old[k]
		if port == 0 || !portFree(port) {
			p, err := FreePort()
			if err != nil {
				return nil, err
			}
			port = p
		}
		entries = append(entries, Entry{Key: k, Port: port, Node: want[k]})
	}
	return entries, nil
}

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
	logFile, _ := os.OpenFile(filepath.Join(s.dir, "xray.log"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	cmd := exec.Command(s.binPath, "run", "-c", s.cfgPath())
	cmd.Dir = s.dir
	hideWindow(cmd)
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		closeFile(logFile)
		return fmt.Errorf("启动 Xray 内核失败：%w", err)
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
	s.cmd, s.done, s.entries = cmd, done, byKey
	s.mu.Unlock()
	go func() {
		_ = cmd.Wait()
		wg.Wait()
		closeFile(logFile)
		s.mu.Lock()
		if s.cmd == cmd {
			s.cmd, s.entries = nil, nil
		}
		s.mu.Unlock()
		s.onLog("[xray] Xray 内核已退出")
		close(done)
	}()
	for _, e := range entries {
		if err := waitPort(e.Port, 5*time.Second); err != nil {
			s.Stop()
			return fmt.Errorf("Xray 内核没有起来（端口 %d 未监听，看 %s）", e.Port, filepath.Join(s.dir, "xray.log"))
		}
	}
	s.onLog(fmt.Sprintf("[xray] Xray 内核已启动（%d 个节点）", len(entries)))
	return nil
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
	s.mu.Lock()
	cmd, done := s.cmd, s.done
	s.cmd, s.entries = nil, nil
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

// KillStrays force-kills xray.exe processes started from binPath whose
// command line contains marker (the config path), so one sidecar never kills
// another's process.
func KillStrays(binPath, marker string) {
	if _, err := os.Stat(binPath); err != nil {
		return
	}
	ps := "Get-CimInstance Win32_Process -Filter \"Name='" + ExeName + "'\" | " +
		"Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -ieq $env:PS_XRAY_PATH) -and $_.CommandLine -and $_.CommandLine.ToLower().Contains($env:PS_XRAY_MARK) } | " +
		"ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive", "-Command", ps)
	cmd.Env = append(os.Environ(), "PS_XRAY_PATH="+filepath.Clean(binPath), "PS_XRAY_MARK="+strings.ToLower(filepath.Clean(marker)))
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

func waitPort(port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	for time.Now().Before(deadline) {
		if c, err := net.DialTimeout("tcp", addr, 300*time.Millisecond); err == nil {
			_ = c.Close()
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return context.DeadlineExceeded
}

func closeFile(f *os.File) {
	if f != nil {
		_ = f.Close()
	}
}
