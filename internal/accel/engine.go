package accel

import (
	"bufio"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/net/proxy"
)

// 与中继一致的时间参数（accel/src/stream.rs）
const (
	deadAfter    = 8 * time.Second  // 多久收不到任何帧判断线
	resumeBudget = 80 * time.Second // 最多尝试续传多久（中继宽限 90 秒）
	headTimeout  = 10 * time.Second
	dialTimeout  = 10 * time.Second
	idleMax      = 60 * time.Second // 池里连接闲置超过就不再用
)

// Config 由 ProxySplit 注入
type Config struct {
	// ListenAddr 首选本机监听地址（固定端口，Claude Code 配置里写的就是它）；被占用时改用随机端口
	ListenAddr string
	// Socks 返回当前可用的本机代理入口（sing-box accel-in，经 Claude Code 所走的节点）；"" = 代理没开
	Socks func() string
	// Token 返回用户加速令牌（ProxySplit 服务端签发）
	Token func() (string, error)
	// RelayHost 中继的专用虚拟域名（落地机 sing-box 把它指到本机中继，其余回环 / 内网地址一律拒绝）。
	// 请求的 Host 头也必须写它：VM200 先嗅探 HTTP Host 再按域名路由，写别的名字匹配不到改写规则
	RelayHost string
	RelayPort uint16
	// UpstreamHost 官方主机（请求头 Host、兜底直连）
	UpstreamHost string
	// HelloKeys 落地身份公钥：打招呼签名能用其中之一验过 = 是我们的落地
	HelloKeys []ed25519.PublicKey
	Logf      func(format string, a ...any)
	// Dial 测试用：不为空时代替经代理入口拨号
	Dial func(host string, port uint16) (net.Conn, error)
}

// Stats 是给界面看的统计
type Stats struct {
	Requests   int64 `json:"requests"`
	Relayed    int64 `json:"relayed"`
	Direct     int64 `json:"direct"`
	Resumed    int64 `json:"resumed"`
	Errors     int64 `json:"errors"`
	Held       int64 `json:"held"`       // 兜底握手过期、没敢直连而让 Claude Code 重试的请求
	ReqBytes   int64 `json:"reqBytes"`   // 编码前请求体总量
	FrameBytes int64 `json:"frameBytes"` // 实际发出的帧总量
}

// Engine 是本机编码端
type Engine struct {
	cfg    Config
	ln     net.Listener
	addr   string
	store  *store
	pool   *pool
	usable atomic.Bool                     // 由切换器根据打招呼结果设置
	fb     atomic.Pointer[fallbackProfile] // 最近一次打招呼拿到、本机复刻得了的握手配置

	mu    sync.Mutex
	relay string                      // 当前落地名（打招呼得到）
	known map[string]map[Sha]struct{} // 各落地已有的请求体

	stats struct{ requests, relayed, direct, resumed, errors, held, reqBytes, frameBytes atomic.Int64 }
	wg    sync.WaitGroup
	quit  chan struct{}
}

func New(cfg Config) *Engine {
	if cfg.UpstreamHost == "" {
		cfg.UpstreamHost = "api.anthropic.com"
	}
	if cfg.RelayPort == 0 {
		cfg.RelayPort = 8896
	}
	if cfg.Logf == nil {
		cfg.Logf = func(string, ...any) {}
	}
	e := &Engine{cfg: cfg, store: newStore(256<<20, 512), known: map[string]map[Sha]struct{}{}, quit: make(chan struct{})}
	e.pool = &pool{dial: e.dialRelay}
	return e
}

// Start 开始监听，返回实际地址（127.0.0.1:端口）
func (e *Engine) Start() (string, error) {
	ln, err := net.Listen("tcp", e.cfg.ListenAddr)
	if err != nil {
		if ln, err = net.Listen("tcp", "127.0.0.1:0"); err != nil {
			return "", err
		}
	}
	e.ln, e.addr = ln, ln.Addr().String()
	e.wg.Add(2)
	go e.acceptLoop()
	go e.keeper()
	return e.addr, nil
}

