package capture

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"proxysplit/internal/divert"
)

// Handle priorities: the probe sees new connections first; data and reply
// filters are disjoint from it in practice.
const (
	prioProbe = 3
	prioData  = 2
	prioReply = 1
)

// Engine is the process-only capture runtime (one per running core).
type Engine struct {
	log     func(string)
	routes  atomic.Pointer[Routes]
	exclude map[string]bool // lower-case exe paths never captured (core, port proxies)
	selfPID uint32

	own    *owners
	ct     *conntrack
	udp    *udpTable
	relay  *relay
	data   *dataSet
	probe  *divert.Handle
	reply  *divert.Handle
	sock   *divert.Handle
	sender *divert.Handle
	stop   chan struct{}
	wg     sync.WaitGroup
	once   sync.Once
}

// Options configures Start.
type Options struct {
	DLLPath string   // absolute path of WinDivert.dll (WinDivert64.sys next to it)
	Exclude []string // exe paths that must never be captured (sing-box, 端口代理)
	Log     func(string)
}

// Start loads the driver, opens the handles and begins capturing. Requires
// administrator rights (the app manifest already demands them for TUN).
func Start(opts Options, routes *Routes) (*Engine, error) {
	if opts.Log == nil {
		opts.Log = func(string) {}
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(opts.DLLPath), "WinDivert64.sys")); err != nil {
		return nil, fmt.Errorf("缺少 WinDivert64.sys: %w", err)
	}
	if err := divert.Load(opts.DLLPath); err != nil {
		return nil, err
	}
	e := &Engine{log: opts.Log, exclude: map[string]bool{}, selfPID: uint32(os.Getpid()),
		own: newOwners(), ct: newConntrack(), stop: make(chan struct{})}
	for _, p := range opts.Exclude {
		if p != "" {
			e.exclude[normPath(p)] = true
		}
	}
	e.routes.Store(routes)
	if err := e.open(); err != nil {
		e.Stop()
		return nil, err
	}
	e.wg.Add(4)
	go e.relay.serve()
	go e.sockLoop()
	go e.probeLoop()
	go e.replyLoop()
	go e.sweepLoop()
	e.log(fmt.Sprintf("[capture] 仅接管选中程序已启动（中转 127.0.0.1:%d）", e.relay.port()))
	return e, nil
}

func (e *Engine) open() error {
	var err error
	if e.relay, err = newRelay(e.ct, e.log); err != nil {
		return err
	}
	if e.sender, err = divert.Open("false", divert.LayerNetwork, 0, divert.FlagSendOnly); err != nil {
		return fmt.Errorf("WinDivert 打开失败（需管理员权限 / 可能被安全软件拦截）: %w", err)
	}
	e.udp = newUDPTable(e.injectInbound)
	e.data = newDataSet(e)
	if err = e.data.rebuild(); err != nil {
		return err
	}
	if e.sock, err = divert.Open(SocketFilter(), divert.LayerSocket, 0, divert.FlagSniff|divert.FlagRecvOnly); err != nil {
		return err
	}
	if e.reply, err = divert.Open(ReplyFilter(int(e.relay.port())), divert.LayerNetwork, prioReply, 0); err != nil {
		return err
	}
	e.probe, err = divert.Open(ProbeFilter(), divert.LayerNetwork, prioProbe, 0)
	return err
}

// SetRoutes swaps the app lists live (no core restart). New connections follow
// the new lists; flows already relayed keep their inbound until they close.
func (e *Engine) SetRoutes(r *Routes) { e.routes.Store(r) }

// Flows reports the number of relayed TCP flows (diagnostics).
func (e *Engine) Flows() int { return e.ct.count() }

// Stop closes every handle (the driver unloads when the last one goes) and the
// relay. Safe to call more than once.
func (e *Engine) Stop() {
	e.once.Do(func() {
		close(e.stop)
		for _, h := range []*divert.Handle{e.probe, e.reply, e.sock} {
			if h != nil {
				h.Shutdown(divert.ShutdownBoth)
			}
		}
		if e.data != nil {
			e.data.close()
		}
		if e.relay != nil {
			e.relay.close()
		}
		e.wg.Wait()
		for _, h := range []*divert.Handle{e.probe, e.reply, e.sock, e.sender} {
			_ = h.Close()
		}
		if e.udp != nil {
			e.udp.closeAll()
		}
		e.log("[capture] 已停止，WinDivert 句柄已关闭")
	})
}

func (e *Engine) stopped() bool {
	select {
	case <-e.stop:
		return true
	default:
		return false
	}
}

// verdict decides for the owner of a local port.
func (e *Engine) verdict(proto uint8, port uint16) Verdict {
	pid, ok := e.own.pid(proto, port)
	if !ok || pid == e.selfPID || pid <= 4 {
		return Verdict{}
	}
	path := e.own.exe(pid)
	if path == "" || e.exclude[normPath(path)] {
		return Verdict{}
	}
	return e.routes.Load().Decide(path)
}

// injectInbound delivers a built packet to the local app.
func (e *Engine) injectInbound(pkt []byte, ifIdx, subIfIdx uint32) {
	var a divert.Address
	a.SetOutbound(false)
	a.SetIfIdx(ifIdx, subIfIdx)
	a.SetChecksumsValid()
	_ = e.sender.Send(pkt, &a)
}

func (e *Engine) sweepLoop() {
	t := time.NewTicker(10 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-e.stop:
			return
		case now := <-t.C:
			if gone := e.ct.sweep(now, 15*time.Minute, 30*time.Second); len(gone) > 0 {
				e.data.remove(divert.ProtoTCP, gone)
			}
			e.udp.sweep(now, 2*time.Minute)
		}
	}
}

func normPath(p string) string { return strings.ToLower(filepath.Clean(p)) }

// recvFailed is called after a Recv error: true = the loop must exit; else it
// backs off briefly so a broken handle cannot spin a core.
func (e *Engine) recvFailed() bool {
	if e.stopped() {
		return true
	}
	time.Sleep(10 * time.Millisecond)
	return false
}
