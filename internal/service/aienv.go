package service

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"proxysplit/internal/aiguard"
	"proxysplit/internal/proc"
	"proxysplit/internal/sysproxy"
)

// AI 环境检测（AI 编程官网客户）：按公司 AI 防风控要求逐项核对这台电脑——AI 是否只走我们的线路、
// 出口地区、DNS 锁、IPv6、时区、系统时间、有没有别的代理 / VPN 抢流量、开机自启。能修的给出修复编号，
// 由 App.FixAIEnv 执行（设计 docs/AI强制走线路.md）。

// AIEnvItem is one check result. Status: ok | warn | fail | info.
type AIEnvItem struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
	Detail string `json:"detail"`
	Fix    string `json:"fix,omitempty"` // fix id for App.FixAIEnv; "" = nothing to click
}

// AIEnvReport is the whole check.
type AIEnvReport struct {
	Items     []AIEnvItem `json:"items"`
	ExitIP    string      `json:"exitIp,omitempty"`
	ExitLoc   string      `json:"exitLoc,omitempty"`
	CheckedAt string      `json:"checkedAt"`
}

// aiServices are the hijacked services, each probed on its own host: a
// Cloudflare trace answers with the visitor's IP and country, so the request
// takes exactly the route that service's traffic takes.
var aiServices = []struct{ id, name, traceURL string }{
	{"exit-claude", "Claude 出口（Claude Code / 客户端 / 网页）", "https://claude.ai/cdn-cgi/trace"},
	{"exit-openai", "ChatGPT / Codex 出口", "https://chatgpt.com/cdn-cgi/trace"},
}

// aiProbeHost is resolved through the system resolver (the NRPT lock path).
const aiProbeHost = "api.anthropic.com"

var errNotProtected = errors.New("没有在走我们的线路，为免用本机网络访问 AI，这次不检测出口")

type traceResult struct {
	ip, loc string
	skew    time.Duration
	err     error
}

func fetchTrace(ctx context.Context, url string) traceResult {
	cl := &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{Proxy: nil, DisableKeepAlives: true}}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	sent := time.Now()
	resp, err := cl.Do(req)
	if err != nil {
		return traceResult{err: err}
	}
	defer resp.Body.Close()
	var r traceResult
	if d, err := http.ParseTime(resp.Header.Get("Date")); err == nil {
		r.skew = sent.Add(time.Since(sent) / 2).Sub(d)
	}
	sc := bufio.NewScanner(resp.Body)
	for sc.Scan() {
		k, v, _ := strings.Cut(sc.Text(), "=")
		switch k {
		case "ip":
			r.ip = v
		case "loc":
			r.loc = v
		}
	}
	if r.ip == "" {
		r.err = fmt.Errorf("HTTP %d，没拿到出口信息", resp.StatusCode)
	}
	return r
}

func lookupAI(ctx context.Context) ([]net.IPAddr, error) {
	c, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	return net.DefaultResolver.LookupIPAddr(c, aiProbeHost)
}

// AIEnvCheck runs every check (≈ up to 10 s: one HTTPS request + one lookup).
func (s *Service) AIEnvCheck(ctx context.Context) AIEnvReport {
	var wg sync.WaitGroup
	traces := make([]traceResult, len(aiServices))
	for i := range traces {
		traces[i] = traceResult{err: errNotProtected}
	}
	var addrs []net.IPAddr
	var dnsErr error
	// Contact the AI hosts only while AI is pinned to our line: otherwise the
	// check itself would reach them from the customer's own (mainland) IP.
	if running, line := s.AIGuardLine(); running && line != "" && s.AIDNSListening() {
		for i, svc := range aiServices {
			wg.Add(1)
			go func() { defer wg.Done(); traces[i] = fetchTrace(ctx, svc.traceURL) }()
		}
	}
	wg.Add(1)
	go func() { defer wg.Done(); addrs, dnsErr = lookupAI(ctx) }()
	wg.Wait()

	rep := AIEnvReport{CheckedAt: time.Now().Format(time.RFC3339)}
	clock := traces[0]
	for _, tr := range traces {
		if tr.err == nil && rep.ExitIP == "" {
			rep.ExitIP, rep.ExitLoc, clock = tr.ip, tr.loc, tr
		}
	}
	add := func(it AIEnvItem) { rep.Items = append(rep.Items, it) }
	add(s.guardItem())
	for i, svc := range aiServices {
		it := exitItem(traces[i])
		it.ID, it.Name = svc.id, svc.name
		add(it)
	}
	add(dnsItem(addrs, dnsErr))
	add(ipv6Item(s.AIGuardOn()))
	add(timezoneItem())
	add(clockItem(clock))
	add(s.conflictItem())
	add(autostartItem(s.GetAutostart()))
	return rep
}