func (e *Engine) Addr() string { return e.addr }

// SetUsable 由切换器调用：中继打招呼通过才让请求走中继，否则一律兜底直连
func (e *Engine) SetUsable(ok bool) { e.usable.Store(ok) }

func (e *Engine) Close() {
	select {
	case <-e.quit:
		return
	default:
	}
	close(e.quit)
	if e.ln != nil {
		e.ln.Close()
	}
	e.pool.closeAll()
	e.wg.Wait()
}

func (e *Engine) Stats() Stats {
	s := &e.stats
	return Stats{s.requests.Load(), s.relayed.Load(), s.direct.Load(), s.resumed.Load(), s.errors.Load(), s.held.Load(), s.reqBytes.Load(), s.frameBytes.Load()}
}

func (e *Engine) acceptLoop() {
	defer e.wg.Done()
	for {
		c, err := e.ln.Accept()
		if err != nil {
			select {
			case <-e.quit:
				return
			default:
			}
			time.Sleep(50 * time.Millisecond)
			continue
		}
		go e.serve(c)
	}
}

// keeper 保持 1 条预热好的中继连接（请求来了免握手），并淘汰闲置太久的
func (e *Engine) keeper() {
	defer e.wg.Done()
	t := time.NewTicker(20 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-e.quit:
			return
		case <-t.C:
		}
		e.pool.prune()
		if e.usable.Load() && e.pool.idleCount() == 0 {
			if pc, err := e.dialRelay(); err == nil {
				e.pool.put(pc)
			}
		}
	}
}

// ---- 打招呼：确认当前线路的落地是我们的、且中继连得通 ----

type HelloResult struct {
	Relay string        `json:"relay"`
	RTT   time.Duration `json:"rtt"`
	// Handshake 中继当前连官方用的握手配置名（如 claude-code-2.1.302，cc-follow 自动跟进）；旧中继不报 = ""
	Handshake string `json:"handshake"`
	// FallbackOK 中继交来的握手配置（指纹经签名担保）本机复刻得了：编码端可以按它自己连官方
	FallbackOK bool `json:"fallbackOk"`
	// FallbackErr 复刻不了的原因（官方换了需要改代码的东西）
	FallbackErr string `json:"fallbackErr,omitempty"`
}

// fallbackTrust 拿到握手配置后，这么久内中继连不上仍按它兜底直连（之后的打招呼会换成最新的）
const fallbackTrust = 2 * time.Hour

type fallbackProfile struct {
	p  *tlsProfile
	at time.Time
}

// fallback 兜底直连用的握手配置；nil = 没有（从没拿到、复刻不了或太久没确认）→ 不兜底
func (e *Engine) fallback() *tlsProfile {
	f := e.fb.Load()
	if f == nil || time.Since(f.at) > fallbackTrust {
		return nil
	}
	return f.p
}

