package noderesolve

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/net/dns/dnsmessage"
)

// reply builds a response to query q carrying the given addresses.
func reply(t *testing.T, q []byte, ips []string, rcode dnsmessage.RCode) []byte {
	t.Helper()
	var p dnsmessage.Parser
	h, err := p.Start(q)
	if err != nil {
		t.Fatal(err)
	}
	qs, err := p.AllQuestions()
	if err != nil {
		t.Fatal(err)
	}
	m := dnsmessage.Message{Header: dnsmessage.Header{ID: h.ID, Response: true, RCode: rcode}, Questions: qs}
	for _, s := range ips {
		a := netip.MustParseAddr(s)
		rh := dnsmessage.ResourceHeader{Name: qs[0].Name, Class: dnsmessage.ClassINET, TTL: 60}
		if a.Is4() && qs[0].Type == dnsmessage.TypeA {
			m.Answers = append(m.Answers, dnsmessage.Resource{Header: rh, Body: &dnsmessage.AResource{A: a.As4()}})
		} else if a.Is6() && qs[0].Type == dnsmessage.TypeAAAA {
			m.Answers = append(m.Answers, dnsmessage.Resource{Header: rh, Body: &dnsmessage.AAAAResource{AAAA: a.As16()}})
		}
	}
	b, err := m.Pack()
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// fakeUDP serves ips (after delay) on a local UDP port; hits counts queries.
func fakeUDP(t *testing.T, ips []string, delay time.Duration, hits *atomic.Int32) Server {
	t.Helper()
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pc.Close() })
	go func() {
		buf := make([]byte, 1500)
		for {
			n, addr, err := pc.ReadFrom(buf)
			if err != nil {
				return
			}
			if hits != nil {
				hits.Add(1)
			}
			q := append([]byte(nil), buf[:n]...)
			go func() {
				time.Sleep(delay)
				_, _ = pc.WriteTo(reply(t, q, ips, dnsmessage.RCodeSuccess), addr)
			}()
		}
	}()
	return Server{Name: "udp-" + strings.Join(ips, ","), Kind: KindUDP, Addr: pc.LocalAddr().String()}
}

// fakeDoH serves ips over a local HTTPS endpoint (RFC 8484 POST).
func fakeDoH(t *testing.T, ips []string) (Server, *http.Client) {
	t.Helper()
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Content-Type") != "application/dns-message" {
			http.Error(w, "bad type", 415)
			return
		}
		q, _ := io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/dns-message")
		_, _ = w.Write(reply(t, q, ips, dnsmessage.RCodeSuccess))
	}))
	t.Cleanup(srv.Close)
	return Server{Name: "doh", Kind: KindDoH, Addr: srv.URL + "/dns-query"}, srv.Client()
}

// probeMap maps public test IPs to local listeners (unknown = refused).
func probeMap(m map[string]string, delay map[string]time.Duration) func(context.Context, *net.Dialer, string) error {
	return func(ctx context.Context, d *net.Dialer, addr string) error {
		host, _, _ := net.SplitHostPort(addr)
		time.Sleep(delay[host])
		target, ok := m[host]
		if !ok {
			return errors.New("refused")
		}
		return tcpProbe(ctx, d, target)
	}
}

func listener(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			c.Close()
		}
	}()
	return l.Addr().String()
}

func newTest(servers []Server, hc *http.Client, probe func(context.Context, *net.Dialer, string) error) *Resolver {
	cfg := Config{
		Servers: func() []Server { return servers },
		Dialer:  func() *net.Dialer { return &net.Dialer{} },
		probe:   probe,
	}
	if hc != nil {
		cfg.HTTPClient = func() *http.Client { return hc }
	}
	return New(cfg)
}

