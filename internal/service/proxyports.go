package service

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"proxysplit/internal/core"
	"proxysplit/internal/coreupdate"
	"proxysplit/internal/nodes"
)

// ProxyPort is one 端口代理 entry: a SOCKS5 / HTTP listener that fingerprint
// browsers (or any LAN client) connect to, exiting through its own node. Each
// port runs its own sing-box process, independent of the app-split core, so
// any number can be open at once and each starts / stops on its own.
type ProxyPort struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Enabled  bool   `json:"enabled"`  // 开启：随软件启动自动开、手动关后保持关
	Port     int    `json:"port"`     // listen port
	Protocol string `json:"protocol"` // mixed | socks | http
	LAN      bool   `json:"lan"`      // true = 0.0.0.0（局域网可连）, false = 仅本机
	User     string `json:"user"`     // auth username (empty = no auth)
	Pass     string `json:"pass"`
	Mode     string `json:"mode"` // rule | global | direct
	Node     string `json:"node"` // node id; "" = 当前选中节点
}

// ProxyPortStatus is a ProxyPort with its live state for the UI.
type ProxyPortStatus struct {
	ProxyPort
	Running  bool         `json:"running"`
	Error    string       `json:"error,omitempty"`
	NodeName string       `json:"nodeName"`
	Conns    int          `json:"conns"` // live connections
	Upload   int64        `json:"upload"`
	Download int64        `json:"download"`
	Clients  []PortClient `json:"clients"`
}

// portRuntime is the live state of one port (process + monitor data).
type portRuntime struct {
	life        sync.Mutex // serializes stop / start of this port (held across the whole launch)
	mu          sync.Mutex // guards proc, clashPort, clashSecret, nodeName, noNode, err
	nodeName    string
	noNode      bool // running config has no node (直连 only)
	proc        *core.PortProcess
	clashPort   int
	clashSecret string
	err         string
	logs        logRing
	mon         portMonitor
}

// portSet holds every port's runtime, keyed by port id.
type portSet struct {
	mu     sync.Mutex
	rt     map[string]*portRuntime
	closed bool // app is exiting: no port may start any more
}

func (s *Service) portRuntime(id string) *portRuntime {
	s.ports.mu.Lock()
	defer s.ports.mu.Unlock()
	if s.ports.rt == nil {
		s.ports.rt = map[string]*portRuntime{}
	}
	rt := s.ports.rt[id]
	if rt == nil {
		rt = &portRuntime{}
		s.ports.rt[id] = rt
	}
	return rt
}

func newPortID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *Service) singBoxPath() string { return filepath.Join(s.binDir, "sing-box.exe") }

// ListProxyPorts returns every port with its live state.
func (s *Service) ListProxyPorts() []ProxyPortStatus {
	s.mu.Lock()
	list := append([]ProxyPort(nil), s.cfg.ProxyPorts...)
	names := map[string]string{}
	for _, p := range list {
		if n := s.portNodeLocked(p); n != nil {
			names[p.ID] = n.Name
		}
	}
	s.mu.Unlock()
	out := make([]ProxyPortStatus, 0, len(list))
	for _, p := range list {
		rt := s.portRuntime(p.ID)
		running, _, _, _, errText := rt.state()
		st := ProxyPortStatus{ProxyPort: p, NodeName: names[p.ID], Running: running, Error: errText}
		if p.Mode == "direct" && st.NodeName == "" {
			st.NodeName = "直连"
		}
		st.Conns, st.Upload, st.Download, st.Clients = rt.mon.summary()
		out = append(out, st)
	}
	return out
}