// Hello 经当前代理入口给中继发随机数，验签通过返回落地名
func (e *Engine) Hello() (HelloResult, error) {
	var nb [16]byte
	_, _ = rand.Read(nb[:])
	nonce := hex.EncodeToString(nb[:])
	start := time.Now()
	c, err := e.dial(e.cfg.RelayHost, e.cfg.RelayPort)
	if err != nil {
		return HelloResult{}, err
	}
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(headTimeout))
	if _, err := fmt.Fprintf(c, "GET /__accel/hello?nonce=%s HTTP/1.1\r\nHost: %s\r\n\r\n", nonce, e.cfg.RelayHost); err != nil {
		return HelloResult{}, err
	}
	status, body, err := readSimpleResponse(bufio.NewReader(c))
	if err != nil {
		return HelloResult{}, err
	}
	if status != 200 {
		return HelloResult{}, fmt.Errorf("落地未提供身份（%d）", status)
	}
	var h struct {
		Relay string `json:"relay"`
		Sig   string `json:"sig"`
		TLS   struct {
			Name    string          `json:"name"`
			HS      string          `json:"hs"`
			Profile json.RawMessage `json:"profile"`
		} `json:"tls"`
		Sig2 string `json:"sig2"`
	}
	if err := json.Unmarshal(body, &h); err != nil {
		return HelloResult{}, errors.New("打招呼响应不合法")
	}
	sig, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(h.Sig, "="))
	if err != nil {
		return HelloResult{}, errors.New("签名不合法")
	}
	msg := []byte("accel-hello-v1|" + h.Relay + "|" + nonce)
	for _, k := range e.cfg.HelloKeys {
		if ed25519.Verify(k, msg, sig) {
			r := HelloResult{Relay: h.Relay, RTT: time.Since(start)}
			// 握手名和指纹只认 v2 签名覆盖的（0.6.2 起的中继）；旧中继 / 验不过 = 不知道官方当前握手，不兜底
			sig2, _ := base64.RawURLEncoding.DecodeString(strings.TrimRight(h.Sig2, "="))
			msg2 := []byte("accel-hello-v2|" + h.Relay + "|" + nonce + "|" + h.TLS.Name + "|" + h.TLS.HS)
			var fb *fallbackProfile
			if len(sig2) == ed25519.SignatureSize && ed25519.Verify(k, msg2, sig2) {
				r.Handshake = h.TLS.Name
				if p, err := parseProfile(h.TLS.Profile, h.TLS.HS); err != nil {
					r.FallbackErr = err.Error()
				} else {
					r.FallbackOK, fb = true, &fallbackProfile{p: p, at: time.Now()}
				}
			}
			e.mu.Lock()
			e.relay = h.Relay
			e.mu.Unlock()
			e.fb.Store(fb)
			return r, nil
		}
	}
	return HelloResult{}, errors.New("落地签名验不过（不是我们的节点）")
}

// ---- 本机服务：Claude Code 连进来 ----

func (e *Engine) serve(c net.Conn) {
	defer c.Close()
	if tc, ok := c.(*net.TCPConn); ok {
		_ = tc.SetNoDelay(true)
	}
	br := bufio.NewReaderSize(c, 256<<10)
	var pending *peeker
	for {
		if pending != nil {
			<-pending.done
			if pending.err != nil {
				return
			}
			pending = nil
		}
		req, err := readRequest(br)
		if err != nil {
			return
		}
		path, _, _ := strings.Cut(req.target, "?")
		if strings.HasPrefix(path, "/__accel/") {
			body := []byte("ok")
			if path == "/__accel/stats" {
				body, _ = json.Marshal(e.Stats())
			}
			if writeLocal(c, "200 OK", body) != nil || !req.keepAlive {
				return
			}
			continue
		}
		e.stats.requests.Add(1)
		head := rewriteHead(req.head, e.cfg.UpstreamHost)
		keep, handled := false, false
		if e.usable.Load() && len(req.body) > 0 {
			keep, handled, pending = e.viaRelay(c, br, req, head)
		}
		fb := e.fallback()
		switch {
		case handled:
		case fb == nil:
			// 没有中继交来、本机复刻得了的官方当前握手：不拿可能过期的指纹去连官方，让 Claude Code 稍后重试。
			// 切换器同时把 Claude Code 配置还原成官方默认，重开的会话由 Claude Code 自己直连
			e.stats.held.Add(1)
			keep = writeLocalJSON(c, "503 Service Unavailable", heldBody) == nil
		default:
			// pending 可能是中继路径起的 peeker（中继明确没发出去才会走到这里）：留着，下一轮先等它
			e.stats.direct.Add(1)
			keep = e.direct(c, req, head, fb)
		}
		if !keep || !req.keepAlive {
			return
		}
	}
}

