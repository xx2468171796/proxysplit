package accel

import (
	"errors"
	"sync"
	"time"
)

// Mode 是 Claude Code 当前的走法
type Mode string

const (
	ModeOfficial Mode = "official" // 官方默认：不改 Claude Code 配置
	ModeEncode   Mode = "encode"   // 编码模式：Claude Code 请求交给本机编码端
)

// Env 由 ProxySplit 提供当前环境
type Env struct {
	Socks    func() string              // 加速专用本机入口；"" = 代理没开 / 功能关闭
	Line     func() string              // Claude Code 所走线路的标识；变了 = 换线路
	Settings func() (off, autoOff bool) // 功能关闭、自动切换关闭
}

// State 给界面看
type State struct {
	Mode         Mode      `json:"mode"`
	Manual       Mode      `json:"manual"` // 用户手动选的（"" = 跟随自动）
	Auto         bool      `json:"auto"`
	Enabled      bool      `json:"enabled"`
	Reason       string    `json:"reason"`
	Relay        string    `json:"relay"`
	RTTms        int64     `json:"rttMs"`
	GatewayInUse bool      `json:"gatewayInUse"`
	Handshake    string    `json:"handshake"` // 中继当前连官方用的握手（cc-follow 跟进的 Claude Code 版本）
	Addr         string    `json:"addr"`
	Since        time.Time `json:"since"`
	Stats        Stats     `json:"stats"`
}

// Switcher 在「官方默认」和「编码模式」之间切换：
// 自动（默认）= 当前线路的落地签名验过且中继通 → 编码，否则官方；手动选择在同一条线路上优先。
type Switcher struct {
	eng  *Engine
	cfg  *ClaudeSettings
	env  Env
	logf func(string, ...any)

	mu         sync.Mutex
	st         State
	manual     Mode
	manualLine string
	fails      int
	lastKey    string
	nextProbe  time.Time
	kick       chan struct{}
	quit       chan struct{}
	done       chan struct{}
}

const (
	probeEncode   = 30 * time.Second // 编码模式下多久复查一次中继
	probeOfficial = 60 * time.Second // 官方默认下多久探一次能不能加速
	failsToDrop   = 2                // 编码模式连续失败几次才退回官方（防抖）
)

func NewSwitcher(eng *Engine, cfg *ClaudeSettings, env Env, logf func(string, ...any)) *Switcher {
	if logf == nil {
		logf = func(string, ...any) {}
	}
	return &Switcher{eng: eng, cfg: cfg, env: env, logf: logf, st: State{Mode: ModeOfficial, Since: time.Now()},
		kick: make(chan struct{}, 1), quit: make(chan struct{}), done: make(chan struct{})}
}

// Run 阻塞运行，直到 Shutdown
func (s *Switcher) Run() {
	defer close(s.done)
	// 上次异常退出留下的编码配置：先还原，再按当前情况重新判断
	if err := s.cfg.Restore(); err != nil {
		s.logf("[加速] 还原 Claude Code 配置失败：%v", err)
	}
	t := time.NewTicker(3 * time.Second)
	defer t.Stop()
	for {
		s.tick()
		select {
		case <-s.quit:
			return
		case <-s.kick:
		case <-t.C:
		}
	}
}

// Kick 环境变了（启动 / 停止代理、换节点、改设置）：立即重新判断
func (s *Switcher) Kick() {
	s.mu.Lock()
	s.nextProbe = time.Time{}
	s.mu.Unlock()
	select {
	case s.kick <- struct{}{}:
	default:
	}
}

// SetManual 用户点了「编码模式」/「恢复官方默认」；"" = 回到自动
func (s *Switcher) SetManual(m Mode) {
	s.mu.Lock()
	s.manual = m
	s.manualLine = s.env.Line()
	s.mu.Unlock()
	s.Kick()
}

func (s *Switcher) State() State {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.st
	st.Manual = s.manual
	st.Addr = s.eng.Addr()
	st.Stats = s.eng.Stats()
	return st
}

// Shutdown 退出 / 停止时一律恢复官方默认
func (s *Switcher) Shutdown() {
	select {
	case <-s.quit:
	default:
		close(s.quit)
		<-s.done
	}
	s.eng.SetUsable(false)
	if err := s.cfg.Restore(); err != nil {
		s.logf("[加速] 退出时还原 Claude Code 配置失败：%v", err)
	}
}

