package appid

import (
	"testing"
	"time"
)

// Real sing-box 1.14 info lines captured from a route test on this project's
// dev machine (process path shortened).
func logConn(m *Monitor, id, srcPort, dest, process, tag string, at time.Time) {
	p := "+0800 2026-10-22 14:16:56 INFO [" + id + " 0ms] "
	m.OnLog(p+"inbound/tun[tun-in]: inbound connection from 172.19.0.1:"+srcPort, at)
	m.OnLog(p+"inbound/tun[tun-in]: inbound connection to "+dest, at)
	m.OnLog(p+`router: found process path: C:\Temp\`+process, at)
	if tag != "" {
		m.OnLog(p+"outbound/vless["+tag+"]: outbound connection to "+dest, at)
	}
}

func TestShortConnectionIsNotAFailure(t *testing.T) {
	var m Monitor
	t0 := time.Date(2026, 10, 22, 14, 0, 0, 0, time.UTC)
	// 0.3 s request: in the log, never in a snapshot.
	logConn(&m, "1", "51640", "142.251.156.119:443", "Ld9BoxHeadless.exe", "proxy", t0)
	m.Update(nil, t0.Add(time.Second))
	if s := m.Stats([]string{"Ld9BoxHeadless.exe"})[0]; s.Total != 1 || s.Failed != 0 || s.Done != 0 {
		t.Fatalf("still open: %+v", s)
	}
	m.Update(nil, t0.Add(logOnlyTTL+time.Second))
	s := m.Stats([]string{"Ld9BoxHeadless.exe"})[0]
	if s.Done != 1 || s.Failed != 0 || s.Health != HealthOK {
		t.Fatalf("short conn = %+v", s)
	}
	if a := m.AccessLog("ld9boxheadless.exe")[0]; a.Status != StatusDone || a.Outbound != "proxy" {
		t.Fatalf("access = %+v", a)
	}
}

func TestJoinSnapshotBytes(t *testing.T) {
	var m Monitor
	m.SetLabeler(func(tag string) string { return "节点-" + tag })
	t0 := time.Now()
	logConn(&m, "2", "50000", "1.2.3.4:443", "HD-Player.exe", "proxy", t0)
	snap := Conn{ID: "uuid-1", Process: "HD-Player.exe", SrcPort: "50000", Dest: "1.2.3.4:443", Host: "play.google.com"}
	m.Update([]Conn{snap}, t0.Add(time.Second))
	snap.Download = 900
	m.Update([]Conn{snap}, t0.Add(2*time.Second))
	m.Update(nil, t0.Add(3*time.Second))
	s := m.Stats([]string{"HD-Player.exe"})[0]
	if s.Total != 1 || s.OK != 1 || s.Download != 900 || s.Live != 0 {
		t.Fatalf("joined = %+v", s)
	}
	if a := m.AccessLog("HD-Player.exe")[0]; a.Host != "play.google.com" || a.Status != StatusOK || a.Outbound != "节点-proxy" {
		t.Fatalf("access = %+v", a)
	}
}

func TestNoReplyAndLoggedError(t *testing.T) {
	var m Monitor
	t0 := time.Now()
	// Held open 5 s with nothing received (google.com:81 through the node).
	logConn(&m, "3", "56828", "142.251.156.119:81", "HD-Player.exe", "proxy", t0)
	c := Conn{ID: "u3", Process: "HD-Player.exe", SrcPort: "56828", Dest: "142.251.156.119:81"}
	for i := 1; i <= 5; i++ {
		m.Update([]Conn{c}, t0.Add(time.Duration(i)*time.Second))
	}
	m.Update(nil, t0.Add(6*time.Second))
	// Dial error logged by the core.
	logConn(&m, "4", "56900", "10.0.0.1:443", "HD-Player.exe", "direct", t0)
	m.OnLog("+0800 2026-10-22 14:17:00 ERROR [4 3.0s] connection: open connection to 10.0.0.1:443 using outbound/direct[direct]: dial tcp 10.0.0.1:443: i/o timeout", t0.Add(3*time.Second))

	s := m.Stats([]string{"HD-Player.exe"})[0]
	if s.Failed != 2 || s.OK != 0 {
		t.Fatalf("stat = %+v", s)
	}
	log := m.AccessLog("HD-Player.exe")
	if log[0].Status != StatusFailed || log[0].Reason == "" || log[1].Status != StatusFailed {
		t.Fatalf("access = %+v", log)
	}
	if h := m.FailedHosts("HD-Player.exe"); len(h) != 2 {
		t.Fatalf("failed hosts = %v", h)
	}
}

func TestBlockedAndDNSLines(t *testing.T) {
	var m Monitor
	t0 := time.Now()
	// A DNS lookup logs a process path without an inbound connection: ignored.
	m.OnLog(`+0800 2026-10-22 14:16:56 INFO [9 0ms] router: found process path: C:\Temp\NoxVMHandle.exe`, t0)
	if s := m.Stats(nil); len(s) != 0 {
		t.Fatalf("dns line created stats: %+v", s)
	}
	// Reject rule: process found, no outbound line, never in a snapshot.
	logConn(&m, "10", "49634", "142.251.153.119:443", "NoxVMHandle.exe", "", t0)
	m.Update(nil, t0.Add(logOnlyTTL+time.Second))
	if a := m.AccessLog("NoxVMHandle.exe")[0]; a.Status != StatusBlocked || a.Outbound != "拦截" {
		t.Fatalf("reject = %+v", a)
	}
	m.Update([]Conn{{ID: "b", Process: "NoxVMHandle.exe", SrcPort: "1", Dest: "1.1.1.1:443", Blocked: true}}, t0)
	m.Update(nil, t0.Add(time.Second))
	s := m.Stats([]string{"NoxVMHandle.exe"})[0]
	if s.Failed != 0 || m.AccessLog("NoxVMHandle.exe")[0].Status != StatusBlocked {
		t.Fatalf("blocked = %+v", s)
	}
}

func TestNormalizeCustom(t *testing.T) {
	got, err := NormalizeCustom([]App{{Name: " 我的模拟器 ", Processes: []string{`C:\x\Foo`, "foo.exe", ""}}})
	if err != nil || len(got) != 1 || len(got[0].Processes) != 1 || got[0].Processes[0] != "Foo.exe" || got[0].ID == "" {
		t.Fatalf("got %+v err %v", got, err)
	}
	if _, err := NormalizeCustom([]App{{Name: "a", Processes: []string{"bad/..exe?"}}}); err == nil {
		t.Fatal("want invalid process error")
	}
	if _, err := NormalizeCustom([]App{{Name: "a"}}); err == nil {
		t.Fatal("want empty process error")
	}
}

func TestTeardownNoiseIsNotFailure(t *testing.T) {
	var m Monitor
	t0 := time.Now()
	logConn(&m, "20", "40000", "1.1.1.1:443", "Ld9BoxHeadless.exe", "proxy", t0)
	m.OnLog("+0800 2026-10-22 14:17:00 ERROR [20 1.0s] connection: upload closed: use of closed network connection", t0)
	if s := m.Stats([]string{"Ld9BoxHeadless.exe"})[0]; s.Failed != 0 {
		t.Fatalf("teardown error counted as failure: %+v", s)
	}
}

func TestJoinWhenDestinationRewritten(t *testing.T) {
	var m Monitor
	t0 := time.Now()
	logConn(&m, "21", "41000", "198.18.0.5:443", "HD-Player.exe", "proxy", t0)
	// Snapshot reports the sniffed real destination, same source port.
	c := Conn{ID: "u21", Process: "HD-Player.exe", SrcPort: "41000", Dest: "142.250.1.1:443", Download: 10}
	m.Update([]Conn{c}, t0.Add(time.Second))
	m.Update(nil, t0.Add(logOnlyTTL+2*time.Second))
	if s := m.Stats([]string{"HD-Player.exe"})[0]; s.Total != 1 || s.OK != 1 {
		t.Fatalf("double counted: %+v", s)
	}
}

func TestQUICBlockExplained(t *testing.T) {
	var m Monitor
	t0 := time.Now()
	p := "+0800 2026-10-22 14:53:26 INFO [30 0ms] "
	m.OnLog(p+"inbound/tun[tun-in]: inbound packet connection from 172.19.0.1:50001", t0)
	m.OnLog(p+"inbound/tun[tun-in]: inbound packet connection to 172.217.113.4:443", t0)
	m.OnLog(p+`router: found process path: C:\Program Files\ldplayer9box\Ld9BoxHeadless.exe`, t0)
	m.Update(nil, t0.Add(logOnlyTTL+time.Second))
	a := m.AccessLog("Ld9BoxHeadless.exe")[0]
	if a.Status != StatusBlocked || a.Network != "udp" || a.Reason == "" {
		t.Fatalf("quic = %+v", a)
	}
	if s := m.Stats([]string{"Ld9BoxHeadless.exe"})[0]; s.Failed != 0 {
		t.Fatalf("quic counted as failure: %+v", s)
	}
}

func TestDirRollupAndHosts(t *testing.T) {
	var m Monitor
	t0 := time.Now()
	vm := `C:\Program Files\ldplayer9box\`
	p := func(id string) string { return "+0800 2026-10-22 14:53:26 INFO [" + id + " 0ms] " }
	add := func(id, port, dest, exe string) {
		m.OnLog(p(id)+"inbound/tun[tun-in]: inbound connection from 172.19.0.1:"+port, t0)
		m.OnLog(p(id)+"inbound/tun[tun-in]: inbound connection to "+dest, t0)
		m.OnLog(p(id)+"router: found process path: "+vm+exe, t0)
		m.OnLog(p(id)+"outbound/vless[proxy]: outbound connection to "+dest, t0)
	}
	add("1", "1001", "1.1.1.1:443", "Ld9BoxHeadless.exe")
	add("2", "1002", "2.2.2.2:443", "VBoxNetNAT.exe")
	add("3", "1003", "2.2.2.2:443", "VBoxNetNAT.exe")
	m.OnLog("+0800 2026-10-22 14:53:27 ERROR [3 3.0s] connection: open connection to 2.2.2.2:443 using outbound/vless[proxy]: dial tcp: i/o timeout", t0)
	m.Update([]Conn{{ID: "a", Process: "Ld9BoxHeadless.exe", SrcPort: "1001", Dest: "1.1.1.1:443", Host: "play.google.com", Download: 99}}, t0.Add(time.Second))

	s := m.Stats([]string{vm})[0]
	if s.Total != 3 || s.OK != 1 || s.Failed != 1 || s.Process != vm {
		t.Fatalf("dir rollup = %+v", s)
	}
	if ps := m.Processes(vm); len(ps) != 2 || ps[0].Path == "" {
		t.Fatalf("processes = %+v", ps)
	}
	if other := m.Stats([]string{`C:\Program Files\ldplayer9`})[0]; other.Total != 0 {
		t.Fatalf("prefix leaked into sibling folder: %+v", other)
	}
	hosts := Hosts(m.AccessLog(vm))
	if len(hosts) != 2 || hosts[0].Host != "2.2.2.2:443" || hosts[0].Failed != 1 || hosts[0].LastError == "" || hosts[0].Conns != 2 {
		t.Fatalf("hosts = %+v", hosts)
	}
	if a := m.AccessLog(vm); a[0].Process == "" {
		t.Fatalf("access without process: %+v", a[0])
	}
}