// normalizePort validates and fills defaults; caller holds s.mu.
func (s *Service) normalizePortLocked(p *ProxyPort) error {
	p.Name = strings.TrimSpace(p.Name)
	p.User = strings.TrimSpace(p.User)
	if p.Port < 1 || p.Port > 65535 {
		return fmt.Errorf("端口要在 1–65535 之间")
	}
	switch p.Protocol {
	case "socks", "http", "mixed":
	default:
		p.Protocol = "mixed"
	}
	if !clashModes[p.Mode] {
		p.Mode = "rule"
	}
	if p.User == "" {
		p.Pass = ""
	}
	if p.Node != "" && s.nodeByID(p.Node) == nil {
		return fmt.Errorf("选的节点不存在了，请重新选择")
	}
	for _, o := range s.cfg.ProxyPorts {
		if o.ID != p.ID && o.Port == p.Port {
			return fmt.Errorf("端口 %d 已被「%s」使用", p.Port, o.Name)
		}
	}
	if s.cfg.Settings.LanShare && s.cfg.Settings.LanPort == p.Port {
		return fmt.Errorf("端口 %d 已被「局域网共享」使用", p.Port)
	}
	if p.Name == "" {
		p.Name = fmt.Sprintf("端口 %d", p.Port)
	}
	return nil
}

// SaveProxyPort adds (empty ID) or updates a port. A running port is restarted
// with the new settings; an enabled new port starts right away.
func (s *Service) SaveProxyPort(p ProxyPort) (ProxyPort, error) {
	s.mu.Lock()
	if p.ID == "" {
		p.ID = newPortID()
		p.Enabled = true
	}
	if err := s.normalizePortLocked(&p); err != nil {
		s.mu.Unlock()
		return p, err
	}
	found := false
	for i := range s.cfg.ProxyPorts {
		if s.cfg.ProxyPorts[i].ID == p.ID {
			p.Enabled = s.cfg.ProxyPorts[i].Enabled
			s.cfg.ProxyPorts[i] = p
			found = true
		}
	}
	first := !found && len(s.cfg.ProxyPorts) == 0
	if !found {
		s.cfg.ProxyPorts = append(s.cfg.ProxyPorts, p)
	}
	s.save()
	s.mu.Unlock()
	if first && s.core.Running() {
		// The running TUN predates the port-process passthrough rule (portProcessPath).
		go func() {
			if err := s.restart(); err != nil {
				s.log("[port] 主代理重启失败：" + err.Error())
			}
		}()
	}
	if p.Enabled {
		return p, s.startPort(p.ID)
	}
	s.stopPort(p.ID)
	return p, nil
}

// DeleteProxyPort stops and removes a port.
func (s *Service) DeleteProxyPort(id string) {
	s.stopPort(id)
	s.mu.Lock()
	kept := s.cfg.ProxyPorts[:0]
	for _, p := range s.cfg.ProxyPorts {
		if p.ID != id {
			kept = append(kept, p)
		}
	}
	s.cfg.ProxyPorts = kept
	s.save()
	s.mu.Unlock()
	s.ports.mu.Lock()
	delete(s.ports.rt, id)
	s.ports.mu.Unlock()
	// The generated config holds the node credentials and the port password.
	_ = os.Remove(core.PortConfigPath(s.dataDir, id))
	s.syncPortFirewall()
}

// SetProxyPortEnabled starts or stops one port and remembers the choice.
func (s *Service) SetProxyPortEnabled(id string, on bool) error {
	s.mu.Lock()
	ok := false
	for i := range s.cfg.ProxyPorts {
		if s.cfg.ProxyPorts[i].ID == id {
			s.cfg.ProxyPorts[i].Enabled = on
			ok = true
		}
	}
	s.save()
	s.mu.Unlock()
	if !ok {
		return fmt.Errorf("端口不存在")
	}
	if !on {
		s.stopPort(id)
		return nil
	}
	if running, _, _, _, _ := s.portRuntime(id).state(); running {
		return nil // already open (double click): keep it
	}
	return s.startPort(id)
}