// heldBody 是 Anthropic 错误格式：Claude Code 把 5xx 当临时错误自动重试，重试用完会把这段话显示给用户
var heldBody = []byte(`{"type":"error","error":{"type":"api_error","message":"ProxySplit 加速暂时不可用，且 Claude Code 官方连接方式已更新、本机版本还没跟上，为防风控没有改用本机直连。请重开 Claude Code（会自动直连官方），或把 ProxySplit 升级到最新版。"}}`)

func writeLocalJSON(w io.Writer, status string, body []byte) error {
	_, err := fmt.Fprintf(w, "HTTP/1.1 %s\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n%s", status, len(body), body)
	return err
}

func writeLocal(w io.Writer, status string, body []byte) error {
	_, err := fmt.Fprintf(w, "HTTP/1.1 %s\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: %d\r\n\r\n%s", status, len(body), body)
	return err
}

// peeker 在等响应期间盯着 Claude Code 那头：读到 EOF / 出错 = 用户走了；读到数据 = 下一个请求（不消费）
type peeker struct {
	done chan struct{}
	err  error
}

func startPeek(br *bufio.Reader) *peeker {
	p := &peeker{done: make(chan struct{})}
	go func() {
		_, p.err = br.Peek(1)
		close(p.done)
	}()
	return p
}

func (p *peeker) closed() bool {
	select {
	case <-p.done:
		return p.err != nil
	default:
		return false
	}
}

// ---- 经中继发送（可续传）----

type delivered int

const (
	deliveredDone delivered = iota
	deliveredNotSent
)

func (e *Engine) currentKnown() map[Sha]struct{} {
	e.mu.Lock()
	defer e.mu.Unlock()
	k := e.known[e.relay]
	if k == nil {
		k = map[Sha]struct{}{}
		e.known[e.relay] = k
	}
	return k
}

func (e *Engine) remember(sha Sha) {
	e.mu.Lock()
	defer e.mu.Unlock()
	k := e.known[e.relay]
	if k == nil {
		k = map[Sha]struct{}{}
		e.known[e.relay] = k
	}
	if len(k) > 8192 {
		clear(k)
	}
	k[sha] = struct{}{}
}

func (e *Engine) forgetAll() {
	e.mu.Lock()
	defer e.mu.Unlock()
	clear(e.known[e.relay])
}

func (e *Engine) encode(body []byte, full bool) (Encoded, error) {
	var allowed func(Sha) bool
	if full {
		allowed = func(Sha) bool { return false }
	} else {
		e.mu.Lock()
		known := make(map[Sha]struct{}, len(e.known[e.relay]))
		for k := range e.known[e.relay] {
			known[k] = struct{}{}
		}
		e.mu.Unlock()
		allowed = func(s Sha) bool { _, ok := known[s]; return ok }
	}
	var enc Encoded
	var err error
	if b, p, ok := bestBase(e.store.candidates(), body, allowed); ok && p >= minPrefix {
		enc, err = Encode(b.body, &b.sha, body)
	} else {
		enc, err = Encode(nil, nil, body)
	}
	if err == nil {
		e.store.insert(enc.TargetSha, body)
	}
	return enc, err
}

