// Package engine implements per-application TCP redirection. Matched processes'
// outbound TCP connections are transparently NATed to a local redirector, which
// forwards them through the bundled core's SOCKS inbound. Everything else is
// re-injected untouched, so unmatched apps are unaffected.
package engine

import (
	"fmt"
	"io"
	"net"
	"net/netip"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/net/proxy"

	"proxysplit/internal/divert"
	"proxysplit/internal/proc"
)

var loopback = netip.MustParseAddr("127.0.0.1")

// loopbackIfIdx is the Windows loopback pseudo-interface index used when
// re-injecting the redirected forward packets.
const loopbackIfIdx = 1

// Stats is a snapshot of engine counters.
type Stats struct {
	Running     bool  `json:"running"`
	ActiveConns int64 `json:"activeConns"`
	TotalConns  int64 `json:"totalConns"`
	Tracked     int   `json:"tracked"`
	UpBytes     int64 `json:"upBytes"`
	DownBytes   int64 `json:"downBytes"`
}

// Engine owns the WinDivert handle, the redirector listener and the conntrack.
type Engine struct {
	dllPath   string
	log       func(string)
	blockQUIC bool // drop matched apps' UDP/443 so they fall back to TCP

	matcher *Matcher
	ct      *conntrack
	lookup  *proc.Lookup
	dialers map[string]proxy.Dialer // upstream key -> dialer (line's SOCKS, or Direct)

	mu        sync.Mutex
	running   bool
	handle    *divert.Handle
	ln        net.Listener
	redirPort uint16
	stopCh    chan struct{}

	activeConns int64
	totalConns  int64
	upBytes     int64
	downBytes   int64

	captured    int64        // total packets pulled off the WinDivert handle
	firstLogged int32        // atomic once-guard for the "capture works" log
	directSeen  sync.Map     // exe base name -> logged (dedupe the "went direct" diagnostic)
	captureWarn atomic.Value // string: set when WinDivert Open succeeded but no packets flow
}

// Captured returns the total packets pulled off the WinDivert handle since Start.
func (e *Engine) Captured() int64 { return atomic.LoadInt64(&e.captured) }

// CaptureWarn returns a non-empty warning when WinDivert opened but isn't
// actually capturing (another VPN/AV eating packets) — "" when healthy.
func (e *Engine) CaptureWarn() string {
	if v, ok := e.captureWarn.Load().(string); ok {
		return v
	}
	return ""
}

// New creates an Engine. dllPath points at WinDivert.dll; matcher holds the app
// rules; log may be nil. Call SetUpstreams before Start.
func New(dllPath string, matcher *Matcher, log func(string)) *Engine {
	if log == nil {
		log = func(string) {}
	}
	return &Engine{
		dllPath: dllPath,
		log:     log,
		matcher: matcher,
		ct:      newConntrack(),
		lookup:  proc.NewLookup(250 * time.Millisecond),
		dialers: map[string]proxy.Dialer{},
	}
}

// SetUpstreams maps each line's upstream key to a SOCKS address (host:port). An
// empty address selects a direct dialer (used for tests). Must be called before
// Start; matched apps whose target has no dialer fall back to direct.
func (e *Engine) SetUpstreams(upstreams map[string]string) error {
	d := map[string]proxy.Dialer{}
	for key, addr := range upstreams {
		if addr == "" {
			d[key] = proxy.Direct
			continue
		}
		dl, err := proxy.SOCKS5("tcp", addr, nil, proxy.Direct)
		if err != nil {
			return fmt.Errorf("socks dialer for %q: %w", key, err)
		}
		d[key] = dl
	}
	e.mu.Lock()
	e.dialers = d
	e.mu.Unlock()
	return nil
}

// Matcher exposes the rule set so callers can update apps at runtime.
func (e *Engine) Matcher() *Matcher { return e.matcher }

