package service

import "fmt"

// resetCatalog is the single list of everything the reset center can clear.
// Items whose action is nil are wired by RegisterResetter (the App registers
// log-spool / binaries; the node-resolve branch registers its two IDs).
func resetCatalog() []resetDef {
	return []resetDef{
		// --- 缓存 ---
		{item: ResetItem{ID: "core-dns-cache", Group: ResetGroupCache, Title: "内核 DNS 缓存",
			Effect: "清掉内核记住的域名解析结果（clash API /cache/dns/flush，失败才重启内核）", Danger: DangerSafe, Restarts: false},
			action: (*Service).resetCoreDNS},
		{item: ResetItem{ID: ResetNodeResolveCache, Group: ResetGroupCache, Title: "节点域名解析缓存",
			Effect: "重新解析节点服务器域名（节点换 IP 后连不上时用）", Danger: DangerSafe}},
		{item: ResetItem{ID: ResetDNSPrewarm, Group: ResetGroupCache, Title: "DNS 预热名单",
			Effect: "清空启动时预先解析的常用域名名单，下次按使用情况重新积累", Danger: DangerSafe}},
		{item: ResetItem{ID: "windows-dns-cache", Group: ResetGroupCache, Title: "Windows 系统 DNS 缓存",
			Effect: "等同 ipconfig /flushdns（调用 dnsapi.dll），不影响代理和 AI 劫持锁", Danger: DangerSafe},
			action: (*Service).resetWindowsDNS},
		{item: ResetItem{ID: "rulesets", Group: ResetGroupCache, Title: "规则库重新下载",
			Effect: "从深圳镜像重新同步 geoip / geosite 规则库并校验，失败保留旧文件", Danger: DangerSafe},
			action: (*Service).resetRuleSets},
		{item: ResetItem{ID: ResetLogSpool, Group: ResetGroupCache, Title: "本地日志队列",
			Effect: "先把待上传的运行日志尽量上传，再清空本机日志队列", Danger: DangerSafe}},

		// --- 网络修复 ---
		{item: ResetItem{ID: "sysproxy", Group: ResetGroupNetwork, Title: "清理残留系统代理",
			Effect: "关闭 Windows 系统代理（异常退出后网页打不开时用）", Danger: DangerSafe},
			action: (*Service).resetSysProxy},
		{item: ResetItem{ID: "strays", Group: ResetGroupNetwork, Title: "清理残留内核进程与虚拟网卡",
			Effect: "结束上次崩溃留下的 sing-box / Xray 进程（连同它们的虚拟网卡和路由），运行中的代理和端口代理会自动重启", Danger: DangerCaution, Restarts: true},
			action: (*Service).resetStrays},
		{item: ResetItem{ID: ResetBinaries, Group: ResetGroupNetwork, Title: "重新下载 WinDivert 与 Xray",
			Effect: "按内置 SHA256 校验 WinDivert 与 Xray 内核，缺失或损坏的重新下载", Danger: DangerSafe}},

		// --- 配置重置 ---
		{item: ResetItem{ID: "node-cores", Group: ResetGroupConfig, Title: "节点内核选择全部恢复自动",
			Effect: "每个节点的 sing-box / Xray 手动选择改回「自动」", Danger: DangerCaution, Restarts: true, Backup: true,
			Lost: []string{"每个节点手动选的内核"}},
			action: (*Service).resetNodeCores, count: countNodeCores},
		{item: ResetItem{ID: "routing", Group: ResetGroupConfig, Title: "分流设置恢复默认",
			Effect: "分流模式、未列出应用的线路、代理策略、自定义域名规则、规则库开关恢复默认", Danger: DangerCaution, Restarts: true, Backup: true,
			Lost: []string{"分流模式与未列出应用的线路", "代理策略（规则 / 全局 / 直连）", "自定义域名 / IP 规则", "规则库开关"},
			Kept: []string{"应用名单", "自定义线路", "节点与订阅"}},
			action: (*Service).resetRouting, count: countCustomRules},
		{item: ResetItem{ID: "app-rules", Group: ResetGroupConfig, Title: "应用名单清空",
			Effect: "删除全部应用分流规则，所有程序按「未列出的应用」走", Danger: DangerCaution, Restarts: true, Backup: true,
			Lost: []string{"全部应用分流规则"}},
			action: (*Service).resetAppRules, count: countAppRules},
		{item: ResetItem{ID: "all-settings", Group: ResetGroupConfig, Title: "全部设置恢复默认",
			Effect: "所有开关、分流设置、应用名单、自定义线路恢复默认", Danger: DangerHigh, Restarts: true, Backup: true,
			Lost: []string{"所有开关设置（主题、接管方式、局域网共享等）", "应用名单", "自定义线路", "自定义域名规则与规则库开关", "分流模式与代理策略", "日志级别"},
			Kept: []string{"节点、订阅与当前节点", "端口代理与自定义应用", "账号、会员与授权", "AI 劫持开关与锁", "Windows 环境配置"}},
			action: (*Service).resetAllSettings},
		{item: ResetItem{ID: "factory", Group: ResetGroupConfig, Title: "恢复出厂",
			Effect: "清空全部配置，相当于重新安装；代理会停止", Danger: DangerHigh, Restarts: true, Backup: true, Confirm: FactoryConfirmText,
			Lost: []string{"全部节点与订阅", "端口代理与自定义应用", "应用名单、自定义线路与域名规则", "所有开关设置"},
			Kept: []string{"账号、会员与本机授权（设备身份）", "AI 劫持开关与锁", "Windows 环境配置记录", "本机诊断接口令牌"}},
			action: (*Service).resetFactory, count: countNodes},
	}
}

func countNodeCores(s *Service) (int, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, nd := range s.cfg.Nodes {
		if nd != nil && nd.Core != "" {
			n++
		}
	}
	return n, fmt.Sprintf("%d 个节点手动选了内核", n)
}

func countCustomRules(s *Service) (int, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := len(s.cfg.CustomRules)
	return n, fmt.Sprintf("%d 条自定义域名规则", n)
}

func countAppRules(s *Service) (int, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := len(s.cfg.Rules)
	return n, fmt.Sprintf("将删除 %d 条应用规则", n)
}

func countNodes(s *Service) (int, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.cfg.Nodes), fmt.Sprintf("将删除 %d 个节点、%d 个订阅、%d 个端口代理", len(s.cfg.Nodes), len(s.cfg.Subs), len(s.cfg.ProxyPorts))
}
