package core

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"net/netip"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"golang.org/x/net/dns/dnsmessage"
)

// The DNS test runs the generated TUN config in the real core with the TUN
// swapped for a loopback UDP inbound (the config's own sniff + hijack-dns rules
// take the queries) and both resolvers swapped for fixed host tables.

var dnsHosts = M{
	"www.baidu.com":     "39.156.66.10",    // geosite-cn
	"cn-hosted.example": "114.114.114.114", // not in geosite-cn, answer in China
	"intranet.example":  "10.1.2.3",        // answer in a private network
	"www.google.com":    "8.8.4.4",         // foreign
	"dns.msftncsi.com":  "131.107.255.255", // Windows NCSI: must stay real
	"stun.l.google.com": "74.125.250.129",  // STUN: must stay real
	"example.com":       "93.184.215.14",   // the node's server
	"nas.lan":           "192.168.1.5",
}

// dnsHostTable is dnsHosts plus IPv6 addresses and a second foreign name.
func dnsHostTable() M {
	h := M{"www.youtube.com": "142.250.1.1"}
	for k, v := range dnsHosts {
		h[k] = v
	}
	h["www.baidu.com"] = []string{"39.156.66.10", "2400:da00::6666"}
	h["www.google.com"] = []string{"8.8.4.4", "2001:4860::8844"}
	return h
}

type dnsCore struct {
	t      *testing.T
	bin    string
	port   int
	clash  string
	cache  string
	sb     *exec.Cmd
	exited chan error
}

func newDNSCore(t *testing.T) *dnsCore {
	t.Helper()
	if runtime.GOOS != "windows" {
		t.Skip("bundled core is the Windows build")
	}
	src, err := os.ReadFile(singboxPath(t))
	if err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(t.TempDir(), "sing-box.exe") // private copy, see newMatrixEgress
	if err := os.WriteFile(bin, src, 0o755); err != nil {
		t.Fatal(err)
	}
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := pc.LocalAddr().(*net.UDPAddr).Port
	pc.Close()
	return &dnsCore{t: t, bin: bin, port: port, clash: fmt.Sprintf("127.0.0.1:%d", freePortT(t)),
		cache: filepath.Join(t.TempDir(), "cache.db")}
}