// SetProxyPortMode switches 规则 / 全局 / 直连 of one port; a running port
// switches live through its own clash API, other ports are untouched.
func (s *Service) SetProxyPortMode(id, mode string) error {
	if !clashModes[mode] {
		return fmt.Errorf("无效模式 %q", mode)
	}
	s.mu.Lock()
	for i := range s.cfg.ProxyPorts {
		if s.cfg.ProxyPorts[i].ID == id {
			s.cfg.ProxyPorts[i].Mode = mode
		}
	}
	s.save()
	s.mu.Unlock()
	rt := s.portRuntime(id)
	running, port, secret, _, _ := rt.state()
	if !running {
		return nil
	}
	rt.mu.Lock()
	noNode := rt.noNode
	rt.mu.Unlock()
	if noNode && mode != "direct" {
		return s.startPort(id) // was built without a node: rebuild (reports 没有可用节点)
	}
	return putClashMode(port, secret, mode)
}

// StartProxyPorts opens every enabled port (app launch). Orphans of a prior
// crash were already killed in New, before anything could start a port.
func (s *Service) StartProxyPorts() {
	s.mu.Lock()
	var ids []string
	for _, p := range s.cfg.ProxyPorts {
		if p.Enabled {
			ids = append(ids, p.ID)
		}
	}
	s.mu.Unlock()
	for _, id := range ids {
		if err := s.startPort(id); err != nil {
			s.log(fmt.Sprintf("[port] %s 启动失败：%v", id, err))
		}
	}
	go s.portMonitorLoop()
}

// StopProxyPorts closes every port (app exit).
func (s *Service) StopProxyPorts() {
	s.ports.mu.Lock()
	s.ports.closed = true
	var ids []string
	for id := range s.ports.rt {
		ids = append(ids, id)
	}
	s.ports.mu.Unlock()
	for _, id := range ids {
		s.stopPort(id)
	}
}

// restartPortsFollowingActive restarts running ports that use the
// currently selected node (Node == "") after the selection changes.
func (s *Service) restartPortsFollowingActive() {
	s.mu.Lock()
	var ids []string
	for _, p := range s.cfg.ProxyPorts {
		if p.Enabled && p.Node == "" {
			ids = append(ids, p.ID)
		}
	}
	s.mu.Unlock()
	for _, id := range ids {
		if err := s.startPort(id); err != nil {
			s.log(fmt.Sprintf("[port] %s 换节点后重启失败：%v", id, err))
		}
	}
}

func (s *Service) stopPort(id string) {
	rt := s.portRuntime(id)
	rt.life.Lock()
	defer rt.life.Unlock()
	rt.stopLocked()
}

// stopLocked kills the process; caller holds rt.life.
func (rt *portRuntime) stopLocked() {
	rt.mu.Lock()
	proc := rt.proc
	rt.proc = nil
	rt.mu.Unlock()
	if proc != nil {
		proc.Stop()
	}
	rt.mon.reset()
}

// startPort (re)starts a port with its current settings: any running process
// is stopped first, all under the port's lifecycle lock, so concurrent saves /
// toggles / node switches can never leave a second process behind.
func (s *Service) startPort(id string) error {
	rt := s.portRuntime(id)
	rt.life.Lock()
	defer rt.life.Unlock()
	rt.stopLocked()
	s.ports.mu.Lock()
	closed := s.ports.closed
	s.ports.mu.Unlock()
	if closed {
		return fmt.Errorf("软件正在退出")
	}
	err := s.launchPort(id, rt)
	if err != nil {
		rt.setErr(err.Error())
	} else {
		rt.setErr("")
	}
	return err
}

