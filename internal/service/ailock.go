package service

import (
	"encoding/binary"
	"math"
	"net"
	"strings"
	"sync"
	"time"

	"proxysplit/internal/aiguard"
)

// AI 访问锁跟着代理走（业主 2026-10-27）：
//   - 代理启动后先预热 aiLockWarmup，再经隧道试解析一次 AI 域名，通了才把锁切到隧道（AI 放行）；
//   - 之后每 aiLockProbeEvery 检测一次，一失败（断网 / 节点挂了）马上切回回环（AI 锁住），恢复了再放行；
//   - 用户停止代理 / 退出时先切回回环，等 aiLockStopDelay 再停内核；
//   - 界面经 AILockStatus 显示阶段和倒计时。
const (
	aiLockWarmup     = 10 * time.Second
	aiLockStopDelay  = 5 * time.Second
	aiLockProbeEvery = 15 * time.Second
	aiLockRetryEvery = 5 * time.Second // while down: notice recovery sooner
	aiLockProbeHost  = "api.anthropic.com"
)

// AI lock phases shown in the UI.
const (
	aiPhaseLocked   = "locked"   // proxy not running: AI blocked
	aiPhaseWarming  = "warming"  // proxy started, waiting before the first probe
	aiPhaseTunnel   = "tunnel"   // probe passed: AI resolves through the line
	aiPhaseDown     = "down"     // probe failed: AI blocked until it passes again
	aiPhaseStopping = "stopping" // locked, waiting before the proxy stops
)

type aiLockState struct {
	phase string
	until time.Time     // end of warming / stopping
	open  bool          // last probe passed: the lock may point into the tunnel
	stop  chan struct{} // ends the running core's probe loop
}

// AILockStatus is the AI lock's phase for the UI ("" = no lock on this PC).
type AILockStatus struct {
	Phase   string `json:"phase"`
	Seconds int    `json:"seconds"` // warming / stopping: seconds left
}

// AILockStatus reports the phase and countdown.
func (s *Service) AILockStatus() AILockStatus {
	if !aiguard.Present() {
		return AILockStatus{}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	st := AILockStatus{Phase: s.aiLock.phase}
	if st.Phase == "" || (!s.core.Running() && st.Phase != aiPhaseStopping) {
		st.Phase = aiPhaseLocked
	}
	if st.Phase == aiPhaseWarming || st.Phase == aiPhaseStopping {
		st.Seconds = max(0, int(math.Ceil(time.Until(s.aiLock.until).Seconds())))
	}
	return st
}

// AILockServer is where the AI lock must send AI names right now: into the
// tunnel while a guarded core runs and its last probe passed, else the dead
// loopback address (locked).
func (s *Service) AILockServer() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.aiLock.open && s.aiGuardOut != "" && s.core.Running() {
		return aiguard.TunnelServer
	}
	return aiguard.LockedServer
}

// startAILockWatchLocked begins the warm-up and probe loop for a started
// guarded core. Caller holds s.mu.
func (s *Service) startAILockWatchLocked() {
	s.endAILockWatchLocked()
	stop := make(chan struct{})
	s.aiLock = aiLockState{phase: aiPhaseWarming, until: time.Now().Add(aiLockWarmup), stop: stop}
	go s.watchAILock(stop)
}

// endAILockWatchLocked stops the probe loop and closes the lock. Caller holds s.mu.
func (s *Service) endAILockWatchLocked() {
	if s.aiLock.stop != nil {
		close(s.aiLock.stop)
	}
	s.aiLock = aiLockState{phase: aiPhaseLocked}
}

func (s *Service) watchAILock(stop chan struct{}) {
	wait := aiLockWarmup
	for {
		select {
		case <-stop:
			return
		case <-time.After(wait):
		}
		ok := probeTunnelDNS()
		s.mu.Lock()
		if s.aiLock.stop != stop { // the core stopped / restarted meanwhile
			s.mu.Unlock()
			return
		}
		changed := s.aiLock.open != ok || s.aiLock.phase == aiPhaseWarming
		s.aiLock.open = ok
		s.aiLock.phase, wait = aiPhaseTunnel, aiLockProbeEvery
		if !ok {
			s.aiLock.phase, wait = aiPhaseDown, aiLockRetryEvery
		}
		s.mu.Unlock()
		if changed {
			if !ok {
				s.log("[AI] 隧道检测失败（断网或节点不可用）：AI 已锁住，恢复后自动放行")
			}
			s.SyncAILock()
			if !ok {
				aiguard.FlushCache()
			}
		}
	}
}

