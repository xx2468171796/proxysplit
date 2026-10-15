package service

import (
	"fmt"
	"strings"
	"testing"

	"proxysplit/internal/core"
)

func TestLogRingSinceAcrossTrim(t *testing.T) {
	var r logRing
	for i := 0; i < 10; i++ {
		r.add(fmt.Sprint(i))
	}
	mark := r.mark()
	r.add("a")
	r.add("b")
	if got := strings.Join(r.since(mark), ","); got != "a,b" {
		t.Fatalf("since = %q", got)
	}
	for i := 0; i < logRingSize; i++ { // forces trims
		r.add("x")
	}
	mark = r.mark()
	r.add("last")
	if got := r.since(mark); len(got) != 1 || got[0] != "last" {
		t.Fatalf("since after trim = %v", got)
	}
	if got := r.since(0); len(got) > logRingSize || got[len(got)-1] != "last" {
		t.Fatalf("since(0) len %d", len(got))
	}
}

func TestRedactCoreConfig(t *testing.T) {
	in := `{"outbounds":[{"type":"vless","uuid":"u-1","password":"p","tls":{"reality":{"public_key":"pk","short_id":"s"}},"server":"h"}],"experimental":{"clash_api":{"secret":"c"}}}`
	out := string(redactCoreConfig([]byte(in)))
	for _, secret := range []string{"u-1", `"p"`, `"s"`, `"c"`} {
		if strings.Contains(out, secret) {
			t.Fatalf("%s leaked: %s", secret, out)
		}
	}
	if !strings.Contains(out, `"server":"h"`) || !strings.Contains(out, `"public_key":"pk"`) {
		t.Fatalf("non-secret fields lost: %s", out)
	}
}

// TestExpectRoute mirrors the routing contract checked by the core matrix tests.
func TestExpectRoute(t *testing.T) {
	all := builtinLines()
	line := func(id string) *Line { return lineByID(all, id) }
	custom := &Line{ID: "c1", Routing: Routing{Mode: core.RouteCustom}}
	for _, c := range []struct {
		name        string
		snap        DiagSnapshot
		app, def    *Line
		cn, foreign string
	}{
		{"stopped", DiagSnapshot{}, line(LineRule), nil, "direct", "direct"},
		{"白名单 规则 列出", DiagSnapshot{Running: true, ClashMode: "rule", SplitMode: "whitelist"}, line(LineRule), nil, "direct", "node"},
		{"白名单 规则 未列出", DiagSnapshot{Running: true, ClashMode: "rule", SplitMode: "whitelist"}, nil, nil, "direct", "direct"},
		{"白名单 全局 未列出", DiagSnapshot{Running: true, ClashMode: "global", SplitMode: "whitelist"}, nil, nil, "node", "node"},
		{"黑名单 规则 未列出", DiagSnapshot{Running: true, ClashMode: "rule", SplitMode: "blacklist"}, nil, line(LineRule), "direct", "node"},
		{"黑名单 默认直连", DiagSnapshot{Running: true, ClashMode: "rule", SplitMode: "blacklist"}, nil, line(LineDirect), "direct", "direct"},
		{"黑名单 默认全局", DiagSnapshot{Running: true, ClashMode: "rule", SplitMode: "blacklist"}, nil, line(LineGlobal), "node", "node"},
		{"应用全局", DiagSnapshot{Running: true, ClashMode: "rule", SplitMode: "whitelist"}, line(LineGlobal), nil, "node", "node"},
		{"应用直连 全局策略", DiagSnapshot{Running: true, ClashMode: "global"}, line(LineDirect), nil, "direct", "direct"},
		{"应用拦截 直连策略", DiagSnapshot{Running: true, ClashMode: "direct"}, line(LineBlock), nil, "reject", "reject"},
		{"直连策略", DiagSnapshot{Running: true, ClashMode: "direct"}, line(LineRule), nil, "direct", "direct"},
		{"整机全局 规则", DiagSnapshot{Running: true, ClashMode: "rule", TunMode: true}, line(LineBlock), nil, "direct", "node"},
		{"自定义线路不判定", DiagSnapshot{Running: true, ClashMode: "rule"}, custom, nil, "", ""},
	} {
		if got := expectRoute(c.snap, c.app, c.def, true); got != c.cn {
			t.Errorf("%s 国内: got %q want %q", c.name, got, c.cn)
		}
		if got := expectRoute(c.snap, c.app, c.def, false); got != c.foreign {
			t.Errorf("%s 境外: got %q want %q", c.name, got, c.foreign)
		}
	}
}