func (s *Service) launchPort(id string, rt *portRuntime) error {
	s.mu.Lock()
	guard := s.startGuard
	s.mu.Unlock()
	if guard != nil {
		if err := guard(); err != nil {
			return fmt.Errorf("授权校验失败：%w", err)
		}
	}
	s.mu.Lock()
	var p *ProxyPort
	for i := range s.cfg.ProxyPorts {
		if s.cfg.ProxyPorts[i].ID == id {
			cp := s.cfg.ProxyPorts[i]
			p = &cp
		}
	}
	if p == nil {
		s.mu.Unlock()
		return fmt.Errorf("端口不存在")
	}
	node := s.portNodeLocked(*p)
	ruleSets := core.RuleSetOptions{
		GeoSiteCN: s.cfg.RuleSets["geosite-cn.srs"],
		GeoIPCN:   s.cfg.RuleSets["geoip-cn.srs"],
		Ads:       s.cfg.RuleSets["geosite-category-ads-all.srs"],
	}
	level := s.cfg.LogLevel
	direct := s.directDomains()
	s.mu.Unlock()
	if node == nil && p.Mode != "direct" {
		return fmt.Errorf("没有可用节点：先在「节点」里选一个，或给这个端口指定节点")
	}
	listen := "127.0.0.1"
	if p.LAN {
		listen = "0.0.0.0"
	}
	if l, err := net.Listen("tcp", fmt.Sprintf("%s:%d", listen, p.Port)); err != nil {
		return fmt.Errorf("端口 %d 被其他程序占用", p.Port)
	} else {
		_ = l.Close()
	}
	s.syncPortFirewall()
	clashPort, err := core.FreePort()
	if err != nil {
		return err
	}
	secret := genSecret()
	name := p.Name
	proc := core.NewPortProcess(s.singBoxPath(), s.dataDir, id, rt.logs.add, func() {
		rt.setErr("内核意外退出（看端口日志）")
		s.log(fmt.Sprintf("[port] %s 内核意外退出", name))
	})
	xrayPorts, err := proc.PrepareXray(node)
	if err != nil {
		return err
	}
	cfg, err := core.BuildPortConfig(core.PortConfig{
		Listen: listen, Port: p.Port, Protocol: p.Protocol, User: p.User, Pass: p.Pass,
		Node: node, Mode: p.Mode, LogLevel: level,
		ClashController: fmt.Sprintf("127.0.0.1:%d", clashPort), ClashSecret: secret,
		GeoDir: s.binDir, RuleSets: &ruleSets, DirectDomains: direct,
		RealityHybrid: coreupdate.HasTag(s.binDir, coreupdate.RealityHybridTag),
		XrayPorts:     xrayPorts,
	})
	if err != nil {
		proc.Stop()
		return err
	}
	if err := proc.Start(cfg, clashPort); err != nil {
		return err
	}
	rt.mu.Lock()
	rt.proc, rt.clashPort, rt.clashSecret = proc, clashPort, secret
	rt.nodeName, rt.noNode = "直连", node == nil
	if node != nil {
		rt.nodeName = node.Name
	}
	rt.mu.Unlock()
	s.log(fmt.Sprintf("[port] %s 已开启 %s:%d", name, listen, p.Port))
	return nil
}

// portNodeLocked resolves the exit node of p; caller holds s.mu.
func (s *Service) portNodeLocked(p ProxyPort) *nodes.Node {
	if p.Node != "" {
		return s.nodeByID(p.Node)
	}
	return s.selectedNode()
}

// state returns a consistent snapshot of the runtime's process fields.
func (rt *portRuntime) state() (running bool, clashPort int, secret, nodeName, errText string) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	return rt.proc != nil && rt.proc.Running(), rt.clashPort, rt.clashSecret, rt.nodeName, rt.err
}

func (rt *portRuntime) setErr(e string) {
	rt.mu.Lock()
	rt.err = e
	rt.mu.Unlock()
}

// portProcessPath is the core path the main TUN lets out untouched while any
// proxy port is configured ("" = none, keeps the config unchanged).
func (s *Service) portProcessPath() string {
	s.mu.Lock()
	n := len(s.cfg.ProxyPorts)
	s.mu.Unlock()
	if n == 0 {
		return ""
	}
	return s.singBoxPath()
}

// syncPortFirewall lets LAN clients reach exactly the LAN-enabled ports.
func (s *Service) syncPortFirewall() {
	s.mu.Lock()
	var ports []int
	for _, p := range s.cfg.ProxyPorts {
		if p.LAN {
			ports = append(ports, p.Port)
		}
	}
	s.mu.Unlock()
	if err := core.SyncPortFirewall(s.singBoxPath(), ports); err != nil {
		s.log("[port] 防火墙放行失败（局域网设备可能连不上）：" + err.Error())
	}
}