func TestIPLiteralPassthrough(t *testing.T) {
	r := newTest(nil, nil, nil)
	for _, h := range []string{"1.2.3.4", "2001:4860::1"} {
		res, err := r.Resolve(context.Background(), h, 443)
		if err != nil || res.Best != h || len(res.Resolvers) != 0 {
			t.Fatalf("%s: %+v %v", h, res, err)
		}
	}
}

func TestUnionRankAndProbe(t *testing.T) {
	doh, hc := fakeDoH(t, []string{"5.5.5.5", "6.6.6.6"})
	servers := []Server{
		fakeUDP(t, []string{"5.5.5.5", "7.7.7.7"}, 0, nil),
		fakeUDP(t, []string{"5.5.5.5", "127.0.0.1", "10.0.0.1", "198.18.0.5"}, 0, nil), // bogus dropped
		doh,
	}
	slow, fast := listener(t), listener(t)
	r := newTest(servers, hc, probeMap(map[string]string{"5.5.5.5": slow, "6.6.6.6": fast},
		map[string]time.Duration{"5.5.5.5": 80 * time.Millisecond}))
	res, err := r.Resolve(context.Background(), "node.example", 443)
	if err != nil {
		t.Fatal(err)
	}
	if res.Best != "6.6.6.6" || res.Fallback {
		t.Fatalf("want fastest 6.6.6.6, got %+v", res)
	}
	want := []string{"6.6.6.6", "5.5.5.5", "7.7.7.7"}
	if strings.Join(res.IPs, ",") != strings.Join(want, ",") {
		t.Fatalf("ranking %v, want %v", res.IPs, want)
	}
	for _, a := range res.Resolvers {
		if !a.OK {
			t.Fatalf("resolver %s failed: %+v", a.Name, a)
		}
	}
	if !strings.Contains(Summary(res, nil), "选 6.6.6.6") {
		t.Fatal(Summary(res, nil))
	}
}

func TestAllProbesFailFallsBackToVotes(t *testing.T) {
	servers := []Server{
		fakeUDP(t, []string{"8.8.4.4", "9.9.9.9"}, 0, nil),
		fakeUDP(t, []string{"9.9.9.9"}, 0, nil),
	}
	r := newTest(servers, nil, probeMap(nil, nil))
	res, err := r.Resolve(context.Background(), "node.example", 443)
	if err != nil || !res.Fallback || res.Best != "9.9.9.9" {
		t.Fatalf("%+v %v", res, err)
	}
	if p := Payload(res, err); p["fallback"] != true || p["chosen_ip"] != "9.9.9.9" {
		t.Fatalf("payload %v", p)
	}
}

func TestNothingResolves(t *testing.T) {
	bad := fakeUDP(t, []string{"127.0.0.1"}, 0, nil)
	dead := Server{Name: "dead", Kind: KindUDP, Addr: "127.0.0.1:1"}
	r := newTest([]Server{bad, dead}, nil, nil)
	res, err := r.Resolve(context.Background(), "node.example", 443)
	if !errors.Is(err, ErrNoAddress) {
		t.Fatalf("want ErrNoAddress, got %v", err)
	}
	if res.Resolvers[0].ErrCode != "bogus" {
		t.Fatalf("codes %+v", res.Resolvers)
	}
}

func TestTimeoutsBounded(t *testing.T) {
	fast := fakeUDP(t, []string{"1.1.1.1"}, 0, nil)
	slow := fakeUDP(t, []string{"2.2.2.2"}, 3*time.Second, nil)
	r := newTest([]Server{fast, slow}, nil, func(context.Context, *net.Dialer, string) error { return nil })
	start := time.Now()
	res, err := r.Resolve(context.Background(), "node.example", 443)
	if err != nil || res.Best != "1.1.1.1" {
		t.Fatalf("%+v %v", res, err)
	}
	// First answer at ~0 ms + lateGrace: far below the 1.5 s query timeout.
	if el := time.Since(start); el > time.Second {
		t.Fatalf("took %v", el)
	}
	if res.Resolvers[1].ErrCode != "late" {
		t.Fatalf("slow resolver code %q", res.Resolvers[1].ErrCode)
	}
	// Nobody answers: each query gives up at QueryTimeout.
	dead := fakeUDP(t, []string{"2.2.2.2"}, 3*time.Second, nil)
	r = newTest([]Server{dead}, nil, nil)
	r.cfg.QueryTimeout = 200 * time.Millisecond
	start = time.Now()
	res, err = r.Resolve(context.Background(), "slow.example", 443)
	if err == nil || res.Resolvers[0].ErrCode != "timeout" || time.Since(start) > time.Second {
		t.Fatalf("%+v %v %v", res, err, time.Since(start))
	}
}