// viaRelay 返回 (客户端连接能否继续用, 是否已处理, 盯客户端的 peeker)；未处理 = 调用方兜底直连
func (e *Engine) viaRelay(client net.Conn, br *bufio.Reader, req *request, head []byte) (bool, bool, *peeker) {
	token, err := e.cfg.Token()
	if err != nil {
		e.cfg.Logf("加速令牌不可用，本次直连：%v", err)
		return false, false, nil
	}
	rid := newRid()
	full := false
	for attempt := 0; ; {
		enc, err := e.encode(req.body, full)
		if err != nil {
			return false, false, nil
		}
		pc, err := e.pool.get()
		if err != nil {
			e.cfg.Logf("连中继失败，本次直连：%v", err)
			return false, false, nil
		}
		chunked := ""
		if req.chunked {
			chunked = "X-Accel-Chunked: 1\r\n"
		}
		wrapper := fmt.Sprintf("POST /__accel/relay HTTP/1.1\r\nHost: %s\r\nX-Accel-Token: %s\r\nX-Accel-Rid: %s\r\nX-Accel-Head: %d\r\n%sContent-Length: %d\r\n\r\n",
			e.cfg.RelayHost, token, rid, len(head), chunked, len(head)+len(enc.Frame))
		_ = pc.c.SetWriteDeadline(time.Now().Add(headTimeout))
		_, werr := pc.c.Write(append(append([]byte(wrapper), head...), enc.Frame...))
		if werr != nil {
			pc.c.Close()
			if attempt < 2 {
				attempt++
				continue
			}
			return false, false, nil // 没写完整：中继不会处理半截请求，官方没收到
		}
		_ = pc.c.SetReadDeadline(time.Now().Add(headTimeout))
		h, herr := readRelayHead(pc.br)
		if herr != nil {
			// 请求发出后没等到回应头：先续传问中继收没收到，不能直接重发（可能重复计费）
			pc.c.Close()
			return e.deliver(client, br, nil, 0, rid, token, len(req.body), len(enc.Frame))
		}
		switch {
		case h.stream:
			e.remember(enc.TargetSha)
			return e.deliver(client, br, pc, h.owner, rid, token, len(req.body), len(enc.Frame))
		case h.code == "need-base" && !full:
			e.forgetAll()
			full = true
			e.pool.put(pc)
			continue
		case h.notSent:
			e.pool.put(pc)
			e.cfg.Logf("中继未送达（%s），本次直连", h.code)
			return false, false, nil
		default:
			pc.c.Close()
			e.stats.errors.Add(1)
			_ = writeLocal(client, "502 Bad Gateway", []byte("proxysplit-accel: relay "+h.code))
			return false, true, nil
		}
	}
}