// SetBlockQUIC toggles dropping matched apps' QUIC (UDP/443). Must be set before
// Start (it selects the capture filter).
func (e *Engine) SetBlockQUIC(v bool) { e.blockQUIC = v }

// Running reports engine state.
func (e *Engine) Running() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.running
}

// Stats returns a counter snapshot.
func (e *Engine) Stats() Stats {
	return Stats{
		Running:     e.Running(),
		ActiveConns: atomic.LoadInt64(&e.activeConns),
		TotalConns:  atomic.LoadInt64(&e.totalConns),
		Tracked:     e.ct.count(),
		UpBytes:     atomic.LoadInt64(&e.upBytes),
		DownBytes:   atomic.LoadInt64(&e.downBytes),
	}
}

// Start loads WinDivert, opens the redirector and begins diverting.
func (e *Engine) Start() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.running {
		return fmt.Errorf("engine already running")
	}

	// Local redirector on loopback.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("redirector listen: %w", err)
	}
	e.ln = ln
	e.redirPort = uint16(ln.Addr().(*net.TCPAddr).Port)

	// Never redirect our own process.
	e.matcher.ExcludePID(uint32(os.Getpid()))

	if err := divert.Load(e.dllPath); err != nil {
		ln.Close()
		return err
	}
	tcpFilter := fmt.Sprintf(
		"(tcp and ((outbound and ip.DstAddr != 127.0.0.1) or (ip.SrcAddr == 127.0.0.1 and tcp.SrcPort == %d)))",
		e.redirPort,
	)
	filter := "ip and " + tcpFilter
	if e.blockQUIC {
		// Also capture outbound QUIC (UDP/443) so we can drop it for matched apps.
		filter = "ip and (" + tcpFilter + " or (udp and outbound and udp.DstPort == 443))"
	}
	h, err := divert.Open(filter, divert.LayerNetwork, 0, 0)
	if err != nil {
		ln.Close()
		return fmt.Errorf("WinDivertOpen (needs admin): %w", err)
	}
	e.handle = h
	e.stopCh = make(chan struct{})
	e.running = true
	atomic.StoreInt64(&e.captured, 0)
	atomic.StoreInt32(&e.firstLogged, 0)
	e.directSeen = sync.Map{}
	e.captureWarn.Store("")

	go e.serve(ln)
	go e.divertLoop(h)
	go e.gcLoop()

	// Self-check: if WinDivert captured nothing after a few seconds, its Open
	// succeeded but a security product / another WinDivert-based VPN is likely
	// eating the packets — the #1 cause of "selected apps don't get proxied".
	go func() {
		time.Sleep(4 * time.Second)
		if e.Running() && atomic.LoadInt64(&e.captured) == 0 {
			warn := "WinDivert 抓不到流量 —— 很可能有其他代理/VPN(v2rayN、Clash TUN 等)或杀软在占用。请退出其它代理工具后重启本程序。"
			e.captureWarn.Store(warn)
			e.log("[engine] ⚠ " + warn)
		}
	}()

	e.log(fmt.Sprintf("[engine] 分流引擎已启动,redirector 127.0.0.1:%d,%d 条上游线路", e.redirPort, len(e.dialers)))
	return nil
}

// Stop tears down the handle and listener.
func (e *Engine) Stop() {
	e.mu.Lock()
	defer e.mu.Unlock()
	if !e.running {
		return
	}
	e.running = false
	close(e.stopCh)
	if e.handle != nil {
		e.handle.Close()
		e.handle = nil
	}
	if e.ln != nil {
		e.ln.Close()
		e.ln = nil
	}
	e.log("[engine] stopped")
}

