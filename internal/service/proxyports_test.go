package service

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestPortMonitorAggregatesClients(t *testing.T) {
	var m portMonitor
	now := time.Now()
	m.update([]ConnInfo{
		{ID: "1", Source: "192.168.1.5", Host: "a.com", Upload: 10, Download: 100},
		{ID: "2", Source: "192.168.1.6", Host: "b.com", Upload: 1, Download: 2},
	}, now)
	// conn 1 closes, conn 3 opens from the same client.
	m.update([]ConnInfo{
		{ID: "2", Source: "192.168.1.6", Host: "b.com", Upload: 5, Download: 6},
		{ID: "3", Source: "192.168.1.5", Host: "c.com", Upload: 20, Download: 200},
	}, now.Add(2*time.Second))
	conns, up, down, clients := m.summary()
	if conns != 2 || len(clients) != 2 {
		t.Fatalf("conns=%d clients=%v", conns, clients)
	}
	byIP := map[string]PortClient{}
	for _, c := range clients {
		byIP[c.IP] = c
	}
	a := byIP["192.168.1.5"]
	if a.Total != 2 || a.Conns != 1 || a.Upload != 30 || a.Download != 300 {
		t.Fatalf("client a = %+v", a)
	}
	if up != 35 || down != 306 {
		t.Fatalf("totals up=%d down=%d", up, down)
	}
	if len(m.access) != 3 {
		t.Fatalf("access log = %d entries, want 3", len(m.access))
	}
}

func TestNormalizePortRejectsDuplicates(t *testing.T) {
	s := &Service{}
	s.cfg.ProxyPorts = []ProxyPort{{ID: "a", Name: "一号", Port: 10801}}
	p := ProxyPort{ID: "b", Port: 10801}
	if err := s.normalizePortLocked(&p); err == nil {
		t.Fatal("duplicate port accepted")
	}
	p = ProxyPort{ID: "b", Port: 10802, Protocol: "x", Mode: "x", Pass: "p"}
	if err := s.normalizePortLocked(&p); err != nil {
		t.Fatal(err)
	}
	if p.Protocol != "mixed" || p.Mode != "rule" || p.Pass != "" || p.Name != "端口 10802" {
		t.Fatalf("defaults = %+v", p)
	}
}

func TestPortMonitorResetKeepsLockUsable(t *testing.T) {
	var m portMonitor
	m.update([]ConnInfo{{ID: "1", Source: "10.0.0.2"}}, time.Now())
	m.reset()
	m.reset() // a second reset used to hit "unlock of unlocked mutex"
	if conns, _, _, clients := m.summary(); conns != 0 || len(clients) != 0 {
		t.Fatalf("after reset conns=%d clients=%v", conns, clients)
	}
}

// TestProxyPortConcurrentStartsLeaveOneProcess saves / restarts the same port
// from several goroutines with the real core: exactly one process may survive,
// and StopProxyPorts must free the port.
func TestProxyPortConcurrentStartsLeaveOneProcess(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "bin", "sing-box.exe"))
	if err != nil {
		t.Skip("sing-box binary not found")
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "sing-box.exe"), src, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"geosite-cn.srs", "geoip-cn.srs", "geosite-category-ads-all.srs"} {
		b, _ := os.ReadFile(filepath.Join("..", "..", "bin", f))
		_ = os.WriteFile(filepath.Join(dir, f), b, 0o644)
	}
	s, err := New(dir, dir)
	if err != nil {
		t.Fatal(err)
	}
	l, _ := net.Listen("tcp", "127.0.0.1:0")
	port := l.Addr().(*net.TCPAddr).Port
	l.Close()
	p, err := s.SaveProxyPort(ProxyPort{Port: port, Mode: "direct"})
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = s.startPort(p.ID)
		}()
	}
	wg.Wait()
	st := s.ListProxyPorts()
	if len(st) != 1 || !st[0].Running || st[0].Error != "" {
		t.Fatalf("status = %+v", st)
	}
	s.StopProxyPorts()
	time.Sleep(300 * time.Millisecond)
	l2, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		t.Fatalf("port %d still held after StopProxyPorts (orphaned process): %v", port, err)
	}
	l2.Close()
	if err := s.startPort(p.ID); err == nil {
		t.Fatal("port started after StopProxyPorts")
	}
}
