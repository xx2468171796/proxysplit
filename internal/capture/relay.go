package capture

import (
	"io"
	"net"
	"net/netip"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/net/proxy"
)

// relay accepts the NAT-redirected TCP connections and forwards each one via
// SOCKS5 CONNECT to the flow's sing-box inbound — by the sniffed SNI / Host
// when there is one (see sniff.go), else the original destination IP:port —
// where sniffing recovers the domain and the group's rules pick the outbound.
type relay struct {
	ln     net.Listener
	ct     *conntrack
	log    func(string)
	mu     sync.Mutex
	dial   map[int]proxy.Dialer
	active atomic.Int64
	total  atomic.Int64
}

func newRelay(ct *conntrack, log func(string)) (*relay, error) {
	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	return &relay{ln: ln, ct: ct, log: log, dial: map[int]proxy.Dialer{}}, nil
}

func (r *relay) port() uint16 { return uint16(r.ln.Addr().(*net.TCPAddr).Port) }

func (r *relay) dialer(inbound int) proxy.Dialer {
	r.mu.Lock()
	defer r.mu.Unlock()
	d := r.dial[inbound]
	if d == nil {
		d, _ = proxy.SOCKS5("tcp", "127.0.0.1:"+strconv.Itoa(inbound), nil, &net.Dialer{Timeout: 10 * time.Second})
		r.dial[inbound] = d
	}
	return d
}

func (r *relay) serve() {
	for {
		c, err := r.ln.Accept()
		if err != nil {
			return // listener closed
		}
		go r.handle(c)
	}
}

func (r *relay) handle(c net.Conn) {
	defer c.Close()
	ap, err := netip.ParseAddrPort(c.RemoteAddr().String())
	if err != nil {
		return
	}
	f, ok := r.ct.get(ap.Port())
	if !ok {
		r.log("[capture] 中转收到未登记连接，端口 " + strconv.Itoa(int(ap.Port())))
		return
	}
	first, host := peekHost(c)
	target := netip.AddrPortFrom(f.DstIP, f.DstPort).String()
	if host != "" { // the IP may be poisoned (system resolver): let the node resolve the name
		target = net.JoinHostPort(host, strconv.Itoa(int(f.DstPort)))
	}
	up, err := r.dialer(f.Inbound).Dial("tcp", target)
	if err != nil {
		return // sing-box rejected (拦截规则) or unreachable: the app sees a reset
	}
	defer up.Close()
	if len(first) > 0 {
		if _, err := up.Write(first); err != nil {
			return
		}
	}
	r.total.Add(1)
	r.active.Add(1)
	defer r.active.Add(-1)
	done := make(chan struct{}, 2)
	pipe := func(dst, src net.Conn) {
		_, _ = io.Copy(dst, src)
		if tc, ok := dst.(interface{ CloseWrite() error }); ok {
			_ = tc.CloseWrite()
		}
		done <- struct{}{}
	}
	go pipe(up, c)
	go pipe(c, up)
	<-done
	<-done
}

func (r *relay) close() { _ = r.ln.Close() }
