package capture

import (
	"encoding/binary"
	"io"
	"net"
	"net/netip"
	"strings"
	"testing"
	"time"

	"proxysplit/internal/divert"
)

func TestDataFilter(t *testing.T) {
	if got := DataFilter(nil, nil); got != "false" {
		t.Fatalf("empty set must match nothing, got %q", got)
	}
	got := DataFilter([]uint16{5001, 4000}, []uint16{6000})
	want := "outbound and !loopback and ip and ((tcp and !tcp.Syn and (tcp.SrcPort == 4000 or tcp.SrcPort == 5001)) or (udp and udp.DstPort != 53 and (udp.SrcPort == 6000)))"
	if got != want {
		t.Fatalf("filter\n got %s\nwant %s", got, want)
	}
	many := make([]uint16, MaxFilterPorts+1)
	for i := range many {
		many[i] = uint16(10000 + i)
	}
	if f := DataFilter(many, nil); strings.Contains(f, "SrcPort") {
		t.Fatalf("oversize set must fall back to the broad filter: %s", f)
	}
	if !strings.Contains(ProbeFilter(), "tcp.Syn and !tcp.Ack") || !strings.Contains(ReplyFilter(1234), "tcp.SrcPort == 1234") {
		t.Fatal("probe/reply filters changed")
	}
}

func TestRoutesDecide(t *testing.T) {
	r := &Routes{
		Block: map[string]bool{"bad.exe": true}, BlockDirs: []string{NormDir(`C:\Evil`)},
		Apps:    map[string]int{"chrome.exe": 101, "both.exe": 102},
		AppDirs: []DirRoute{{Prefix: NormDir(`D:\Games\`), Port: 103}},
		Direct:  map[string]bool{"直播伴侣.exe": true, "both.exe": true},
	}
	cases := map[string]Verdict{
		`C:\x\BAD.exe`:                {Action: Drop},
		`C:\Evil\sub\a.exe`:           {Action: Drop},
		`C:\Program Files\Chrome.EXE`: {Action: Proxy, Port: 101},
		`D:\games\x\game.exe`:         {Action: Proxy, Port: 103},
		`C:\live\直播伴侣.exe`:            {},
		`C:\both.exe`:                 {Action: Proxy, Port: 102}, // per-target app beats 直连 (TUN order)
		`C:\other.exe`:                {},
		``:                            {},
	}
	for path, want := range cases {
		if got := r.Decide(path); got != want {
			t.Errorf("%s: got %+v want %+v", path, got, want)
		}
	}
	r.Default = 200
	if got := r.Decide(`C:\other.exe`); got != (Verdict{Action: Proxy, Port: 200}) {
		t.Errorf("blacklist default: %+v", got)
	}
	var nilRoutes *Routes
	if nilRoutes.Decide(`C:\a.exe`).Action != Pass {
		t.Error("nil routes must pass")
	}
}

func tcpPacket(src, dst netip.AddrPort) []byte {
	b := make([]byte, 44)
	b[0], b[9] = 0x45, divert.ProtoTCP
	binary.BigEndian.PutUint16(b[2:], 44)
	s, d := src.Addr().As4(), dst.Addr().As4()
	copy(b[12:], s[:])
	copy(b[16:], d[:])
	binary.BigEndian.PutUint16(b[20:], src.Port())
	binary.BigEndian.PutUint16(b[22:], dst.Port())
	b[32], b[33] = 0x50, 0x18 // data offset 5, PSH|ACK
	copy(b[40:], "ping")
	return b
}

func validSums(b []byte) bool {
	c := append([]byte(nil), b...)
	orig := append([]byte(nil), b...)
	divert.FixChecksums(c)
	return string(c) == string(orig)
}

func TestNATRoundTrip(t *testing.T) {
	app := netip.MustParseAddrPort("192.168.1.10:50123")
	remote := netip.MustParseAddrPort("142.250.1.1:443")
	pkt := tcpPacket(app, remote)
	if !RewriteForward(pkt, 7777) || !validSums(pkt) {
		t.Fatal("forward rewrite failed / bad checksum")
	}
	if divert.SrcIP(pkt) != loopbackIP || divert.DstIP(pkt) != loopbackIP || divert.DstPort(pkt) != 7777 || divert.SrcPort(pkt) != 50123 {
		t.Fatal("forward rewrite fields wrong")
	}
	reply := tcpPacket(netip.AddrPortFrom(loopbackIP, 7777), netip.AddrPortFrom(loopbackIP, 50123))
	f := Flow{LocalIP: app.Addr(), DstIP: remote.Addr(), DstPort: remote.Port()}
	if !RewriteReply(reply, f) || !validSums(reply) {
		t.Fatal("reply rewrite failed / bad checksum")
	}
	if divert.SrcIP(reply) != remote.Addr() || divert.SrcPort(reply) != 443 || divert.DstIP(reply) != app.Addr() || divert.DstPort(reply) != 50123 {
		t.Fatal("reply must look like it came from the original remote")
	}
}

func TestConntrackSweep(t *testing.T) {
	c := newConntrack()
	c.put(1, Flow{})
	c.put(2, Flow{})
	c.markClosed(2)
	now := time.Now()
	if gone := c.sweep(now.Add(time.Second), time.Hour, 30*time.Second); len(gone) != 0 {
		t.Fatalf("nothing should expire yet: %v", gone)
	}
	if gone := c.sweep(now.Add(time.Minute), time.Hour, 30*time.Second); len(gone) != 1 || gone[0] != 2 {
		t.Fatalf("closed flow must expire after grace: %v", gone)
	}
	if _, ok := c.get(1); !ok || c.count() != 1 {
		t.Fatal("live flow lost")
	}
}

func TestSOCKSUDPHeader(t *testing.T) {
	for _, s := range []string{"1.2.3.4:53", "[2001:db8::1]:443"} {
		ap := netip.MustParseAddrPort(s)
		from, payload, err := DecodeUDPHeader(EncodeUDPHeader(ap, []byte("hi")))
		if err != nil || from != ap || string(payload) != "hi" {
			t.Fatalf("%s: %v %v %q", s, err, from, payload)
		}
	}
	if _, _, err := DecodeUDPHeader([]byte{0, 0, 1, 1}); err == nil {
		t.Fatal("fragmented datagrams must be rejected")
	}
}

// fakeSOCKS answers one UDP ASSOCIATE with relay address relay.
func fakeSOCKS(t *testing.T, relay *net.UDPAddr) string {
	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		buf := make([]byte, 10)
		_, _ = io.ReadFull(c, buf[:3])
		_, _ = c.Write([]byte{5, 0})
		_, _ = io.ReadFull(c, buf[:10])
		resp := []byte{5, 0, 0, 1, 127, 0, 0, 1, 0, 0}
		binary.BigEndian.PutUint16(resp[8:], uint16(relay.Port))
		_, _ = c.Write(resp)
		_, _ = io.Copy(io.Discard, c)
	}()
	return ln.Addr().String()
}

func TestUDPAssociate(t *testing.T) {
	relay := &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 40404}
	ctrl, got, err := udpAssociate(fakeSOCKS(t, relay), 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer ctrl.Close()
	if got.Port != 40404 || !got.IP.Equal(relay.IP) {
		t.Fatalf("relay address %v", got)
	}
}
