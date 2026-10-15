package service

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"proxysplit/internal/core"
)

// Route tests send a real request as a chosen program name: a copy of the
// system curl.exe renamed to that name, so the core's process_name rules treat
// it exactly like the real program. The result shows where its connections
// went (from the live clash_api connection table and the core log).

// UnlistedProbe is the program name used to test "an app that is not listed".
const UnlistedProbe = "proxysplit-unlisted-probe.exe"

var probeNameRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9 ._+\-]{0,80}\.exe$`)

// RouteHop is one connection the probe made.
type RouteHop struct {
	Host     string `json:"host"`
	Dest     string `json:"dest,omitempty"`
	Rule     string `json:"rule,omitempty"`     // matched rule (clash_api), when captured
	OutTag   string `json:"outTag"`             // proxy | direct | node-<id> | reject
	Outbound string `json:"outbound,omitempty"` // friendly label
}

// RouteTestResult is the outcome of one probe request.
type RouteTestResult struct {
	Process  string     `json:"process"`
	URL      string     `json:"url"`
	OK       bool       `json:"ok"`
	HTTPCode int        `json:"httpCode"`
	Seconds  float64    `json:"seconds"`
	Error    string     `json:"error,omitempty"`
	Route    string     `json:"route"` // direct | node | reject | unknown
	Hops     []RouteHop `json:"hops"`
	LogTrace []string   `json:"logTrace,omitempty"`
	Note     string     `json:"note,omitempty"`
}

var (
	logIDRe  = regexp.MustCompile(`\[(\d+) [^\]]*\] (.*)$`)
	logOutRe = regexp.MustCompile(`outbound/[^\[]+\[([^\]]+)\]: outbound (?:packet )?connection to (\S+)`)
)

// curlErrors explains the curl exit codes a routing problem typically causes.
var curlErrors = map[int]string{
	6: "域名解析失败（DNS）", 7: "连不上目标", 28: "超时", 35: "TLS 握手失败",
	52: "服务器没有返回数据", 56: "连接被断开", 60: "证书校验失败",
}

// RouteTest requests rawURL as program `process` and reports where it went.
func (s *Service) RouteTest(process, rawURL string) RouteTestResult {
	process = strings.TrimSpace(process)
	if process == "" {
		process = UnlistedProbe
	}
	if !strings.HasSuffix(strings.ToLower(process), ".exe") {
		process += ".exe"
	}
	res := RouteTestResult{Process: process, URL: rawURL, Route: "unknown", Hops: []RouteHop{}}
	if !probeNameRe.MatchString(process) {
		res.Error = "程序名无效（只要文件名，如 chrome.exe）"
		return res
	}
	if u, err := url.Parse(rawURL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		res.Error = "URL 无效（需要 http:// 或 https:// 开头）"
		return res
	}
	curl := filepath.Join(os.Getenv("SystemRoot"), "System32", "curl.exe")
	src, err := os.ReadFile(curl)
	if err != nil {
		res.Error = "找不到系统 curl.exe：" + err.Error()
		return res
	}
	dir, err := os.MkdirTemp("", "ps-route-")
	if err != nil {
		res.Error = err.Error()
		return res
	}
	defer os.RemoveAll(dir)
	exe := filepath.Join(dir, process)
	if err := os.WriteFile(exe, src, 0o755); err != nil {
		res.Error = err.Error()
		return res
	}

	s.mu.Lock()
	port, secret := s.clashPort, s.clashSecret
	labels := s.outboundLabelsLocked()
	s.mu.Unlock()
	running := s.core.Running()
	if !running {
		res.Note = "代理没有运行，这次请求不经过 ProxySplit。"
	}

	mark := s.logs.mark()
	ctx, cancel := context.WithCancel(context.Background())
	var mu sync.Mutex
	seen := map[string]RouteHop{}
	var wg sync.WaitGroup
	if running && port > 0 {
		wg.Add(1)
		go func() { // the clash table only lists open connections: poll fast
			defer wg.Done()
			t := time.NewTicker(20 * time.Millisecond)
			defer t.Stop()
			for {
				if conns, err := clashConnections(port, secret); err == nil {
					mu.Lock()
					for _, c := range conns {
						if isProbePath(c.Path, dir, process) { // our copy only, not a running program of the same name
							seen[c.Host+"|"+c.Dest] = RouteHop{Host: c.Host, Dest: c.Dest, Rule: c.Rule, OutTag: c.OutTag}
						}
					}
					mu.Unlock()
				}
				select {
				case <-ctx.Done():
					return
				case <-t.C:
				}
			}
		}()
	}

	rctx, rcancel := context.WithTimeout(context.Background(), 20*time.Second)
	out, runErr := exec.CommandContext(rctx, exe, "-s", "-o", "NUL", "-A", "Mozilla/5.0 ProxySplit-RouteTest",
		"-w", "%{http_code} %{time_total}", "--max-time", "15", rawURL).Output()
	rcancel()
	time.Sleep(400 * time.Millisecond) // let the core log the connection's outbound
	cancel()
	wg.Wait()

	if f := strings.Fields(string(out)); len(f) == 2 {
		res.HTTPCode, _ = strconv.Atoi(f[0])
		res.Seconds, _ = strconv.ParseFloat(f[1], 64)
	}
	if runErr != nil {
		code := -1
		if ee, ok := runErr.(*exec.ExitError); ok {
			code = ee.ExitCode()
		}
		res.Error = fmt.Sprintf("curl 退出码 %d", code)
		if why := curlErrors[code]; why != "" {
			res.Error += "：" + why
		}
	}
	res.OK = runErr == nil && res.HTTPCode > 0 && res.HTTPCode < 500

	// Core log: every line of the probe's connections (needs log level info+).
	ids := map[string]bool{}
	logHops := map[string]RouteHop{}
	lines := s.logs.since(mark)
	for _, raw := range lines {
		l := ansiRe.ReplaceAllString(raw, "")
		m := logIDRe.FindStringSubmatch(l)
		if m == nil {
			continue
		}
		if path, found := strings.CutPrefix(m[2], "router: found process path: "); found && isProbePath(path, dir, process) {
			ids[m[1]] = true
		}
	}
	for _, raw := range lines {
		l := ansiRe.ReplaceAllString(raw, "")
		m := logIDRe.FindStringSubmatch(l)
		if m == nil || !ids[m[1]] {
			continue
		}
		if len(res.LogTrace) < 60 {
			res.LogTrace = append(res.LogTrace, l)
		}
		if o := logOutRe.FindStringSubmatch(m[2]); o != nil {
			logHops[m[1]] = RouteHop{Host: o[2], OutTag: o[1]}
		}
	}
	for _, h := range seen {
		res.Hops = append(res.Hops, h)
	}
	if len(res.Hops) == 0 {
		for _, h := range logHops {
			res.Hops = append(res.Hops, h)
		}
	}
	for i := range res.Hops {
		res.Hops[i].Outbound = labelOutbound(res.Hops[i].OutTag, labels)
	}
	res.Route = routeCategory(res, running)
	if running && len(res.Hops) == 0 && len(ids) == 0 && res.Note == "" {
		res.Note = "没有抓到这次请求的连接记录（日志级别需为 info 或 debug）。"
	}
	return res
}

// isProbePath reports whether a process path is our renamed curl copy: its
// unique temp folder plus the program name (the core reports long paths while
// os.MkdirTemp may return an 8.3 short one, so whole paths can differ).
func isProbePath(path, dir, process string) bool {
	p := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(path), "/", `\`))
	return strings.Contains(p, `\`+strings.ToLower(filepath.Base(dir))+`\`) && strings.HasSuffix(p, `\`+strings.ToLower(process))
}

// routeCategory summarises a probe as direct / node / reject / unknown.
func routeCategory(r RouteTestResult, running bool) string {
	if !running {
		return "direct"
	}
	for _, h := range r.Hops {
		switch h.OutTag {
		case "direct":
			return "direct"
		case "reject", "block":
			return "reject"
		case "":
		default:
			return "node"
		}
	}
	if !r.OK {
		return "reject" // connection seen or not, it never got an outbound
	}
	return "unknown"
}

// SelfTestCase is one (program, site) check with its expected route.
type SelfTestCase struct {
	Process string          `json:"process"`
	Listed  string          `json:"listed"` // the app's line, or "未列出"
	Site    string          `json:"site"`
	Expect  string          `json:"expect"`  // direct | node | reject | "" (not judged)
	Verdict string          `json:"verdict"` // pass | FAIL | info
	Result  RouteTestResult `json:"result"`
}

// SelfTestReport is the outcome of SelfTest.
type SelfTestReport struct {
	Snapshot DiagSnapshot   `json:"snapshot"`
	DNS      []DNSCheck     `json:"dns"`
	DNSLogs  []string       `json:"dnsLogs,omitempty"` // core DNS errors while testing
	Hints    []string       `json:"hints,omitempty"`   // likely causes of the failures
	Cases    []SelfTestCase `json:"cases"`
	Failed   int            `json:"failed"`
	Summary  string         `json:"summary"`
}

var selfTestSites = []struct{ host, url string }{
	{"www.baidu.com", "https://www.baidu.com/"},
	{"www.qq.com", "https://www.qq.com/"},
	{"www.google.com", "https://www.google.com/generate_204"},
	{"www.youtube.com", "https://www.youtube.com/"},
}

// SelfTest checks every whole-app rule (up to 6) and an unlisted program
// against mainland and foreign sites, comparing with what the current
// 代理策略 / 分流模式 / lines should produce.
func (s *Service) SelfTest() SelfTestReport {
	rep := SelfTestReport{Snapshot: s.Diagnose()}
	mark := s.logs.mark()
	rep.DNS = append(rep.DNS, dnsRound(1)...)

	s.mu.Lock()
	all := s.allLinesLocked()
	type probe struct {
		name string
		line *Line
	}
	var probes []probe
	for _, r := range s.cfg.Rules {
		if !r.Enabled || r.Scoped() || len(probes) >= 6 {
			continue
		}
		name := filepath.Base(r.Match)
		if name == "" || name == "." {
			name = filepath.Base(r.Path)
		}
		if !probeNameRe.MatchString(name) {
			continue
		}
		id := r.Line
		if id == "" {
			id = LineRule
		}
		probes = append(probes, probe{name, lineByID(all, id)})
	}
	probes = append(probes, probe{UnlistedProbe, nil})
	defLine := lineByID(all, s.cfg.DefaultLine)
	custom := append([]core.RouteRule(nil), s.cfg.CustomRules...)
	s.mu.Unlock()

	snap := rep.Snapshot
	restricted := false
	for _, n := range snap.Nodes {
		if n.Egress != "" {
			restricted = true
		}
	}
	for _, p := range probes {
		listed := "未列出"
		if p.line != nil {
			listed = p.line.Name
		}
		for i, site := range selfTestSites {
			cn := i < 2
			exp := expectRoute(snap, p.line, defLine, cn)
			if customHits(custom, site.host) || (!cn && restricted && exp == "node") {
				exp = "" // a custom rule or a POWER云 access scope decides: report only
			}
			c := SelfTestCase{Process: p.name, Listed: listed, Site: site.host, Expect: exp, Result: s.RouteTest(p.name, site.url)}
			// Going direct to a foreign site may legitimately fail (blocked network).
			reached := c.Result.OK || exp == "reject" || (exp == "direct" && !cn)
			switch {
			case exp == "":
				c.Verdict = "info"
			case c.Result.Route == exp && reached:
				c.Verdict = "pass"
			default:
				c.Verdict = "FAIL"
				rep.Failed++
			}
			rep.Cases = append(rep.Cases, c)
		}
	}
	rep.DNS = append(rep.DNS, dnsRound(2)...)
	dnsFailed := 0
	for _, d := range rep.DNS {
		if d.Error != "" {
			dnsFailed++
		}
	}
	for _, l := range s.logs.since(mark) {
		l = ansiRe.ReplaceAllString(l, "")
		low := strings.ToLower(l)
		if strings.Contains(low, "dns") && (strings.Contains(l, "ERROR") || strings.Contains(l, "WARN")) && len(rep.DNSLogs) < 60 {
			rep.DNSLogs = append(rep.DNSLogs, l)
		}
	}
	rep.Hints = selfTestHints(rep, s.securityAdvice(rep.Snapshot.Security))
	rep.Summary = fmt.Sprintf("%d 项检查，%d 项不符合预期；DNS 解析 %d 次，失败 %d 次", len(rep.Cases), rep.Failed, len(rep.DNS), dnsFailed)
	return rep
}

// selfTestHints explains failure patterns: a mainland site that was routed
// direct and still could not connect means something on the machine (usually
// security software) is blocking the core, not a routing problem.
func selfTestHints(rep SelfTestReport, securityAdvice string) []string {
	var hints []string
	blockedDirect := 0
	for _, c := range rep.Cases {
		cn := c.Site == selfTestSites[0].host || c.Site == selfTestSites[1].host
		if cn && c.Result.Route == "direct" && !c.Result.OK {
			blockedDirect++
		}
	}
	if blockedDirect > 0 {
		h := fmt.Sprintf("%d 次访问国内网站已按规则直连，却连不上：不是分流规则的问题，是本机有东西拦了代理内核（常见是安全软件或防火墙）。", blockedDirect)
		if securityAdvice != "" {
			h += securityAdvice
		} else {
			h += "检查安全软件 / 防火墙是否拦截了 proxysplit.exe 和 sing-box.exe。"
		}
		hints = append(hints, h)
	} else if securityAdvice != "" && rep.Failed > 0 {
		hints = append(hints, securityAdvice)
	}
	return hints
}

// DNSCheck is one system-resolver lookup made while the core runs (the
// lookup goes through the core's DNS hijack like any program's).
type DNSCheck struct {
	Round  int    `json:"round"`
	Host   string `json:"host"`
	Millis int64  `json:"ms"`
	Result string `json:"result,omitempty"`
	Error  string `json:"error,omitempty"`
}

func dnsRound(round int) []DNSCheck {
	var out []DNSCheck
	for _, site := range selfTestSites {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		start := time.Now()
		ips, err := net.DefaultResolver.LookupHost(ctx, site.host)
		cancel()
		c := DNSCheck{Round: round, Host: site.host, Millis: time.Since(start).Milliseconds()}
		if err != nil {
			c.Error = err.Error()
		} else {
			c.Result = strings.Join(ips, ", ")
		}
		out = append(out, c)
	}
	return out
}

// expectRoute is what the routing contract promises (see BuildTUNConfig):
// line nil = an unlisted program.
func expectRoute(d DiagSnapshot, line, defLine *Line, cn bool) string {
	if !d.Running {
		return "direct"
	}
	if line != nil && !d.TunMode {
		switch line.ID {
		case LineBlock:
			return "reject"
		case LineDirect:
			return "direct"
		}
	}
	switch d.ClashMode {
	case "direct":
		return "direct"
	case "global":
		return "node"
	}
	if d.TunMode {
		line = nil
	} else if line == nil {
		if d.SplitMode != "blacklist" {
			return "direct" // 只代理列出的
		}
		line = defLine
	}
	mode := core.RouteBypassCN
	if line != nil {
		if line.ID == LineDirect {
			return "direct"
		}
		mode = line.Routing.Mode
	}
	switch mode {
	case core.RouteGlobal:
		return "node"
	case core.RouteBypassCN:
		if cn {
			return "direct"
		}
		return "node"
	}
	return "" // custom line: its own rules decide
}

// customHits reports whether a global custom rule matches host.
func customHits(rules []core.RouteRule, host string) bool {
	for _, r := range rules {
		v := strings.ToLower(r.Value)
		switch r.Type {
		case "domain":
			if host == v {
				return true
			}
		case "suffix":
			if host == v || strings.HasSuffix(host, "."+v) {
				return true
			}
		case "keyword":
			if strings.Contains(host, v) {
				return true
			}
		}
	}
	return false
}
