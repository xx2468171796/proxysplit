package service

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"

	"proxysplit/internal/aiguard"
)

// AI 环境检测：按 AI 防风控要求逐项核对这台电脑——劫持、出口是不是 POWER云 官方线路、出口 IP / 地区 /
// 类型 / 一致性 / 延迟、DNS、IPv6、时区、系统时间、系统语言、别的代理 / VPN、开机自启。能修的给出修复编号，
// 由 App.FixAIEnv 执行（设计 docs/AI强制走线路.md，检测依据 docs/memory/ai-guard.md）。
// 用别的 VPN、劫持关着都只提示，不算错（业主 2026-10-23）。

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
	ExitKind  string      `json:"exitKind,omitempty"` // 住宅宽带 IP / 机房 IP …
	ExitASN   string      `json:"exitAsn,omitempty"`
	ExitOurs  bool        `json:"exitOurs"` // POWER云 官方出口
	CheckedAt string      `json:"checkedAt"`
}

// aiServices are the hijacked services, each probed on its own host: a
// Cloudflare trace answers with the visitor's IP and country, so the request
// takes exactly the route that service's traffic takes.
var aiServices = []struct{ id, name, short, traceURL string }{
	{"exit-claude", "Claude 出口（Claude Code / 客户端 / 网页）", "Claude", "https://claude.ai/cdn-cgi/trace"},
	{"exit-openai", "ChatGPT / Codex 出口", "ChatGPT", "https://chatgpt.com/cdn-cgi/trace"},
}

// aiProbeHost is resolved through the system resolver (the NRPT lock path).
const aiProbeHost = "api.anthropic.com"

var errNotProtected = errors.New("没走我们的线路：为免用本机网络访问 AI，不直接连 AI 服务")

func lookupAI(ctx context.Context) ([]net.IPAddr, error) {
	c, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	return net.DefaultResolver.LookupIPAddr(c, aiProbeHost)
}

// AIEnvCheck runs every check (usually 2–5 s; at most ~30 s on a bad line). AI hosts are contacted only
// while AI is pinned to a line; otherwise only a neutral IP service is asked,
// so the check itself never reaches AI from the customer's own IP.
func (s *Service) AIEnvCheck(ctx context.Context) AIEnvReport {
	running, line := s.AIGuardLine()
	protected := running && line != "" && aiguard.Installed(aiguard.TunnelServer)
	var wg sync.WaitGroup
	traces := make([]traceResult, len(aiServices))
	for i := range traces {
		traces[i] = traceResult{err: errNotProtected}
	}
	var general ipInfo
	var generalErr error
	if protected {
		for i, svc := range aiServices {
			wg.Add(1)
			go func() { defer wg.Done(); traces[i] = fetchTrace(ctx, svc.traceURL) }()
		}
	} else {
		wg.Add(1)
		go func() { defer wg.Done(); general, generalErr = lookupIP(ctx, "") }()
	}
	var addrs []net.IPAddr
	var dnsErr error
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
	info, infoErr := general, generalErr
	if protected {
		info, infoErr = ipInfo{}, errNotProtected
		if rep.ExitIP != "" {
			info, infoErr = lookupIP(ctx, rep.ExitIP)
		}
	} else if infoErr == nil {
		rep.ExitIP, rep.ExitLoc = info.IP, info.CountryCode
	}
	if infoErr == nil {
		rep.ExitKind, rep.ExitASN = info.kind(), strings.TrimSpace(info.ASN.ASN+" "+info.ASN.Name)
		if info.City != "" {
			rep.ExitLoc = strings.TrimSpace(info.CountryCode + " " + info.City)
		}
	}
	if rep.ExitIP != "" {
		rep.ExitOurs = aiguard.IsOurExit(rep.ExitIP) || (protected && s.AIGuardOfficial())
	}

	add := func(it AIEnvItem) { rep.Items = append(rep.Items, it) }
	add(s.guardItem())
	add(lineItem(rep, protected))
	if protected {
		for i, svc := range aiServices {
			it := exitItem(traces[i])
			it.ID, it.Name = svc.id, svc.name
			add(it)
		}
		add(consistencyItem(traces))
		add(latencyItem(traces))
	} else {
		add(generalExitItem(info, infoErr))
	}
	add(ipTypeItem(info, infoErr))
	add(dnsItem(addrs, dnsErr))
	add(ipv6Item(s.AIGuardOn()))
	add(webRTCItem(protected))
	add(timezoneItem(rep.ExitLoc))
	add(clockItem(clock))
	add(localeItem())
	add(browserLangItem())
	add(fontItem())
	add(claudeCodeItem())
	add(s.conflictItem())
	add(autostartItem(s.GetAutostart()))
	return rep
}