func (s *Service) guardItem() AIEnvItem {
	it := AIEnvItem{ID: "guard", Name: "AI 只走我们的线路"}
	running, line := s.AIGuardLine()
	switch {
	case !s.AIGuardOn():
		it.Status, it.Detail = "fail", "劫持模式已关闭（在软件里恢复过）：关掉 ProxySplit 时 AI 会走本机网络，有封号风险。点上方「开启劫持」"
	case !aiguard.Installed():
		it.Status, it.Detail, it.Fix = "fail", "系统 DNS 锁没加上：ProxySplit 关掉时 AI 可能用本机 IP 直连", "guard"
	case aiguard.GroupPolicyActive():
		it.Status, it.Detail = "warn", "这台电脑有域组策略的 DNS 规则，AI 锁可能被它覆盖（公司电脑请联系 IT）"
	case !running:
		it.Status, it.Detail, it.Fix = "fail", "代理没在运行：现在 AI 网站打不开（已锁住，不会用本机 IP）", "guard"
	case line == "":
		it.Status, it.Detail = "fail", "没有可用的 POWER云 线路：AI 已拦截，请在 POWER云 续费 / 开通线路"
	case !s.AIDNSListening():
		it.Status, it.Detail = "fail", "本机 DNS 端口（127.0.0.53:53）被别的程序占用（多半是其他代理软件），AI 网站打不开：关掉它后点「重新检测」并重启代理"
	default:
		it.Status, it.Detail = "ok", "AI 一律走「"+line+"」；ProxySplit 关掉时 AI 打不开（不会用本机 IP）"
	}
	return it
}

func exitItem(tr traceResult) AIEnvItem {
	it := AIEnvItem{ID: "exit", Name: "AI 出口地区"}
	switch {
	case errors.Is(tr.err, errNotProtected):
		it.Status, it.Detail = "info", tr.err.Error()
	case tr.err != nil:
		it.Status, it.Detail = "fail", "连不上 AI 服务："+tr.err.Error()
	case aiguard.ExitRegionRisky(tr.loc):
		it.Status, it.Detail = "fail", fmt.Sprintf("出口 %s（%s）是 AI 不支持 / 高风险地区，马上停用并联系客服", tr.ip, tr.loc)
	case tr.loc != "TW":
		it.Status, it.Detail = "warn", fmt.Sprintf("出口 %s（%s），我们的标准出口是台湾", tr.ip, tr.loc)
	default:
		it.Status, it.Detail = "ok", fmt.Sprintf("出口 %s（台湾）", tr.ip)
	}
	return it
}

func dnsItem(addrs []net.IPAddr, err error) AIEnvItem {
	it := AIEnvItem{ID: "dns", Name: "AI 域名解析"}
	if err != nil {
		it.Status, it.Detail = "fail", "解析不了 "+aiProbeHost+"（代理没开时这是正常的锁住状态）"
		return it
	}
	var bad []string
	for _, a := range addrs {
		if a.IP.To4() == nil || a.IP.IsPrivate() || a.IP.IsLoopback() || a.IP.IsUnspecified() {
			bad = append(bad, a.IP.String())
		}
	}
	if len(bad) > 0 {
		it.Status, it.Detail = "warn", "返回了 IPv6 / 内网地址："+strings.Join(bad, "、")+"（应只有 IPv4 公网地址）"
		return it
	}
	it.Status, it.Detail = "ok", fmt.Sprintf("经线路解析，只返回 IPv4（%d 个地址）", len(addrs))
	return it
}

