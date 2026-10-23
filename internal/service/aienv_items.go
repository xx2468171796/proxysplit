package service

import (
	"fmt"
	"net"
	"sort"
	"strings"
	"time"

	"proxysplit/internal/aiguard"
	"proxysplit/internal/proc"
	"proxysplit/internal/sysproxy"
)

// Machine checks of the AI environment check (aienv.go): one read each.

func dnsItem(addrs []net.IPAddr, err error) AIEnvItem {
	it := AIEnvItem{ID: "dns", Name: "AI 域名解析"}
	if err != nil {
		it.Status, it.Detail = "fail", "解析不了 "+aiProbeHost+"（劫持开着、代理没开时这是正常的锁住状态）"
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
	it.Status, it.Detail = "ok", fmt.Sprintf("只返回 IPv4 公网地址（%d 个）", len(addrs))
	return it
}

func ipv6Item(guard bool) AIEnvItem {
	it := AIEnvItem{ID: "ipv6", Name: "IPv6 泄漏"}
	switch {
	case !aiguard.HasGlobalIPv6():
		it.Status, it.Detail = "ok", "本机没有公网 IPv6，不会绕开隧道"
	case guard:
		it.Status, it.Detail = "ok", "本机有公网 IPv6；AI 只解析 IPv4，IPv6 流量也进隧道，绕不过去"
	default:
		it.Status, it.Detail = "warn", "本机有公网 IPv6，劫持关着时 AI 可能经 IPv6 用本机地址直连"
	}
	return it
}

// timezoneItem: Claude Code is reported to read the system zone; a mainland
// zone against a Taiwan exit is the cheapest signal to remove.
func timezoneItem(exitLoc string) AIEnvItem {
	it := AIEnvItem{ID: "timezone", Name: "系统时区"}
	tz := aiguard.TimezoneID()
	twExit := exitLoc == "" || strings.HasPrefix(exitLoc, "TW")
	switch {
	case tz == aiguard.TaipeiTimezone:
		it.Status, it.Detail = "ok", "台北时间（UTC+8）"
	case !twExit && tz != "China Standard Time":
		it.Status, it.Detail = "info", "「"+tz+"」；出口不在台湾，按出口所在地设置时区即可"
	case tz == "China Standard Time":
		it.Status, it.Detail, it.Fix = "warn", "北京时间：程序和浏览器会报「Asia/Shanghai」，和境外出口对不上。改成台北时间（同为 UTC+8，钟点不变）", "timezone"
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
		it.Status, it.Detail = "info", "没法比对（没连 AI 服务）"
	case skew > 5*time.Minute:
		it.Status, it.Detail, it.Fix = "fail", fmt.Sprintf("比标准时间差 %s，登录 / 授权会失败", skew.Round(time.Second)), "clock"
	case skew > time.Minute:
		it.Status, it.Detail, it.Fix = "warn", fmt.Sprintf("比标准时间差 %s", skew.Round(time.Second)), "clock"
	default:
		it.Status, it.Detail = "ok", "准确"
	}
	return it
}

// localeItem: only a hint — weight is low and changing it disturbs the user.
func localeItem() AIEnvItem {
	it := AIEnvItem{ID: "locale", Name: "系统语言"}
	loc := aiguard.UserLocale()
	switch {
	case loc == "":
		it.Status, it.Detail = "info", "读不到"
	case strings.EqualFold(loc, "zh-CN"):
		it.Status, it.Detail = "info", "简体中文（zh-CN）：影响不大，只作提示；在意的话可把浏览器语言设成繁体中文或英文"
	default:
		it.Status, it.Detail = "ok", loc
	}
	return it
}

// conflictItem: other proxies / VPNs. Allowed — only a hint that the exit may
// not be decided by us.
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
	it.Status, it.Detail = "warn", strings.Join(found, "；")+"。可以同时用，但 AI 程序可能先经它们出去，出口就不由我们决定"
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