func (s *Service) guardItem() AIEnvItem {
	it := AIEnvItem{ID: "guard", Name: "AI 劫持"}
	running, line := s.AIGuardLine()
	switch {
	case !s.AIGuardOn():
		it.Status, it.Detail = "warn", "劫持已关闭：关掉 ProxySplit 或分应用代理没覆盖 AI 程序时，AI 会走本机网络，有封号风险。建议点上方「开启劫持」"
	case !aiguard.Present():
		it.Status, it.Detail, it.Fix = "fail", "系统 DNS 锁没加上：ProxySplit 关掉时 AI 可能用本机 IP 直连", "guard"
	case aiguard.GroupPolicyActive():
		it.Status, it.Detail = "warn", "这台电脑有域组策略的 DNS 规则，AI 锁可能被它覆盖（公司电脑请联系 IT）"
	case !running:
		it.Status, it.Detail, it.Fix = "fail", "代理没在运行：现在 AI 网站打不开（已锁住，不会用本机 IP）", "guard"
	case line == "":
		it.Status, it.Detail = "fail", "没有可用的线路：AI 已拦截，请先添加节点或在 POWER云 开通线路"
	case !aiguard.Installed(aiguard.TunnelServer):
		it.Status, it.Detail, it.Fix = "fail", "AI 访问锁还没切到隧道，AI 网站暂时打不开：点「修复」重试，失败看「日志」页", "guard"
	default:
		it.Status, it.Detail = "ok", "AI 一律走「"+line+"」，不管分应用代理怎么设；ProxySplit 关掉时 AI 打不开（不会用本机 IP）"
	}
	return it
}

// lineItem: is the exit one of our POWER云 machines? Another VPN / own node
// is allowed — only a hint.
func lineItem(rep AIEnvReport, protected bool) AIEnvItem {
	it := AIEnvItem{ID: "line", Name: "出口线路"}
	where := "当前网络"
	if protected {
		where = "AI"
	}
	switch {
	case rep.ExitIP == "":
		it.Status, it.Detail = "info", "没查到出口，没法判断"
	case rep.ExitOurs:
		it.Status, it.Detail = "ok", fmt.Sprintf("%s出口 %s 是 POWER云 官方线路", where, rep.ExitIP)
	default:
		it.Status, it.Detail = "warn", fmt.Sprintf("%s出口 %s 不是 POWER云 官方线路（其他 VPN / 自建节点 / 本机网络）。可以继续用，但出口质量和账号安全我们没法保证", where, rep.ExitIP)
	}
	return it
}

func exitItem(tr traceResult) AIEnvItem {
	it := AIEnvItem{ID: "exit", Name: "AI 出口地区"}
	where := tr.ip + "（" + tr.loc + colo(tr.colo) + "）"
	switch {
	case tr.err != nil:
		it.Status, it.Detail = "fail", "连不上 AI 服务："+tr.err.Error()
	case aiguard.ExitRegionRisky(tr.loc):
		it.Status, it.Detail = "fail", "出口 "+where+" 是 AI 不支持 / 高风险地区，马上停用并换线路"
	case tr.loc != "TW":
		it.Status, it.Detail = "warn", "出口 "+where+"，AI 支持这个地区，但我们的标准出口是台湾"
	default:
		it.Status, it.Detail = "ok", "出口 "+where+" · 延迟 "+ms(tr.latency)
	}
	return it
}

