package core

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"proxysplit/internal/nodes"
)

// The routing matrix runs the generated app-split config in a real sing-box and
// checks where each request actually goes. The TUN inbound is swapped for a
// local mixed inbound (process_name still matches this test binary), node
// outbounds for fake local proxies that answer with their own tag, and DNS for
// fixed host entries pointing at a local origin that answers "direct".

const matrixForeign, matrixCN, matrixAI, matrixGov = "google.com", "baidu.com", "api.anthropic.com", "www.president.gov.tw"

type matrix struct {
	t        *testing.T
	opts     Options
	sb       *exec.Cmd
	exited   chan error
	port     int
	clash    string
	origin   int
	testProc string
}

func freePortT(t *testing.T) int {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

// fakeProxy is an HTTP CONNECT proxy that never forwards: every tunnelled HTTP
// request is answered with the proxy's tag.
func fakeProxy(t *testing.T, tag string) int {
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
			go func(c net.Conn) {
				defer c.Close()
				br := bufio.NewReader(c)
				req, err := http.ReadRequest(br)
				if err != nil {
					return
				}
				if req.Method == http.MethodConnect {
					io.WriteString(c, "HTTP/1.1 200 OK\r\n\r\n")
					if _, err := http.ReadRequest(br); err != nil {
						return
					}
				}
				fmt.Fprintf(c, "HTTP/1.1 200 OK\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s", len(tag), tag)
			}(c)
		}
	}()
	return l.Addr().(*net.TCPAddr).Port
}

func newMatrix(t *testing.T, opts Options) *matrix {
	t.Helper()
	return newMatrixEgress(t, opts, nil)
}

// newMatrixEgress is newMatrix with a POWER云 egress restriction on the primary
// node ("proxy").
func newMatrixEgress(t *testing.T, opts Options, egress *nodes.Egress) *matrix {
	t.Helper()
	if runtime.GOOS != "windows" {
		t.Skip("process_name matching is exercised on Windows")
	}
	// Run a private copy: other packages' tests clean up stray cores started from
	// the repo's bin path, which would kill ours mid-test when run in parallel.
	src, err := os.ReadFile(singboxPath(t))
	if err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(t.TempDir(), "sing-box.exe")
	if err := os.WriteFile(bin, src, 0o755); err != nil {
		t.Fatal(err)
	}
	exe, _ := os.Executable()
	m := &matrix{t: t, opts: opts, testProc: filepath.Base(exe)}

	origin := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { io.WriteString(w, "direct") })}
	ol, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go origin.Serve(ol)
	t.Cleanup(func() { origin.Close() })
	m.origin = ol.Addr().(*net.TCPAddr).Port

	node, _ := nodes.ParseLink(sampleLinks["vless-reality"])
	node.Egress = egress
	geoDir, _ := filepath.Abs(filepath.Join("..", "..", "bin"))
	m.opts.GeoDir = geoDir
	m.opts.RuleDir = t.TempDir()
	m.opts.ProxyPrivate = true // the fake origin is on 127.0.0.1
	m.clash = fmt.Sprintf("127.0.0.1:%d", freePortT(t))
	m.opts.ClashController = m.clash
	m.writeSets()

	cfgBytes, err := BuildTUNConfig(node, "warn", m.opts)
	if err != nil {
		t.Fatal(err)
	}
	var cfg M
	json.Unmarshal(cfgBytes, &cfg)
	m.port = freePortT(t)
	cfg["inbounds"] = []M{{"type": "mixed", "tag": "tun-in", "listen": "127.0.0.1", "listen_port": m.port}}
	outs := []M{{"type": "direct", "tag": "direct"}}
	for _, o := range cfg["outbounds"].([]interface{}) {
		tag := o.(map[string]interface{})["tag"].(string)
		if tag != "direct" {
			outs = append(outs, M{"type": "http", "tag": tag, "server": "127.0.0.1", "server_port": fakeProxy(t, tag)})
		}
	}
	cfg["outbounds"] = outs
	hosts := M{matrixForeign: "127.0.0.1", matrixCN: "127.0.0.1", matrixAI: "127.0.0.1", matrixGov: "127.0.0.1"}
	dns := cfg["dns"].(map[string]interface{})
	var hostServers []M
	for _, s := range dns["servers"].([]interface{}) {
		hostServers = append(hostServers, M{"type": "hosts", "tag": s.(map[string]interface{})["tag"], "predefined": hosts})
	}
	dns["servers"] = hostServers
	p := filepath.Join(t.TempDir(), "matrix.json")
	b, _ := json.MarshalIndent(cfg, "", " ")
	os.WriteFile(p, b, 0o600)
	var out bytes.Buffer
	m.sb = exec.Command(bin, "run", "-c", p)
	m.sb.Stdout, m.sb.Stderr = &out, &out
	if err := m.sb.Start(); err != nil {
		t.Fatal(err)
	}
	exited := make(chan error, 1)
	m.exited = exited
	go func() { exited <- m.sb.Wait() }()
	t.Cleanup(func() { m.sb.Process.Kill(); <-exited })
	// The first launch can be slow when the machine is busy (e.g. the whole test
	// suite running in parallel), so wait generously but fail fast on an exit.
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case err := <-exited:
			exited <- err
			t.Fatalf("sing-box exited on start (%v):\n%s\n%s", err, out.String(), b)
		default:
		}
		// Both the proxy inbound and the clash controller must be listening.
		if c, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", m.port)); err == nil {
			c.Close()
			if c, err := net.Dial("tcp", m.clash); err == nil {
				c.Close()
				return m
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("sing-box did not come up in 30s:\n%s\n%s", out.String(), b)
	return nil
}