func TestCustomHits(t *testing.T) {
	rules := []core.RouteRule{{Type: "suffix", Value: "baidu.com"}, {Type: "keyword", Value: "goog"}}
	for host, want := range map[string]bool{"www.baidu.com": true, "baidu.com": true, "notbaidu.com": false, "www.google.com": true, "www.qq.com": false} {
		if customHits(rules, host) != want {
			t.Errorf("%s: want %v", host, want)
		}
	}
}

func TestRouteCategory(t *testing.T) {
	for _, c := range []struct {
		r    RouteTestResult
		want string
	}{
		{RouteTestResult{OK: true, Hops: []RouteHop{{OutTag: "direct"}}}, "direct"},
		{RouteTestResult{OK: true, Hops: []RouteHop{{OutTag: "node-abc"}}}, "node"},
		{RouteTestResult{Hops: []RouteHop{{OutTag: "reject"}}}, "reject"},
		{RouteTestResult{}, "reject"},
		{RouteTestResult{OK: true}, "unknown"},
	} {
		if got := routeCategory(c.r, true); got != c.want {
			t.Errorf("%+v: got %s want %s", c.r, got, c.want)
		}
	}
	if routeCategory(RouteTestResult{}, false) != "direct" {
		t.Error("stopped core must be direct")
	}
}

func TestIsProbePath(t *testing.T) {
	dir := `C:\Users\ADMINI~1\AppData\Local\Temp\ps-route-123`
	for path, want := range map[string]bool{
		`C:\Users\Administrator\AppData\Local\Temp\ps-route-123\msedge.exe`:         true, // long form of the 8.3 temp dir
		`c:/users/administrator/appdata/local/temp/ps-route-123/MSEDGE.EXE`:         true,
		`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`:              false, // the real, running Edge
		`C:\Users\Administrator\AppData\Local\Temp\ps-route-1234\msedge.exe`:        false,
		`C:\Users\Administrator\AppData\Local\Temp\ps-route-123\msedgewebview2.exe`: false,
	} {
		if got := isProbePath(path, dir, "msedge.exe"); got != want {
			t.Errorf("%s: got %v want %v", path, got, want)
		}
	}
}

func TestMatchSecurity(t *testing.T) {
	got := matchSecurity(map[string]bool{"hipsdaemon.exe": true, "usysdiag.exe": true, "chrome.exe": true, "360tray.exe": true})
	if strings.Join(got, ",") != "火绒,360 安全卫士 / 360 杀毒" {
		t.Fatalf("got %v", got)
	}
	if matchSecurity(map[string]bool{"chrome.exe": true}) != nil {
		t.Fatal("no product expected")
	}
}

func TestSelfTestHintsBlockedDirect(t *testing.T) {
	rep := SelfTestReport{Cases: []SelfTestCase{
		{Site: "www.baidu.com", Result: RouteTestResult{Route: "direct", OK: false}},
		{Site: "www.qq.com", Result: RouteTestResult{Route: "direct", OK: true}},
		{Site: "www.google.com", Result: RouteTestResult{Route: "direct", OK: false}}, // blocked network, normal
	}}
	h := selfTestHints(rep, "检测到安全软件：火绒。")
	if len(h) != 1 || !strings.Contains(h[0], "1 次") || !strings.Contains(h[0], "火绒") {
		t.Fatalf("hints = %v", h)
	}
	down := SelfTestReport{DNS: []DNSCheck{{Error: "timeout"}, {Error: "timeout"}}, Cases: []SelfTestCase{
		{Site: "www.baidu.com", Result: RouteTestResult{Route: "reject"}},
		{Site: "www.qq.com", Result: RouteTestResult{Route: "reject"}},
	}}
	if h := selfTestHints(down, ""); len(h) != 1 || !strings.Contains(h[0], "内核本身被拦") {
		t.Fatalf("all-down hints = %v", h)
	}
	if len(selfTestHints(SelfTestReport{}, "")) != 0 {
		t.Fatal("no hints expected when all fine")
	}
}