func colo(c string) string {
	if c == "" {
		return ""
	}
	return " · 节点 " + c
}

func ms(d time.Duration) string { return fmt.Sprintf("%d ms", d.Milliseconds()) }

// generalExitItem: AI is not on a line, so show the machine's current exit
// (a neutral IP service, never an AI host).
func generalExitItem(info ipInfo, err error) AIEnvItem {
	it := AIEnvItem{ID: "exit", Name: "当前网络出口"}
	switch {
	case err != nil:
		it.Status, it.Detail = "info", "查不到出口："+err.Error()
	case aiguard.ExitRegionRisky(info.CountryCode):
		it.Status, it.Detail = "warn", fmt.Sprintf("出口 %s（%s）是 AI 不支持的地区：现在用 AI 会被认成在国内，有封号风险。开启劫持并启动代理", info.IP, info.CountryCode)
	default:
		it.Status, it.Detail = "info", fmt.Sprintf("出口 %s（%s %s）；AI 没走我们的线路，所以不直接检测 AI 服务", info.IP, info.CountryCode, info.City)
	}
	return it
}

// consistencyItem: Claude and ChatGPT should see one and the same exit.
func consistencyItem(traces []traceResult) AIEnvItem {
	it := AIEnvItem{ID: "consistency", Name: "出口一致"}
	ips := map[string]bool{}
	for _, tr := range traces {
		if tr.err != nil {
			it.Status, it.Detail = "info", "有服务连不上，没法比对"
			return it
		}
		ips[tr.ip] = true
	}
	if len(ips) == 1 {
		it.Status, it.Detail = "ok", "Claude 与 ChatGPT 看到同一个出口"
		return it
	}
	it.Status, it.Detail = "warn", "Claude 与 ChatGPT 的出口不同（多半一个走 IPv4、一个走 IPv6，或被别的代理分走）：同一会话出口跳变会提高风控概率"
	return it
}

// latencyItem: availability, not risk control (no evidence latency is a signal).
func latencyItem(traces []traceResult) AIEnvItem {
	it := AIEnvItem{ID: "latency", Name: "AI 延迟"}
	var parts []string
	worst := time.Duration(0)
	for i, tr := range traces {
		if tr.err != nil {
			parts = append(parts, aiServices[i].short+" 连不上")
			worst = time.Hour
			continue
		}
		parts = append(parts, aiServices[i].short+" "+ms(tr.latency))
		worst = max(worst, tr.latency)
	}
	switch {
	case worst < 800*time.Millisecond:
		it.Status = "ok"
	case worst < 2*time.Second:
		it.Status = "warn"
		parts = append(parts, "偏慢，可以换条线路试试")
	default:
		it.Status = "fail"
		parts = append(parts, "很慢或连不上，建议换线路")
	}
	it.Detail = strings.Join(parts, " · ") + "（首字节时间，3 次取中位数）"
	return it
}

// ipTypeItem: residential vs data-centre, and abuse flags (iplocate.io).
func ipTypeItem(info ipInfo, err error) AIEnvItem {
	it := AIEnvItem{ID: "iptype", Name: "IP 类型与信誉"}
	if err != nil {
		it.Status, it.Detail = "info", "查不到（"+err.Error()+"）"
		return it
	}
	who := strings.TrimSpace(info.ASN.ASN + " " + info.ASN.Name)
	switch {
	case info.Privacy.Abuser || info.Privacy.Tor:
		it.Status, it.Detail = "fail", info.kind()+"，被标记为滥用 / Tor（"+who+"）：这个出口风控概率很高，换线路"
	case info.kind() == "机房 IP":
		it.Status, it.Detail = "warn", "机房 IP（"+who+"）：多人共用，AI 风控更敏感；我们的台湾线路是住宅宽带 IP"
	case info.Privacy.VPN || info.Privacy.Proxy:
		it.Status, it.Detail = "warn", info.kind()+"，被 IP 库标成 VPN / 代理（"+who+"）"
	default:
		it.Status, it.Detail = "ok", info.kind()+"（"+who+"），没有滥用记录"
	}
	return it
}
