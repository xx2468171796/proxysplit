package core

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"proxysplit/internal/nodes"
	"proxysplit/internal/xray"
)

// PortDirName is the data sub-directory holding the proxy-port configs. Its
// name appears in every port process's command line: killStrays (main core)
// skips those, KillPortStrays targets only them.
const PortDirName = "proxyports"

// PortProcess runs the sing-box process of one proxy port.
type PortProcess struct {
	binPath string
	cfgPath string
	onLog   LogFunc
	onExit  func() // fired after an unexpected exit (not after Stop)

	mu      sync.Mutex
	cmd     *exec.Cmd
	done    chan struct{}
	stopped bool
	xray    *xray.Sidecar // Xray-only exit node (PrepareXray); stopped with the port
}

// NewPortProcess prepares (does not start) the process of port id.
func NewPortProcess(binPath, dataDir, id string, onLog LogFunc, onExit func()) *PortProcess {
	if onLog == nil {
		onLog = func(string) {}
	}
	p := &PortProcess{
		binPath: binPath,
		cfgPath: PortConfigPath(dataDir, id),
		xray:    newSidecar(binPath, portXrayDir(dataDir, id), onLog),
		onLog:   onLog,
		onExit:  onExit,
	}
	p.xray.AutoRestart, p.xray.OnDead = true, p.xrayDead
	return p
}

// portXrayDir is the sidecar dir of port id; portXrayPrefix matches all of them.
func portXrayDir(dataDir, id string) string { return portXrayPrefix(dataDir) + id }
func portXrayPrefix(dataDir string) string {
	return filepath.Join(dataDir, PortDirName, "xray-")
}

// xrayDead: the port's exit node is the Xray one, so a dead sidecar (restart
// failed) means a dead port. Kill sing-box without Stop so the regular
// unexpected-exit path (onExit) reports it.
func (p *PortProcess) xrayDead() {
	p.mu.Lock()
	cmd := p.cmd
	p.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		p.onLog("[xray] Xray 内核重启失败，该代理端口已停止")
		_ = cmd.Process.Kill()
	}
}

// PortConfigPath is where the config of port id is written.
func PortConfigPath(dataDir, id string) string {
	return filepath.Join(dataDir, PortDirName, "port-"+id+".json")
}

// Running reports whether the process is up.
func (p *PortProcess) Running() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.cmd != nil
}

// Start writes cfg and launches sing-box, waiting until probePort (the clash
// controller) accepts connections.
func (p *PortProcess) Start(cfg []byte, probePort int) error {
	p.mu.Lock()
	if p.cmd != nil {
		p.mu.Unlock()
		return fmt.Errorf("已在运行")
	}
	p.mu.Unlock()
	if _, err := os.Stat(p.binPath); err != nil {
		return fmt.Errorf("找不到内核 %s", p.binPath)
	}
	if err := os.MkdirAll(filepath.Dir(p.cfgPath), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(p.cfgPath, cfg, 0o600); err != nil {
		return err
	}
	cmd := exec.Command(p.binPath, "run", "-c", p.cfgPath)
	cmd.Dir = filepath.Dir(p.cfgPath)
	hideWindow(cmd)
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动内核失败：%w", err)
	}
	go pumpLines(stdout, p.onLog)
	go pumpLines(stderr, p.onLog)
	done := make(chan struct{})
	p.mu.Lock()
	p.cmd, p.done, p.stopped = cmd, done, false
	p.mu.Unlock()
	go func() {
		_ = cmd.Wait()
		p.mu.Lock()
		active := p.cmd == cmd
		unexpected := active && !p.stopped
		if active {
			p.cmd = nil
		}
		p.mu.Unlock()
		close(done)
		if unexpected && p.onExit != nil {
			p.onExit()
		}
	}()
	if err := waitPort(probePort, 5*time.Second); err != nil {
		p.Stop()
		return fmt.Errorf("内核没有起来（看端口日志）")
	}
	return nil
}

// Stop kills the process and waits for it to exit.
func (p *PortProcess) Stop() {
	p.mu.Lock()
	cmd, done := p.cmd, p.done
	p.cmd = nil
	p.stopped = true
	p.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
		if done != nil {
			select {
			case <-done:
			case <-time.After(4 * time.Second):
			}
		}
	}
	p.xray.Stop()
}

// PrepareXray starts the port's Xray sidecar when node needs it (stops it
// otherwise) and returns the ports for PortConfig.XrayPorts. Call before Start.
func (p *PortProcess) PrepareXray(node *nodes.Node) (map[string]xray.Endpoint, error) {
	if node == nil {
		p.xray.Stop()
		return nil, nil
	}
	return p.xray.Ensure([]*nodes.Node{node})
}

// KillPortStrays kills proxy-port processes orphaned by a prior crash (sing-box
// from binPath whose command line points into the proxyports directory, and
// port Xray sidecars whose config lives under dataDir/proxyports/xray-*).
func KillPortStrays(binPath, dataDir string) {
	ps := "Get-CimInstance Win32_Process -Filter \"Name='sing-box.exe'\" | " +
		"Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -ieq $env:PS_SINGBOX_PATH) -and ($_.CommandLine -like '*" + PortDirName + "*') } | " +
		"ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive", "-Command", ps)
	cmd.Env = append(os.Environ(), "PS_SINGBOX_PATH="+filepath.Clean(binPath))
	hideWindow(cmd)
	_ = cmd.Run()
	xray.KillStrays(XrayBinPath(binPath), portXrayPrefix(dataDir))
}

// portFirewallRule is the Windows Firewall rule letting LAN clients reach the
// LAN proxy ports: inbound TCP, only those ports, only from private networks.
const portFirewallRule = "ProxySplit 端口代理"

var (
	portFirewallMu   sync.Mutex
	portFirewallLast = "-" // port list the rule was last written for ("-" = never)
)

// SyncPortFirewall rewrites the rule for exactly the given LAN ports (none =
// rule removed). Skips the PowerShell call when the list is unchanged.
func SyncPortFirewall(binPath string, ports []int) error {
	if runtime.GOOS != "windows" {
		return nil
	}
	list := make([]string, 0, len(ports))
	for _, p := range ports {
		list = append(list, strconv.Itoa(p))
	}
	sort.Strings(list)
	key := strings.Join(list, ",")
	portFirewallMu.Lock()
	defer portFirewallMu.Unlock()
	if key == portFirewallLast {
		return nil
	}
	ps := "Remove-NetFirewallRule -DisplayName $env:PS_RULE -ErrorAction SilentlyContinue; " +
		"if ($env:PS_PORTS) { New-NetFirewallRule -DisplayName $env:PS_RULE -Direction Inbound -Action Allow " +
		"-Program $env:PS_SINGBOX_PATH -Protocol TCP -LocalPort ($env:PS_PORTS -split ',') -RemoteAddress LocalSubnet,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16 -Profile Any | Out-Null }"
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive", "-Command", ps)
	cmd.Env = append(os.Environ(), "PS_SINGBOX_PATH="+filepath.Clean(binPath), "PS_RULE="+portFirewallRule, "PS_PORTS="+key)
	hideWindow(cmd)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("%v: %s", err, out)
	}
	portFirewallLast = key
	return nil
}