// divertLoop is the single-threaded capture/rewrite/reinject loop.
func (e *Engine) divertLoop(h *divert.Handle) {
	buf := make([]byte, 65535)
	var addr divert.Address
	for {
		n, err := h.Recv(buf, &addr)
		if err != nil {
			select {
			case <-e.stopCh:
				return
			default:
				continue
			}
		}
		// First captured packet confirms WinDivert is actually filtering (Open can
		// succeed while a security product / another WinDivert app blocks capture).
		if atomic.AddInt64(&e.captured, 1) == 1 && atomic.CompareAndSwapInt32(&e.firstLogged, 0, 1) {
			e.captureWarn.Store("") // healthy: packets are flowing
			e.log("[engine] WinDivert 抓包正常（已捕获到流量）")
		}
		pkt := buf[:n]
		if !divert.IsIPv4(pkt) {
			h.Send(pkt, &addr)
			continue
		}
		switch divert.Protocol(pkt) {
		case 6: // TCP
			e.handlePacket(h, pkt, &addr)
		case 17: // UDP (only QUIC/443 reaches here, per the filter)
			e.handleUDP(h, pkt, &addr)
		default:
			h.Send(pkt, &addr)
		}
	}
}

// handleUDP drops matched apps' QUIC (UDP/443) so they retry over TCP (which we
// proxy); all other UDP is re-injected untouched.
func (e *Engine) handleUDP(h *divert.Handle, pkt []byte, addr *divert.Address) {
	if divert.DstPort(pkt) == 443 {
		sport := divert.SrcPort(pkt)
		if pid, exe, ok := e.lookup.ExeByLocalUDPPort(sport); ok {
			// Any non-direct app (proxied or blocked): drop its QUIC so it retries
			// over TCP (which we proxy) — avoids a QUIC leak.
			if e.matcher.Decide(pid, exe, divert.DstIP(pkt)) != TargetDirect {
				return // drop
			}
		}
	}
	h.Send(pkt, addr)
}

func (e *Engine) handlePacket(h *divert.Handle, pkt []byte, addr *divert.Address) {
	src := divert.SrcIP(pkt)
	dst := divert.DstIP(pkt)
	sport := divert.SrcPort(pkt)
	dport := divert.DstPort(pkt)

	// Reply path: redirector -> app. Restore original (src=origDst, dst=origLocal)
	// and inject inbound on the real interface.
	if src == loopback && sport == e.redirPort {
		f, ok := e.ct.get(dport)
		if !ok {
			h.Send(pkt, addr)
			return
		}
		e.ct.touch(dport) // keep the flow alive while it has traffic
		divert.SetSrcIP(pkt, f.dstIP)
		divert.SetSrcPort(pkt, f.dstPort)
		divert.SetDstIP(pkt, f.localIP)
		addr.SetOutbound(false)
		addr.SetLoopback(false)
		addr.SetNetworkIfIdx(f.ifIdx, f.subIfIdx)
		divert.CalcChecksums(pkt, addr, 0)
		h.Send(pkt, addr)
		return
	}

	// A fresh SYN always (re)decides, even if a stale entry lingers for this
	// ephemeral port — otherwise a reused port would inherit the old flow's
	// destination and bypass policy.
	if divert.IsSYN(pkt) {
		if pid, exe, ok := e.lookup.ExeByLocalPort(sport); ok {
			switch t := e.matcher.Decide(pid, exe, dst); t {
			case TargetBlock:
				e.ct.delete(sport)
				e.log(fmt.Sprintf("[block] %s -> %s:%d", proc.BaseName(exe), dst, dport))
				return // drop: do not re-inject, connection is refused
			case TargetDirect:
				// Diagnostic: a captured app going direct to a PUBLIC address means
				// no rule matched it. Log once per exe so a mis-added rule is obvious.
				if !isPrivate(dst) {
					base := proc.BaseName(exe)
					if _, seen := e.directSeen.LoadOrStore(base, true); !seen {
						e.log(fmt.Sprintf("[直连] %s 未匹配任何规则 → 直连（如需代理请在「应用分流」加规则）", base))
					}
				}
				// fall through to direct pass-through below
			default: // proxy via upstream key t
				ifIdx, subIfIdx := addr.NetworkIfIdx()
				e.ct.put(sport, flow{
					localIP:  src,
					dstIP:    dst,
					dstPort:  dport,
					target:   t,
					ifIdx:    ifIdx,
					subIfIdx: subIfIdx,
				})
				e.log(fmt.Sprintf("[divert:%s] %s  %s:%d -> %s:%d", t, proc.BaseName(exe), src, sport, dst, dport))
				e.redirectForward(h, pkt, addr)
				return
			}
		}
		// Direct SYN: drop any stale mapping for this reused port, pass through.
		e.ct.delete(sport)
		h.Send(pkt, addr)
		return
	}

	// Non-SYN packet of an already-tracked proxied flow.
	if _, ok := e.ct.get(sport); ok {
		e.ct.touch(sport)
		e.redirectForward(h, pkt, addr)
		return
	}

	// Everything else: direct, re-inject untouched.
	h.Send(pkt, addr)
}