// lockAIBeforeStop (user stop / quit): close the lock first, then give it
// aiLockStopDelay before the core goes. Caller holds lifecycleMu.
func (s *Service) lockAIBeforeStop() {
	if !s.core.Running() || !aiguard.Present() {
		return
	}
	s.mu.Lock()
	if s.aiGuardOut == "" {
		s.mu.Unlock()
		return
	}
	s.endAILockWatchLocked()
	until := time.Now().Add(aiLockStopDelay)
	s.aiLock.phase, s.aiLock.until = aiPhaseStopping, until
	s.mu.Unlock()
	s.SyncAILock()
	aiguard.FlushCache()
	s.log("[AI] 已先锁住 AI，5 秒后停止代理")
	time.Sleep(time.Until(until))
}

// aiLockMu serialises lock switches, so a start and a stop racing each other
// still end on the server matching the final core state.
var aiLockMu sync.Mutex

// InstallAILock adds (or refreshes) the AI lock at AILockServer.
func (s *Service) InstallAILock() error {
	aiLockMu.Lock()
	defer aiLockMu.Unlock()
	return aiguard.Install(s.AILockServer())
}

// RemoveAILock deletes the AI lock (劫持模式 turned off in the app).
func (s *Service) RemoveAILock() error {
	aiLockMu.Lock()
	defer aiLockMu.Unlock()
	return aiguard.Remove()
}

// AILockInstalled: the AI lock exists and points where it should right now.
func (s *Service) AILockInstalled() bool { return aiguard.Installed(s.AILockServer()) }

// SyncAILock points an existing AI lock at AILockServer. It never adds or
// removes the lock — that is the App's 劫持模式 decision.
func (s *Service) SyncAILock() {
	aiLockMu.Lock()
	defer aiLockMu.Unlock()
	if !aiguard.Present() {
		return
	}
	want := s.AILockServer()
	if aiguard.Installed(want) {
		return
	}
	if err := aiguard.Install(want); err != nil {
		s.log("[AI] 切换 AI 访问锁失败：" + err.Error())
		return
	}
	if want == aiguard.TunnelServer {
		s.log("[AI] 隧道检测通过：AI 域名改由隧道解析，走线路访问")
	} else {
		s.log("[AI] AI 访问锁已锁上：AI 网站打不开（不会用本机 IP）")
	}
}

// probeTunnelDNS asks the tunnel's DNS (the address the lock would use) for
// an AI name, twice at most: true = answered with an address, so AI resolves
// through the line once the lock points there.
func probeTunnelDNS() bool {
	for range 2 {
		if lookupA(net.JoinHostPort(aiguard.TunnelServer, "53"), aiLockProbeHost, 3*time.Second) {
			return true
		}
	}
	return false
}

// lookupA sends one plain A query and reports whether it got an answer record.
func lookupA(server, name string, timeout time.Duration) bool {
	conn, err := net.DialTimeout("udp", server, timeout)
	if err != nil {
		return false
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(timeout))
	q := []byte{0xa1, 0x5e, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0} // id, RD, 1 question
	for _, label := range strings.Split(name, ".") {
		q = append(append(q, byte(len(label))), label...)
	}
	q = append(q, 0, 0, 1, 0, 1) // root, type A, class IN
	if _, err := conn.Write(q); err != nil {
		return false
	}
	buf := make([]byte, 1500)
	n, err := conn.Read(buf)
	if err != nil || n < 12 || buf[0] != q[0] || buf[1] != q[1] {
		return false
	}
	return buf[3]&0x0f == 0 && binary.BigEndian.Uint16(buf[6:8]) > 0
}