// deliver 按帧把官方响应交给 Claude Code；隧道断了就续传（最多 resumeBudget）
func (e *Engine) deliver(client net.Conn, br *bufio.Reader, pc *pconn, owner uint16, rid, token string, reqBytes, frameBytes int) (bool, bool, *peeker) {
	pk := startPeek(br)
	var offset uint64
	h := sha256.New()
	var brokeAt time.Time
	if pc == nil {
		brokeAt = time.Now()
	}
	pooled := pc != nil
	attempt := 0
	finish := func(keep bool) (bool, bool, *peeker) { return keep, true, pk }
	giveUp := func(why string) (bool, bool, *peeker) {
		e.stats.errors.Add(1)
		e.cfg.Logf("请求 %s 失败：%s", rid, why)
		if offset == 0 {
			_ = writeLocal(client, "502 Bad Gateway", []byte("proxysplit-accel: "+why))
		}
		return false, true, pk
	}
	type result struct {
		f   frame
		err error
	}
	for {
		if pc == nil {
			if time.Since(brokeAt) > resumeBudget {
				return giveUp("续传超时")
			}
			wait := []time.Duration{0, 250, 500, 1000, 2000}[min(attempt, 4)] * time.Millisecond
			select {
			case <-time.After(wait):
			case <-pk.done:
				if pk.err != nil {
					e.cancel(rid, token)
					return finish(false)
				}
			}
			attempt++
			port := e.cfg.RelayPort
			if owner != 0 {
				port = owner
			}
			nc, rh, err := e.resumeConn(port, rid, token, offset)
			if err != nil {
				e.cfg.Logf("续传 %s 失败：%v", rid, err)
				continue
			}
			switch {
			case rh.stream:
				e.stats.resumed.Add(1)
				pc, pooled, brokeAt, attempt = nc, false, time.Time{}, 0
				if rh.owner != 0 {
					owner = rh.owner
				}
			case rh.code == "owner-elsewhere" && rh.owner != 0:
				nc.c.Close()
				owner = rh.owner
			case rh.code == "unknown" && rh.notSent && offset == 0:
				nc.c.Close()
				return false, false, pk // 中继从没见过这个请求：安全，兜底直连
			default:
				nc.c.Close()
				return giveUp("续传失败：" + rh.code)
			}
			continue
		}
		ch := make(chan result, 1)
		_ = pc.c.SetReadDeadline(time.Now().Add(deadAfter))
		go func(r *bufio.Reader) { f, err := readFrame(r); ch <- result{f, err} }(pc.br)
		var res result
		select {
		case res = <-ch:
		case <-pk.done:
			if pk.err != nil { // 用户走了：通知中继停止读官方
				pc.c.Close()
				e.cancel(rid, token)
				return finish(false)
			}
			res = <-ch // 客户端发来下一个请求（不消费），继续交付
		}
		if res.err != nil {
			pc.c.Close()
			pc, brokeAt = nil, time.Now()
			continue
		}
		switch res.f.kind {
		case frameData:
			if _, err := client.Write(res.f.data); err != nil {
				pc.c.Close()
				e.cancel(rid, token)
				return finish(false)
			}
			h.Write(res.f.data)
			offset += uint64(len(res.f.data))
		case frameKeep:
		case frameEnd:
			var sum Sha
			copy(sum[:], h.Sum(nil))
			if res.f.code == endNotSent && offset == 0 {
				if pooled {
					e.pool.put(pc)
				} else {
					pc.c.Close()
				}
				return false, false, pk
			}
			if res.f.total != offset || res.f.sha != sum {
				pc.c.Close()
				return giveUp(fmt.Sprintf("结束校验不符：中继 %d 字节，收到 %d", res.f.total, offset))
			}
			if res.f.code != endOk {
				pc.c.Close()
				return giveUp("上游结束码 " + strconv.Itoa(int(res.f.code)))
			}
			if pooled {
				_ = pc.c.SetDeadline(time.Time{})
				e.pool.put(pc)
			} else {
				pc.c.Close()
			}
			e.stats.relayed.Add(1)
			e.stats.reqBytes.Add(int64(reqBytes))
			e.stats.frameBytes.Add(int64(frameBytes))
			return finish(!res.f.close)
		}
	}
}

func (e *Engine) resumeConn(port uint16, rid, token string, offset uint64) (*pconn, relayHead, error) {
	c, err := e.dial(e.cfg.RelayHost, port)
	if err != nil {
		return nil, relayHead{}, err
	}
	pc := &pconn{c: c, br: bufio.NewReaderSize(c, 64<<10)}
	_ = c.SetDeadline(time.Now().Add(headTimeout))
	if _, err := fmt.Fprintf(c, "GET /__accel/resume?rid=%s&offset=%d HTTP/1.1\r\nHost: %s\r\nX-Accel-Token: %s\r\n\r\n", rid, offset, e.cfg.RelayHost, token); err != nil {
		c.Close()
		return nil, relayHead{}, err
	}
	h, err := readRelayHead(pc.br)
	if err != nil {
		c.Close()
		return nil, relayHead{}, err
	}
	_ = c.SetDeadline(time.Time{})
	return pc, h, nil
}

// cancel 尽力通知中继取消上游（不等结果）
func (e *Engine) cancel(rid, token string) {
	go func() {
		pc, err := e.pool.get()
		if err != nil {
			return
		}
		_ = pc.c.SetDeadline(time.Now().Add(headTimeout))
		if _, err := fmt.Fprintf(pc.c, "POST /__accel/cancel?rid=%s HTTP/1.1\r\nHost: %s\r\nX-Accel-Token: %s\r\nContent-Length: 0\r\n\r\n", rid, e.cfg.RelayHost, token); err != nil {
			pc.c.Close()
			return
		}
		if _, _, err := readSimpleResponse(pc.br); err != nil {
			pc.c.Close()
			return
		}
		_ = pc.c.SetDeadline(time.Time{})
		e.pool.put(pc)
	}()
}

