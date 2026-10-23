package service

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"time"

	"proxysplit/internal/core"
)

// AI 线路代理（给本机其他程序用，比如 aigw 网关切换器启动的指纹浏览器）：本机回环、带账号密码的
// SOCKS5 / HTTP 混合代理，进来的所有连接一律走 AI 线路（POWER云 线路优先，没有就走当前节点），
// 没线路就拒绝，绝不直连。和 AI 劫持开关无关：内核在跑就有。
//
// 约定（其他程序读这个文件，不要猜端口）：<数据目录>/ai-proxy.json，即
// %APPDATA%\proxysplit\ai-proxy.json，内容见 AIProxyInfo。running=false / available=false 时不要用。

// aiProxyPreferredPort is tried first so the address rarely changes between runs.
const aiProxyPreferredPort = 18089

// AIProxyInfo is the ai-proxy.json contract (version 1).
type AIProxyInfo struct {
	Version   int    `json:"version"`
	Running   bool   `json:"running"`   // the core is up and listening
	Available bool   `json:"available"` // there is a line (false = every connection is refused)
	URL       string `json:"url"`       // socks5://user:pass@127.0.0.1:PORT
	HTTPURL   string `json:"httpUrl"`   // http://user:pass@127.0.0.1:PORT (same port, mixed)
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	Node      string `json:"node"`     // the line's name
	Official  bool   `json:"official"` // a POWER云 line (our exits); false = the user's own node
	PID       int    `json:"pid"`      // ProxySplit's process id
	UpdatedAt string `json:"updatedAt"`
}

// SetAIProxyFile sets where the contract file is written (App: data dir).
func (s *Service) SetAIProxyFile(path string) {
	s.mu.Lock()
	s.aiProxyFile = path
	s.mu.Unlock()
}

// AIProxy reports the current AI proxy.
func (s *Service) AIProxy() AIProxyInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.aiProxyState
}

// aiProxyLocked returns the AI proxy options for a core start / hot apply.
// Credentials are picked once per run of ProxySplit. The running core keeps
// its port (a hot apply must build the same config); a fresh start checks the
// port is still free and moves it otherwise — a taken port must never stop the
// whole proxy from starting. Caller holds s.mu.
func (s *Service) aiProxyLocked(out string) *core.AIProxy {
	if s.aiProxyUser == "" {
		s.aiProxyUser, s.aiProxyPass = "ai", randomHex(12)
	}
	if s.aiProxyPort == 0 || (!s.coreRunning() && !loopbackTCPFree(s.aiProxyPort)) {
		s.aiProxyPort = 0
		if loopbackTCPFree(aiProxyPreferredPort) {
			s.aiProxyPort = aiProxyPreferredPort
		} else if p, err := core.FreePort(); err == nil {
			s.aiProxyPort = p
		}
	}
	if s.aiProxyPort == 0 {
		return nil // no free port: no AI proxy, the core still starts
	}
	return &core.AIProxy{Port: s.aiProxyPort, User: s.aiProxyUser, Pass: s.aiProxyPass, Outbound: out}
}

// coreRunning tolerates a Service without a core (unit tests).
func (s *Service) coreRunning() bool { return s.core != nil && s.core.Running() }

// noteAIProxyLocked records the started (p != nil) or stopped (nil) AI proxy
// and rewrites the contract file. Caller holds s.mu.
func (s *Service) noteAIProxyLocked(p *core.AIProxy) {
	st := AIProxyInfo{Version: 1, Host: "127.0.0.1", PID: os.Getpid(), UpdatedAt: time.Now().Format(time.RFC3339)}
	if p != nil {
		st.Running = true
		st.Available = p.Outbound != "reject"
		st.Port, st.Username, st.Password = p.Port, p.User, p.Pass
		st.URL = fmt.Sprintf("socks5://%s:%s@127.0.0.1:%d", p.User, p.Pass, p.Port)
		st.HTTPURL = fmt.Sprintf("http://%s:%s@127.0.0.1:%d", p.User, p.Pass, p.Port)
		if n := s.aiNodeLocked(""); n != nil && st.Available {
			st.Node, st.Official = n.Name, true
		} else if n := s.activeNodeLocked(""); n != nil && st.Available {
			st.Node = n.Name
		}
	}
	s.aiProxyState = st
	if s.aiProxyFile == "" {
		return
	}
	raw, _ := json.MarshalIndent(st, "", "  ")
	if err := os.MkdirAll(filepath.Dir(s.aiProxyFile), 0o755); err == nil {
		tmp := s.aiProxyFile + ".tmp"
		if os.WriteFile(tmp, raw, 0o600) == nil {
			_ = os.Rename(tmp, s.aiProxyFile)
		}
	}
}

func loopbackTCPFree(port int) bool {
	l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return false
	}
	l.Close()
	return true
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