func (m *matrix) writeSets() {
	for tag, data := range SplitRuleSets(m.opts) {
		if err := os.WriteFile(filepath.Join(m.opts.RuleDir, tag+".json"), data, 0o600); err != nil {
			m.t.Fatal(err)
		}
	}
}

func (m *matrix) mode(mode string) {
	req, _ := http.NewRequest(http.MethodPatch, "http://"+m.clash+"/configs", strings.NewReader(`{"mode":"`+mode+`"}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		m.t.Fatal(err)
	}
	resp.Body.Close()
}

// via returns where a request from this process to host went: direct, proxy,
// node-x or reject.
func (m *matrix) via(host string) string {
	proxy, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", m.port))
	cl := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{Proxy: http.ProxyURL(proxy), DisableKeepAlives: true}}
	resp, err := cl.Get(fmt.Sprintf("http://%s:%d/", host, m.origin))
	if err != nil {
		return "reject"
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "reject"
	}
	b, _ := io.ReadAll(resp.Body)
	return string(b)
}

func (m *matrix) expect(name, mode string, want map[string]string) {
	m.t.Helper()
	m.mode(mode)
	for host, w := range want {
		if got := m.via(host); got != w {
			m.t.Errorf("%s / 代理策略=%s / %s: got %s, want %s", name, mode, host, got, w)
		}
	}
}

// placement puts this test binary into one per-app list (or none).
func placement(opts Options, proc, where string) Options {
	other := "someone-else.exe"
	opts.SplitGroups = []SplitGroup{
		{Key: "rule|proxy|bypass_cn", Names: []string{other}, Mode: RouteBypassCN, NodeTag: "proxy"},
		{Key: "global|proxy|global", Names: []string{other}, Mode: RouteGlobal, NodeTag: "proxy"},
		{Key: "rule|node-x|bypass_cn", Names: []string{other}, Mode: RouteBypassCN, NodeTag: "node-x"},
	}
	opts.SplitDirect, opts.SplitBlock = []string{other}, []string{other}
	switch where {
	case "规则":
		opts.SplitGroups[0].Names = append(opts.SplitGroups[0].Names, proc)
	case "全局":
		opts.SplitGroups[1].Names = append(opts.SplitGroups[1].Names, proc)
	case "规则@节点X":
		opts.SplitGroups[2].Names = append(opts.SplitGroups[2].Names, proc)
	case "直连":
		opts.SplitDirect = append(opts.SplitDirect, proc)
	case "拦截":
		opts.SplitBlock = append(opts.SplitBlock, proc)
	}
	return opts
}

func matrixOpts(whitelist bool) Options {
	extra, _ := nodes.ParseLink(sampleLinks["trojan"])
	return Options{Split: true, SplitWhitelist: whitelist, RemoteDNS: true,
		ExtraNodes: []ExtraNode{{Tag: "node-x", Node: extra}}}
}

// TestRoutingMatrix is the contract of 代理策略 × 分流模式 × per-app line.
func TestRoutingMatrix(t *testing.T) {
	type row struct{ rule, global map[string]string }
	both := func(v string) map[string]string { return map[string]string{matrixForeign: v, matrixCN: v} }
	split := func(foreign, cn string) map[string]string {
		return map[string]string{matrixForeign: foreign, matrixCN: cn}
	}
	for _, whitelist := range []bool{true, false} {
		unlistedRule := both("direct") // 只代理列出的
		if !whitelist {
			unlistedRule = split("proxy", "direct") // 默认全走代理 = 规则 for unlisted apps
		}
		cases := map[string]row{
			"未列出":    {unlistedRule, both("proxy")},
			"规则":     {split("proxy", "direct"), both("proxy")},
			"全局":     {both("proxy"), both("proxy")},
			"规则@节点X": {split("node-x", "direct"), both("node-x")},
			"直连":     {both("direct"), both("direct")},
			"拦截":     {both("reject"), both("reject")},
		}
		for where, want := range cases {
			name := fmt.Sprintf("白名单=%v/应用=%s", whitelist, where)
			t.Run(name, func(t *testing.T) {
				exe, _ := os.Executable()
				m := newMatrix(t, placement(matrixOpts(whitelist), filepath.Base(exe), where))
				m.expect(name, "rule", want.rule)
				m.expect(name, "global", want.global)
				direct := both("direct")
				if where == "拦截" {
					direct = both("reject") // 拦截 is an explicit per-app choice, not "proxy"
				}
				m.expect(name, "direct", direct)
			})
		}
	}
}

// TestRoutingMatrixCustomRules: custom rules act only in 规则, never pull an
// unlisted app into the tunnel in whitelist mode, and yield to per-app 直连.
func TestRoutingMatrixCustomRules(t *testing.T) {
	exe, _ := os.Executable()
	proc := filepath.Base(exe)
	custom := []RouteRule{
		{Type: "suffix", Value: matrixCN, Action: "proxy"},
		{Type: "suffix", Value: matrixForeign, Action: "direct"},
	}
	for _, c := range []struct {
		where     string
		whitelist bool
		rule      map[string]string
	}{
		{"规则", true, map[string]string{matrixCN: "proxy", matrixForeign: "direct"}},
		{"规则@节点X", true, map[string]string{matrixCN: "node-x", matrixForeign: "direct"}},
		{"未列出", true, map[string]string{matrixCN: "direct", matrixForeign: "direct"}},
		{"未列出", false, map[string]string{matrixCN: "proxy", matrixForeign: "direct"}},
		{"直连", false, map[string]string{matrixCN: "direct", matrixForeign: "direct"}},
		// 默认全走代理: a listed app's 走代理 custom rule uses the app's own node.
		{"规则@节点X", false, map[string]string{matrixCN: "node-x", matrixForeign: "direct"}},
		{"规则", false, map[string]string{matrixCN: "proxy", matrixForeign: "direct"}},
	} {
		name := fmt.Sprintf("自定义规则/白名单=%v/应用=%s", c.whitelist, c.where)
		t.Run(name, func(t *testing.T) {
			opts := placement(matrixOpts(c.whitelist), proc, c.where)
			opts.CustomRules = custom
			m := newMatrix(t, opts)
			m.expect(name, "rule", c.rule)
			if c.where != "直连" { // 全局 ignores custom rules: all through the app's node
				node := "proxy"
				if c.where == "规则@节点X" {
					node = "node-x"
				}
				m.expect(name, "global", map[string]string{matrixCN: node, matrixForeign: node})
			}
		})
	}
}

// TestRoutingMatrixScoped: a per-app rule limited to some targets (process +
// domain) holds like the app's own choice: 直连 / 拦截 in every 代理策略, a node
// in 规则 and 全局 (代理策略 直连 still pauses it).
func TestRoutingMatrixScoped(t *testing.T) {
	exe, _ := os.Executable()
	proc := filepath.Base(exe)
	for _, c := range []struct {
		outbound, direct, global, rule string
	}{
		{"reject", "reject", "reject", "reject"},
		{"direct", "direct", "direct", "direct"},
		{"node-x", "direct", "node-x", "node-x"},
	} {
		for _, whitelist := range []bool{true, false} {
			name := fmt.Sprintf("限定目标=%s/白名单=%v", c.outbound, whitelist)
			t.Run(name, func(t *testing.T) {
				opts := placement(matrixOpts(whitelist), proc, "规则")
				opts.SplitScoped = []ScopedRule{{Name: proc, Domains: []string{matrixForeign}, Outbound: c.outbound}}
				m := newMatrix(t, opts)
				m.expect(name, "direct", map[string]string{matrixForeign: c.direct, matrixCN: "direct"})
				m.expect(name, "global", map[string]string{matrixForeign: c.global, matrixCN: "proxy"})
				m.expect(name, "rule", map[string]string{matrixForeign: c.rule, matrixCN: "direct"})
			})
		}
	}
}

// TestRoutingMatrixDefaultLine: in 默认全走代理 unlisted apps follow the
// default line; in 只代理列出的 it has no effect (unlisted = direct).
func TestRoutingMatrixDefaultLine(t *testing.T) {
	exe, _ := os.Executable()
	proc := filepath.Base(exe)
	custom := &SplitGroup{Mode: RouteCustom, NodeTag: "node-x", Rules: []RouteRule{{Type: "suffix", Value: matrixCN, Action: "direct"}}}
	for _, c := range []struct {
		name      string
		def       *SplitGroup
		whitelist bool
		want      map[string]string
	}{
		{"未设置=规则", nil, false, map[string]string{matrixForeign: "proxy", matrixCN: "direct"}},
		{"全局", &SplitGroup{Mode: RouteGlobal, NodeTag: "proxy"}, false, map[string]string{matrixForeign: "proxy", matrixCN: "proxy"}},
		{"直连", &SplitGroup{Mode: RouteGlobal, NodeTag: "direct"}, false, map[string]string{matrixForeign: "direct", matrixCN: "direct"}},
		{"自定义线路@节点X", custom, false, map[string]string{matrixForeign: "node-x", matrixCN: "direct"}},
		{"白名单下不生效", custom, true, map[string]string{matrixForeign: "direct", matrixCN: "direct"}},
	} {
		t.Run(c.name, func(t *testing.T) {
			opts := placement(matrixOpts(c.whitelist), proc, "未列出")
			opts.SplitDefault = c.def
			m := newMatrix(t, opts)
			m.expect("默认线路/"+c.name, "rule", c.want)
		})
	}
}

// TestRoutingMatrixHotReload: moving an app between per-app lists takes effect
// on the running core by rewriting the rule-set files only — no restart.
func TestRoutingMatrixHotReload(t *testing.T) {
	exe, _ := os.Executable()
	proc := filepath.Base(exe)
	m := newMatrix(t, placement(matrixOpts(true), proc, "全局"))
	pid := m.sb.Process.Pid
	m.mode("rule")
	steps := []struct{ where, want string }{
		{"全局", "proxy"}, {"直连", "direct"}, {"拦截", "reject"}, {"未列出", "direct"}, {"规则@节点X", "node-x"}, {"全局", "proxy"},
	}
	for _, s := range steps {
		m.opts = placement(m.opts, proc, s.where)
		start := time.Now()
		if err := writeRuleSets(m.opts); err != nil { // the product's writer
			t.Fatal(err)
		}
		var got string
		for i := 0; i < 100; i++ {
			if got = m.via(matrixForeign); got == s.want {
				break
			}
			time.Sleep(20 * time.Millisecond)
		}
		if got != s.want {
			t.Fatalf("after moving the app to %s: got %s, want %s", s.where, got, s.want)
		}
		// service.ruleSetReloadWait (600 ms after this returns) closes the app's
		// old connections; the new route must be live well before that.
		if took := time.Since(start); took > 900*time.Millisecond {
			t.Errorf("moving the app to %s took %v to take effect", s.where, took)
		} else {
			t.Logf("moved to %s: effective after %v", s.where, took)
		}
	}
	select {
	case err := <-m.exited:
		m.exited <- err
		t.Fatalf("core exited during hot reload: %v", err)
	default:
	}
	if m.sb.Process.Pid != pid {
		t.Fatal("core restarted during hot reload")
	}
}

// TestHotReloadMoveHasNoGap: an app moved between two lists (two files change)
// must never fall to the default route in between. In 默认全走代理 that would
// send a 直连 / 拦截 app through the proxy for a moment.
func TestHotReloadMoveHasNoGap(t *testing.T) {
	exe, _ := os.Executable()
	proc := filepath.Base(exe)
	m := newMatrix(t, placement(matrixOpts(false), proc, "直连"))
	m.mode("rule")
	for _, mv := range []struct{ to, want string }{{"拦截", "reject"}, {"直连", "direct"}, {"拦截", "reject"}} {
		stop := make(chan struct{})
		seen := make(chan string, 4096)
		go func() {
			defer close(seen)
			for {
				select {
				case <-stop:
					return
				default:
					seen <- m.via(matrixForeign)
				}
			}
		}()
		m.opts = placement(m.opts, proc, mv.to)
		if err := writeRuleSets(m.opts); err != nil {
			t.Fatal(err)
		}
		time.Sleep(800 * time.Millisecond)
		close(stop)
		counts := map[string]int{}
		for v := range seen {
			counts[v]++
		}
		if counts["proxy"] > 0 {
			t.Errorf("moving to %s: %d requests went through the proxy meanwhile (%v)", mv.to, counts["proxy"], counts)
		}
		if got := m.via(matrixForeign); got != mv.want {
			t.Errorf("after moving to %s: got %s, want %s", mv.to, got, mv.want)
		}
		t.Logf("moving to %s: %v", mv.to, counts)
	}
}

// TestRoutingMatrixBlockBeatsAlwaysDirect: 拦截 cuts an app off even from the
// destinations that are otherwise always direct (our own API domains).
func TestRoutingMatrixBlockBeatsAlwaysDirect(t *testing.T) {
	exe, _ := os.Executable()
	proc := filepath.Base(exe)
	for _, where := range []string{"拦截", "规则"} {
		opts := placement(matrixOpts(true), proc, where)
		opts.DirectDomains = []string{matrixForeign}
		m := newMatrix(t, opts)
		want := "direct"
		if where == "拦截" {
			want = "reject"
		}
		for _, mode := range []string{"rule", "global", "direct"} {
			m.expect("自家接口/"+where, mode, map[string]string{matrixForeign: want})
		}
	}
}

// TestRoutingMatrixAIOnly: a 仅 AI line (POWER云 egress ai_only) only carries
// allowlisted destinations; everything that would have used it goes direct
// instead of being sent to the node and rejected there. Other lines unchanged.
func TestRoutingMatrixAIOnly(t *testing.T) {
	exe, _ := os.Executable()
	proc := filepath.Base(exe)
	aiOnly := &nodes.Egress{Mode: "ai_only", Allow: &nodes.EgressAllow{DomainSuffixes: []string{"anthropic.com"}}}
	ai := func(other string) map[string]string {
		return map[string]string{matrixAI: "proxy", matrixForeign: other, matrixCN: "direct"}
	}
	for _, c := range []struct {
		where        string
		whitelist    bool
		rule, global map[string]string
	}{
		{"全局", true, ai("direct"), ai("direct")},
		{"规则", true, ai("direct"), ai("direct")},
		{"未列出", false, ai("direct"), ai("direct")},
		{"未列出", true, map[string]string{matrixAI: "direct", matrixForeign: "direct", matrixCN: "direct"}, ai("direct")},
		// another (unrestricted) line keeps working as before
		{"规则@节点X", true, map[string]string{matrixAI: "node-x", matrixForeign: "node-x", matrixCN: "direct"},
			map[string]string{matrixAI: "node-x", matrixForeign: "node-x", matrixCN: "node-x"}},
	} {
		name := fmt.Sprintf("仅AI/白名单=%v/应用=%s", c.whitelist, c.where)
		t.Run(name, func(t *testing.T) {
			m := newMatrixEgress(t, placement(matrixOpts(c.whitelist), proc, c.where), aiOnly)
			m.expect(name, "rule", c.rule)
			m.expect(name, "global", c.global)
			m.expect(name, "direct", map[string]string{matrixAI: "direct", matrixForeign: "direct", matrixCN: "direct"})
		})
	}
}

// TestRoutingMatrixBlockedList: destinations the node blocks for every plan go
// direct (the user's own network) instead of into the tunnel; the rest of the
// line is unchanged, in 规则 and 全局 alike.
func TestRoutingMatrixBlockedList(t *testing.T) {
	exe, _ := os.Executable()
	proc := filepath.Base(exe)
	blocked := &nodes.Egress{Mode: "all", Deny: &nodes.EgressAllow{DomainSuffixes: []string{"gov.tw"}}}
	m := newMatrixEgress(t, placement(matrixOpts(true), proc, "全局"), blocked)
	m.expect("拦截名单/全局应用", "rule", map[string]string{matrixGov: "direct", matrixForeign: "proxy", matrixCN: "proxy"})
	m.expect("拦截名单/全局应用", "global", map[string]string{matrixGov: "direct", matrixForeign: "proxy"})
	// combined with 仅 AI
	both := &nodes.Egress{Mode: "ai_only", Allow: &nodes.EgressAllow{DomainSuffixes: []string{"anthropic.com"}}, Deny: blocked.Deny}
	m2 := newMatrixEgress(t, placement(matrixOpts(true), proc, "全局"), both)
	m2.expect("仅AI+拦截名单", "rule", map[string]string{matrixGov: "direct", matrixAI: "proxy", matrixForeign: "direct"})
}