func TestCacheAndSingleflight(t *testing.T) {
	var hits atomic.Int32
	s := fakeUDP(t, []string{"3.3.3.3"}, 50*time.Millisecond, &hits)
	now := time.Unix(1000, 0)
	r := newTest([]Server{s}, nil, func(context.Context, *net.Dialer, string) error { return nil })
	r.cfg.Now = func() time.Time { return now }
	done := make(chan struct{})
	for range 5 {
		go func() {
			_, _ = r.Resolve(context.Background(), "node.example", 443)
			done <- struct{}{}
		}()
	}
	for range 5 {
		<-done
	}
	if hits.Load() != 1 {
		t.Fatalf("singleflight: %d queries", hits.Load())
	}
	if res, _ := r.Resolve(context.Background(), "node.example", 443); !res.Cached {
		t.Fatal("second call not cached")
	}
	now = now.Add(11 * time.Minute)
	_, _ = r.Resolve(context.Background(), "node.example", 443)
	if hits.Load() != 2 {
		t.Fatalf("expired cache not refreshed: %d", hits.Load())
	}
	_, _ = r.Refresh(context.Background(), "node.example", 443)
	if hits.Load() != 3 {
		t.Fatalf("refresh did not bypass cache: %d", hits.Load())
	}
}

func TestFailureCachedBriefly(t *testing.T) {
	var hits atomic.Int32
	s := fakeUDP(t, nil, 0, &hits)
	now := time.Unix(1000, 0)
	r := newTest([]Server{s}, nil, nil)
	r.cfg.Now = func() time.Time { return now }
	_, err1 := r.Resolve(context.Background(), "x.example", 443)
	_, err2 := r.Resolve(context.Background(), "x.example", 443)
	if err1 == nil || err2 == nil || hits.Load() != 1 {
		t.Fatalf("errs %v %v hits %d", err1, err2, hits.Load())
	}
	now = now.Add(31 * time.Second)
	_, _ = r.Resolve(context.Background(), "x.example", 443)
	if hits.Load() != 2 {
		t.Fatalf("failure cached too long: %d", hits.Load())
	}
}

func TestDoHOnlyAndIPv6(t *testing.T) {
	doh, hc := fakeDoH(t, []string{"4.4.4.4", "2400:3200::1"})
	udp := fakeUDP(t, []string{"1.1.1.1"}, 0, nil)
	r := newTest([]Server{udp, doh}, hc, nil)
	r.cfg.DoHOnly = func() bool { return true }
	r.cfg.WantIPv6 = func() bool { return true }
	res, err := r.Resolve(context.Background(), "node.example", 0)
	if err != nil || len(res.Resolvers) != 1 || len(res.IPs) != 2 || !res.Fallback {
		t.Fatalf("%+v %v", res, err)
	}
}

func TestUsableSystemDNS(t *testing.T) {
	for s, want := range map[string]bool{
		"192.168.1.1": true, "211.136.17.107": true, "127.0.0.53": false, "172.19.0.2": false,
		"fdfe:dcba:9876::2": false, "fec0:0:0:ffff::1": false, "fe80::1": false,
	} {
		if got := usableSystemDNS(netip.MustParseAddr(s)); got != want {
			t.Errorf("%s: %v", s, got)
		}
	}
}