// redirectForward rewrites an app->remote packet so it loops back to the local
// redirector (127.0.0.1:redirPort), preserving the client's source port.
func (e *Engine) redirectForward(h *divert.Handle, pkt []byte, addr *divert.Address) {
	divert.SetSrcIP(pkt, loopback)
	divert.SetDstIP(pkt, loopback)
	divert.SetDstPort(pkt, e.redirPort)
	addr.SetOutbound(true)
	addr.SetLoopback(true)
	addr.SetNetworkIfIdx(loopbackIfIdx, 0)
	divert.CalcChecksums(pkt, addr, 0)
	h.Send(pkt, addr)
}

// serve accepts redirected connections and forwards them through the core.
func (e *Engine) serve(ln net.Listener) {
	for {
		c, err := ln.Accept()
		if err != nil {
			select {
			case <-e.stopCh:
				return
			default:
				continue
			}
		}
		go e.handleConn(c)
	}
}

func (e *Engine) handleConn(c net.Conn) {
	defer c.Close()
	rport := uint16(c.RemoteAddr().(*net.TCPAddr).Port)
	f, ok := e.ct.get(rport)
	if !ok {
		e.log(fmt.Sprintf("[fwd] no conntrack for local port %d", rport))
		return
	}
	e.mu.Lock()
	dialer := e.dialers[f.target]
	e.mu.Unlock()
	if dialer == nil {
		e.log(fmt.Sprintf("[fwd] no upstream for line %q", f.target))
		return
	}
	dst := net.JoinHostPort(f.dstIP.String(), fmt.Sprintf("%d", f.dstPort))

	up, err := dialer.Dial("tcp", dst)
	if err != nil {
		e.log(fmt.Sprintf("[fwd:%s] dial %s failed: %v", f.target, dst, err))
		return
	}
	defer up.Close()

	atomic.AddInt64(&e.totalConns, 1)
	atomic.AddInt64(&e.activeConns, 1)
	defer atomic.AddInt64(&e.activeConns, -1)

	// Bidirectional copy with byte accounting (up = app->core, down = core->app).
	done := make(chan struct{}, 2)
	go func() { e.copyCount(up, c, &e.upBytes); done <- struct{}{} }()
	go func() { e.copyCount(c, up, &e.downBytes); done <- struct{}{} }()
	<-done
}

// copyCount copies src->dst, accumulating the byte count atomically.
func (e *Engine) copyCount(dst io.Writer, src io.Reader, counter *int64) {
	buf := make([]byte, 32*1024)
	for {
		n, err := src.Read(buf)
		if n > 0 {
			if _, werr := dst.Write(buf[:n]); werr != nil {
				return
			}
			atomic.AddInt64(counter, int64(n))
		}
		if err != nil {
			return
		}
	}
}

func (e *Engine) gcLoop() {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-e.stopCh:
			return
		case <-t.C:
			e.ct.gc(10 * time.Minute) // idle timeout; active flows are touched
		}
	}
}
