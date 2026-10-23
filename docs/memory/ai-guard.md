# AI 劫持模式

> 设计 docs/AI强制走线路.md；名单 internal/aiguard/list.go。版本事实见 docs/decisions.md（v1.9.71 / v1.9.72）。

## 范围与原则
设置页「AI 劫持」分区对所有用户开放（2026-10-23），概览卡片仍只给 aigw 客户；没有 POWER云 线路时 AI 走当前选中节点，仍不直连，只有没节点才拦。
自家中转站 *.zygskins.cn 永不劫持、永不加 DNS 锁、始终直连（业主 2026-10-23 再次确认），owndomains_test.go 钉死。
劫持只管 Claude（Claude Code CLI / 客户端 / 网页）和 OpenAI（ChatGPT / Codex），名单写在 internal/aiguard/list.go，不再整份照搬规则包（业主 2026-10-21 定）。
- 对象是中转站客户：AI 一律走 POWER云 线路，没线路就拦。
- 概览页有 AI 环境检测，分别测 Claude 与 OpenAI 两家出口，并提供一键修复。

## 锁机制
NRPT 把 AI 域名解析锁到回环地址 127.0.0.53（内核监听），软件关了 AI 就打不开。
- 必须用回环地址：锁最初指向 TUN 对端 172.19.0.2，内核停后被办公室路由器 DNS 劫持代答（198.18.x）。
- sing-box 1.14 DNS 规则 `strategy` 已弃用（1.16 删）；只要 IPv4 改用 query_type AAAA/HTTPS → predefined NOERROR。
- 开机自启改计划任务（Run 键对 requireAdministrator 程序开机不生效）。

## 解除方式（红线）
只有界面「恢复」能解除锁；退出登录、删数据目录都不解，且不提供命令行 / 远程解锁。

## 待验证
alonehome2 一上线就用正式版做端到端实测（开着 AI 走台湾、关掉 AI 打不开、恢复后正常）；1.9.71 发布时只在业主办公电脑用测试域名验证过锁机制，alonehome2 与 tw-win11 当时都离线。

## 环境检测（v1.9.86 细化，业主 2026-10-23）
- 用别的 VPN / 自建节点、劫持关着都只提示（warn），不拦不算错；劫持开着也允许别的 VPN。
- 「出口线路」：出口 IP 在 POWER云 名单里或 AI 走的是官方节点 = 官方线路。名单 server/deploy/egress-ours.json → sz /opt/proxysplit/rules/egress-ours.json（公网 /rules/egress-ours.json），客户端内置一份（internal/aiguard/ours.go），两边同改；AI 看到的多半是落地机 IPv6，按 /64 认；HiNet 动态 IP 写 DDNS 域名现解析。加 / 换出口机先改这份名单。
- 劫持没生效时不碰 AI 域名，只用 iplocate.io 查当前出口；IP 类型（住宅 / 机房 / 滥用）也来自 iplocate.io（免 key，约 50 次限额）。
- 调研结论：官方只公开支持地区（台湾支持，香港 / 大陆不支持）；社区证据里 IP 类型、出口一致与稳定、IPv6 泄漏、时区最重要；语言只提示；延迟只关系可用性，阈值 800 ms / 2 s。
- 官方订阅（v1.9.87）：劫持开着时浏览器 / Claude / ChatGPT 客户端的 STUN 也走 AI 线路（core AIGuard.STUNProcesses，名单 aiguard.webRTCProcesses），挡住 WebRTC 暴露国内真实 IP；一键修复「浏览器语言」= HKCU Chrome / Edge ForcedLanguages 策略 zh-TW,zh,en-US,en（浏览器显示「由贵单位管理」）；「Claude Code 遥测」= ~/.claude/settings.json env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1（数据目录 claude-quiet-ours 标记）；两者在「恢复」时撤销，只撤我们写的。中文字体 / emoji 只提示不改。Claude Code 隐写（时区 + 主机名藏进日期行）只在 ANTHROPIC_BASE_URL 非官方时触发，官方订阅直连不涉及。