func ipv6Item(guard bool) AIEnvItem {
	it := AIEnvItem{ID: "ipv6", Name: "IPv6"}
	switch {
	case !aiguard.HasGlobalIPv6():
		it.Status, it.Detail = "ok", "本机没有公网 IPv6，不会绕开隧道"
	case guard:
		it.Status, it.Detail = "ok", "本机有公网 IPv6；AI 只解析 IPv4，IPv6 流量也进隧道，绕不过去"
	default:
		it.Status, it.Detail = "warn", "本机有公网 IPv6，AI 可能经 IPv6 用本机地址直连"
	}
	return it
}

func timezoneItem() AIEnvItem {
	it := AIEnvItem{ID: "timezone", Name: "系统时区"}
	tz := aiguard.TimezoneID()
	switch tz {
	case aiguard.TaipeiTimezone:
		it.Status, it.Detail = "ok", "台北时间，与出口（台湾）一致"
	case "China Standard Time":
		it.Status, it.Detail, it.Fix = "warn", "北京时间：浏览器会报「Asia/Shanghai」，与台湾出口对不上。改成台北时间（同为 UTC+8，钟点不变）", "timezone"
	default:
		it.Status, it.Detail, it.Fix = "warn", "当前「"+tz+"」与出口（台湾）不一致，建议改成台北时间", "timezone"
	}
	return it
}

func clockItem(tr traceResult) AIEnvItem {
	it := AIEnvItem{ID: "clock", Name: "系统时间"}
	skew := tr.skew
	if skew < 0 {
		skew = -skew
	}
	switch {
	case tr.err != nil || tr.ip == "":
		it.Status, it.Detail = "info", "没法比对（连不上 AI 服务）"
	case skew > 5*time.Minute:
		it.Status, it.Detail, it.Fix = "fail", fmt.Sprintf("比标准时间差 %s，登录 / 授权会失败", skew.Round(time.Second)), "clock"
	case skew > time.Minute:
		it.Status, it.Detail, it.Fix = "warn", fmt.Sprintf("比标准时间差 %s", skew.Round(time.Second)), "clock"
	default:
		it.Status, it.Detail = "ok", "准确"
	}
	return it
}

// conflictItem: other proxies / VPNs that would decide the AI exit instead of us.
func (s *Service) conflictItem() AIEnvItem {
	it := AIEnvItem{ID: "conflict", Name: "其他代理 / VPN"}
	var found []string
	if list, err := proc.ListProcesses(); err == nil {
		seen := map[string]bool{}
		for _, p := range list {
			if n := aiguard.ProxyClientName(p.Name); n != "" && !seen[n] {
				seen[n] = true
				found = append(found, n+" 在运行")
			}
		}
	}
	for _, a := range aiguard.OtherVPNAdapters() {
		found = append(found, "虚拟网卡「"+a+"」已连接")
	}
	envs := aiguard.ProxyEnv()
	names := make([]string, 0, len(envs))
	for n := range envs {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		found = append(found, "环境变量 "+n+"="+envs[n])
	}
	s.mu.Lock()
	ours := s.sysProxyOn
	s.mu.Unlock()
	if on, server := sysproxy.Get(); on && !ours {
		found = append(found, "系统代理指向 "+server)
	}
	if len(found) == 0 {
		it.Status, it.Detail = "ok", "没有"
		return it
	}
	it.Status, it.Detail = "warn", strings.Join(found, "；")+"。AI 程序可能先经它们出去，出口不受我们控制，建议关掉"
	return it
}

func autostartItem(on bool) AIEnvItem {
	it := AIEnvItem{ID: "autostart", Name: "开机自启"}
	if on {
		it.Status, it.Detail = "ok", "已开启，开机后 AI 直接能用"
	} else {
		it.Status, it.Detail, it.Fix = "warn", "没开：开机后要先手动打开 ProxySplit，AI 才能用", "autostart"
	}
	return it
}