// start runs the core with the given 远程解析域名 setting and boot 代理策略.
func (d *dnsCore) start(remote bool, mode string) {
	t := d.t
	t.Helper()
	opts := Options{RemoteDNS: remote, Split: true, SplitWhitelist: true, ClashController: d.clash,
		ClashMode: mode, DirectDomains: []string{"proxysplit.example.cn"}, CacheFile: d.cache}
	cfg, _ := tunCfgFor(t, opts)
	cfg["inbounds"] = []M{{"type": "direct", "tag": "tun-in", "listen": "127.0.0.1", "listen_port": d.port, "network": "udp"}}
	dns := cfg["dns"].(map[string]interface{})
	var servers []M
	for _, s := range dns["servers"].([]interface{}) {
		m := s.(map[string]interface{})
		if tag := m["tag"]; tag == dnsDirect || tag == dnsRemote {
			m = M{"type": "hosts", "tag": tag, "predefined": dnsHostTable()}
		}
		servers = append(servers, m)
	}
	dns["servers"] = servers
	b, _ := json.MarshalIndent(cfg, "", " ")
	p := filepath.Join(t.TempDir(), "dns.json")
	os.WriteFile(p, b, 0o600)
	var out bytes.Buffer
	d.sb = exec.Command(d.bin, "run", "-c", p)
	d.sb.Stdout, d.sb.Stderr = &out, &out
	if err := d.sb.Start(); err != nil {
		t.Fatal(err)
	}
	d.exited = make(chan error, 1)
	sb, exited := d.sb, d.exited
	go func() { exited <- sb.Wait() }()
	t.Cleanup(d.stop)
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case err := <-exited:
			exited <- err
			t.Fatalf("sing-box exited on start (%v):\n%s\n%s", err, out.String(), b)
		default:
		}
		if c, err := net.Dial("tcp", d.clash); err == nil {
			c.Close()
			if _, _, err := d.query("www.baidu.com", dnsmessage.TypeA); err == nil {
				return
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("sing-box did not come up in 30s:\n%s", out.String())
}

func (d *dnsCore) stop() {
	if d.sb != nil && d.sb.Process != nil {
		d.sb.Process.Kill()
		<-d.exited
		d.exited <- nil // keep later stops from blocking
		d.sb = nil
	}
}

// query asks the core and returns the rcode and the A / AAAA answers.
func (d *dnsCore) query(name string, typ dnsmessage.Type) (dnsmessage.RCode, []netip.Addr, error) {
	q := dnsmessage.Message{Header: dnsmessage.Header{ID: 0x5150, RecursionDesired: true},
		Questions: []dnsmessage.Question{{Name: dnsmessage.MustNewName(name + "."), Type: typ, Class: dnsmessage.ClassINET}}}
	pkt, err := q.Pack()
	if err != nil {
		return 0, nil, err
	}
	c, err := net.Dial("udp", fmt.Sprintf("127.0.0.1:%d", d.port))
	if err != nil {
		return 0, nil, err
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(2 * time.Second))
	if _, err := c.Write(pkt); err != nil {
		return 0, nil, err
	}
	buf := make([]byte, 1500)
	n, err := c.Read(buf)
	if err != nil {
		return 0, nil, err
	}
	var resp dnsmessage.Message
	if err := resp.Unpack(buf[:n]); err != nil {
		return 0, nil, err
	}
	var addrs []netip.Addr
	for _, a := range resp.Answers {
		switch r := a.Body.(type) {
		case *dnsmessage.AResource:
			addrs = append(addrs, netip.AddrFrom4(r.A))
		case *dnsmessage.AAAAResource:
			addrs = append(addrs, netip.AddrFrom16(r.AAAA))
		}
	}
	return resp.RCode, addrs, nil
}

func (d *dnsCore) a(name string) netip.Addr {
	d.t.Helper()
	rc, addrs, err := d.query(name, dnsmessage.TypeA)
	if err != nil || rc != dnsmessage.RCodeSuccess || len(addrs) != 1 {
		d.t.Fatalf("A %s: rcode %v, %v, %v", name, rc, addrs, err)
	}
	return addrs[0]
}

var fakeRange = netip.MustParsePrefix(FakeIPRange)

func TestDNSFakeIPRealCore(t *testing.T) {
	d := newDNSCore(t)
	d.start(true, "rule")

	for name, want := range dnsHosts {
		got := d.a(name)
		if name == "www.google.com" {
			if !fakeRange.Contains(got) {
				t.Errorf("%s: got %s, want a fake IP", name, got)
			}
			continue
		}
		if got.String() != want {
			t.Errorf("%s: got %s, want the real %s", name, got, want)
		}
	}
	fake := d.a("www.google.com")
	if again := d.a("www.google.com"); again != fake {
		t.Errorf("fake IP changed between lookups: %s -> %s", fake, again)
	}
	for _, name := range []string{"www.google.com", "www.baidu.com"} {
		rc, addrs, err := d.query(name, dnsmessage.TypeAAAA)
		if err != nil || rc != dnsmessage.RCodeSuccess || len(addrs) != 0 {
			t.Errorf("AAAA %s: rcode %v, %v, %v (want empty NOERROR)", name, rc, addrs, err)
		}
	}

	// 代理策略 直连: real answers for everything.
	if _, err := EnsureClashMode(d.clash, "", "direct", 5*time.Second); err != nil {
		t.Fatal(err)
	}
	if got := d.a("www.google.com"); got.String() != "8.8.4.4" {
		t.Errorf("直连 mode: www.google.com = %s, want the real address", got)
	}

	// Restart with the cache file: the same fake IP comes back, and the
	// 代理策略 cached from the last run (直连) is put back to the wanted one.
	// The core saves the fake-IP allocator position about 10 s after an
	// allocation (and on a clean exit); Manager.Stop kills it, so wait.
	time.Sleep(12 * time.Second)
	d.stop()
	d.start(true, "rule")
	changed, err := EnsureClashMode(d.clash, "", "rule", 5*time.Second)
	if err != nil || !changed {
		t.Errorf("cached 直连 should have been switched back to rule: changed=%v err=%v", changed, err)
	}
	if yt := d.a("www.youtube.com"); !fakeRange.Contains(yt) || yt == fake {
		t.Errorf("after restart a new name got %s; want a fresh fake IP (not %s)", yt, fake)
	}
	if got := d.a("www.google.com"); got != fake {
		t.Errorf("after restart www.google.com = %s, want the stored fake IP %s", got, fake)
	}

	// 远程解析域名 off on the same cache file: no fake IP leaks out of the cache.
	d.stop()
	d.start(false, "rule")
	if got := d.a("www.google.com"); got.String() != "8.8.4.4" {
		t.Errorf("远程解析域名 off: www.google.com = %s, want the real address", got)
	}
	rc, addrs, err := d.query("www.google.com", dnsmessage.TypeAAAA)
	if err != nil || rc != dnsmessage.RCodeSuccess || len(addrs) != 0 {
		t.Errorf("远程解析域名 off: AAAA rcode %v, %v, %v (want empty NOERROR)", rc, addrs, err)
	}
}