// ---- 到中继的连接池 ----

type pconn struct {
	c     net.Conn
	br    *bufio.Reader
	since time.Time
}

type pool struct {
	mu   sync.Mutex
	idle []*pconn
	dial func() (*pconn, error)
}

func (p *pool) get() (*pconn, error) {
	p.mu.Lock()
	for len(p.idle) > 0 {
		pc := p.idle[len(p.idle)-1]
		p.idle = p.idle[:len(p.idle)-1]
		if time.Since(pc.since) < idleMax {
			p.mu.Unlock()
			return pc, nil
		}
		pc.c.Close()
	}
	p.mu.Unlock()
	return p.dial()
}

func (p *pool) put(pc *pconn) {
	pc.since = time.Now()
	_ = pc.c.SetDeadline(time.Time{})
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.idle) >= 4 {
		pc.c.Close()
		return
	}
	p.idle = append(p.idle, pc)
}

func (p *pool) prune() {
	p.mu.Lock()
	defer p.mu.Unlock()
	kept := p.idle[:0]
	for _, pc := range p.idle {
		if time.Since(pc.since) < idleMax {
			kept = append(kept, pc)
		} else {
			pc.c.Close()
		}
	}
	p.idle = kept
}

func (p *pool) idleCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.idle)
}

func (p *pool) closeAll() {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, pc := range p.idle {
		pc.c.Close()
	}
	p.idle = nil
}

// dialRelay 经代理入口连中继，建连即交换一次数据「打通」（经 Hysteria2 落地的连接闲置 ≥10 秒才发首包会被静默丢弃）
func (e *Engine) dialRelay() (*pconn, error) {
	c, err := e.dial(e.cfg.RelayHost, e.cfg.RelayPort)
	if err != nil {
		return nil, err
	}
	pc := &pconn{c: c, br: bufio.NewReaderSize(c, 256<<10), since: time.Now()}
	_ = c.SetDeadline(time.Now().Add(headTimeout))
	if _, err := io.WriteString(c, "GET /__accel/health HTTP/1.1\r\nHost: "+e.cfg.RelayHost+"\r\n\r\n"); err != nil {
		c.Close()
		return nil, err
	}
	if status, _, err := readSimpleResponse(pc.br); err != nil || status != 200 {
		c.Close()
		if err == nil {
			err = fmt.Errorf("中继健康检查 %d", status)
		}
		return nil, err
	}
	_ = c.SetDeadline(time.Time{})
	return pc, nil
}

// dial 经本机代理入口（sing-box accel-in，走 Claude Code 所用的节点）拨号
func (e *Engine) dial(host string, port uint16) (net.Conn, error) {
	if e.cfg.Dial != nil {
		return e.cfg.Dial(host, port)
	}
	socks := ""
	if e.cfg.Socks != nil {
		socks = e.cfg.Socks()
	}
	if socks == "" {
		return nil, errors.New("代理没开")
	}
	return dialVia(socks, host, port)
}

func dialVia(socks, host string, port uint16) (net.Conn, error) {
	d, err := proxy.SOCKS5("tcp", socks, nil, &net.Dialer{Timeout: dialTimeout})
	if err != nil {
		return nil, err
	}
	type result struct {
		c   net.Conn
		err error
	}
	ch := make(chan result, 1)
	go func() {
		c, err := d.Dial("tcp", net.JoinHostPort(host, strconv.Itoa(int(port))))
		ch <- result{c, err}
	}()
	select {
	case r := <-ch:
		if r.err == nil {
			if tc, ok := r.c.(*net.TCPConn); ok {
				_ = tc.SetNoDelay(true)
			}
		}
		return r.c, r.err
	case <-time.After(dialTimeout):
		go func() {
			if r := <-ch; r.c != nil {
				r.c.Close()
			}
		}()
		return nil, errors.New("连接超时")
	}
}

// newRid 生成请求 ID（32 位十六进制）
func newRid() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