func (s *Switcher) tick() {
	off, autoOff := s.env.Settings()
	socks := s.env.Socks()
	line := s.env.Line()
	key := socks + "|" + line
	s.mu.Lock()
	if s.manual != "" && s.manualLine != line {
		s.manual = "" // 换了线路：手动选择失效，回到自动
	}
	manual := s.manual
	changed := key != s.lastKey
	s.lastKey = key
	due := changed || time.Now().After(s.nextProbe)
	cur := s.st.Mode
	s.mu.Unlock()

	switch {
	case off:
		s.toOfficial("加速功能已关闭", "", 0)
		return
	case socks == "":
		s.toOfficial("代理未开启", "", 0)
		return
	case manual == ModeOfficial:
		s.toOfficial("已手动恢复官方默认", "", 0)
		return
	case manual == "" && autoOff:
		s.toOfficial("自动切换已关闭", "", 0)
		return
	}
	if !due {
		return
	}
	h, err := s.eng.Hello()
	if err == nil {
		_, err = s.eng.cfg.Token()
		if err != nil {
			err = errors.New("加速令牌不可用：" + err.Error())
		}
	}
	if err == nil && !h.FallbackOK {
		// 版本闸门：官方当前握手（中继签名告知）与本机兜底握手不同，中继一断编码端就只能拿旧指纹连官方——
		// 宁可不加速，让 Claude Code 自己直连官方；升级 ProxySplit 后自动恢复。不防抖：一次就退
		s.mu.Lock()
		s.st.Handshake = h.Handshake
		s.mu.Unlock()
		s.toOfficial(staleReason(h.Handshake), h.Relay, h.RTT.Milliseconds())
		return
	}
	s.mu.Lock()
	if err == nil {
		s.fails = 0
		s.nextProbe = time.Now().Add(probeEncode)
	} else {
		s.fails++
		s.nextProbe = time.Now().Add(probeOfficial)
		if cur == ModeEncode {
			s.nextProbe = time.Now().Add(5 * time.Second) // 编码中出错：快点复查
		}
	}
	fails := s.fails
	s.mu.Unlock()
	switch {
	case err == nil:
		s.toEncode(h)
	case cur == ModeEncode && fails < failsToDrop && !changed:
		s.logf("[加速] 中继检查失败（%d/%d）：%v", fails, failsToDrop, err)
	default:
		s.toOfficial("当前线路不支持加速："+err.Error(), "", 0)
	}
}

func (s *Switcher) toEncode(h HelloResult) {
	s.eng.SetUsable(true)
	err := s.cfg.Apply("http://" + s.eng.Addr())
	s.mu.Lock()
	defer s.mu.Unlock()
	if errors.Is(err, ErrGatewayInUse) {
		s.st.GatewayInUse = true
		s.setMode(ModeOfficial, "Claude Code 已在使用其他网关，不接管")
		return
	}
	if err != nil {
		s.setMode(ModeOfficial, "写 Claude Code 配置失败："+err.Error())
		return
	}
	s.st.GatewayInUse = false
	s.st.Relay, s.st.RTTms, s.st.Handshake = h.Relay, h.RTT.Milliseconds(), h.Handshake
	s.setMode(ModeEncode, "落地 "+h.Relay+" 已验证")
}

func staleReason(handshake string) string {
	if handshake == "" {
		return "落地中继版本较旧，确认不了官方当前连接方式，先不加速"
	}
	return "Claude Code 官方连接方式已更新（" + handshake + "），本机 ProxySplit 还没跟上，先不加速；升级到最新版后自动恢复"
}

func (s *Switcher) toOfficial(reason, relay string, rtt int64) {
	// 编码端不关：之前打开、仍指向它的 Claude Code 会话照常能用（中继不可用时它原样直连官方）
	s.eng.SetUsable(false)
	err := s.cfg.Restore()
	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil {
		reason += "（还原配置失败：" + err.Error() + "）"
	}
	s.st.Relay, s.st.RTTms = relay, rtt
	s.setMode(ModeOfficial, reason)
}

func (s *Switcher) setMode(m Mode, reason string) {
	off, autoOff := s.env.Settings()
	s.st.Enabled, s.st.Auto = !off, !autoOff
	if s.st.Mode != m {
		s.logf("[加速] %s → %s：%s", s.st.Mode, m, reason)
		s.st.Since = time.Now()
	}
	s.st.Mode, s.st.Reason = m, reason
}
