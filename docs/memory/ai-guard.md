# AI 劫持模式

> 设计 docs/AI强制走线路.md；名单 internal/aiguard/list.go。版本事实见 docs/decisions.md（v1.9.71 / v1.9.72）。

## 范围与原则
设置页「AI 劫持」分区对所有用户开放（2026-10-23），概览卡片仍只给 aigw 客户；没有 POWER云 线路时 AI 走当前选中节点，仍不直连，只有没节点才拦。
自家中转站 *.zygskins.cn 永不劫持、永不加 DNS 锁、始终直连（业主 2026-10-23 再次确认），owndomains_test.go 钉死。
劫持只管 Claude（Claude Code CLI / 客户端 / 网页）和 OpenAI（ChatGPT / Codex），名单写在 internal/aiguard/list.go，不再整份照搬规则包（业主 2026-10-21 定）。
- 对象是中转站客户：AI 一律走 POWER云 线路，没线路就拦。
- 概览页有 AI 环境检测，分别测 Claude 与 OpenAI 两家出口，并提供一键修复。

## 锁机制
NRPT 把 AI 域名指到一个 DNS 服务器，随代理自动切（service.SyncAILock）：运行中 → TUN IPv6 对端 fdfe:dcba:9876::2（进隧道走线路）；停了 → 127.0.0.53（没人监听，立即失败）；强杀 / 断电 → TUN 没了，fdfe 地址不可达，仍锁住。
- **IPv4-only 机器的坑（2026-10-28 alonehome2 实测）**：劫持开着时 TUN 带 IPv6 地址（aiTUN6），系统多出 `::/0 → tun0`，程序优先连 AAAA，内核直连 IPv6 不通 → 握手后被重置；浏览器会退回 IPv4，curl / Git / 游戏直接失败（关代理就好）。修：启动前 service.hostHasIPv6()（udp6 connect 只查路由表，排除自家 fdfe::/48 与 Teredo 2001::/32），没 IPv6 出口就给 core.Options.NoHostIPv6 → dns.strategy=ipv4_only，DNS 只回 A 记录。
- 切换节奏（internal/service/ailock.go）：启动预热 10 秒 → 隧道试解析通过才放行；每 15 秒检测，失败立即锁回；用户停止 / 退出先锁再等 5 秒停内核；界面显示倒计时。
- 意外情况（v1.9.96）：service.New 里先 SyncAILock（核没跑 → 锁回回环），不等自动登录；锁存在时注册计划任务 ProxySplit-AILock（SYSTEM，开机触发，PowerShell -EncodedCommand 只把我们的规则 Set 成 127.0.0.53，只收紧不解锁），Install 时建、Remove 时删，老版本留下的锁启动时补建。Windows 关机不走 Wails OnShutdown，靠这个任务兜底。2026-10-28 alonehome2 实测 SYSTEM 运行把 fdfe::2 改回 127.0.0.53。
- 独立「AI」页（v1.9.97，业主 2026-10-28）：features/ai（实时出口 + 检测/劫持 + 环境配置，设置页这两节已移走）；出口三条路 internal/service/exits.go：本机直连、分应用代理（TUN 下走内核 exit-probe-in 本机入口，带随机账号，出当前节点）、AI（经 AI 线路代理测 claude.ai trace，永不直连）；Cloudflare trace 每 3 秒，iplocate 按 IP 缓存 30 分钟；诊断接口 GET /api/exits。
- 恢复粒度（v1.9.96，业主 2026-10-28）：概览「恢复」只关劫持（锁 + 开机任务）；环境配置每项可单独恢复；「全部恢复（含 AI 劫持）」= App.RestoreAllAI（关劫持 + 环境全恢复）。
- 坑（2026-10-27 实测）：sing-tun strict_route 用 WFP 拦掉所有不走 TUN 的 53 端口查询，回环也拦，所以 1.9.71–1.9.95 内核在 127.0.0.53 的监听收不到包，一开劫持 Claude 就解析超时；监听已删，不要再改回回环应答。
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
- 环境配置（v1.9.88，业主 2026-10-23「劫持和环境分开、一键配置一键恢复、要能复用到 aigw」）：实现在 pkg/aienv（不依赖宿主包，README 有用法），宿主 env_app.go；状态文件 <数据目录>/aienv-state.json 记每项原值。项：timezone / culture(zh-TW) / homeloc(GeoID 237) / browserlang / claudecode / clock（不可恢复）/ fonts（只说明）。检测页修复按钮都走它；劫持「恢复」不再动 Windows 设置。aigw 侧（sub2api-05 会话）负责 Claude Code / Codex 进程级 TZ=Asia/Taipei、LANG=en_US.UTF-8、桌面版 --lang=en-US，两边共写 ~/.claude/settings.json 时都只撤自己的键。
- AI 线路代理（v1.9.89，给 aigw 指纹浏览器 --ai-proxy 用，sub2api-05 会话约定）：内核在跑就有本机 127.0.0.1 混合代理（优先端口 18089，被占则随机；账号 ai + 随机密码，本次运行固定），进来的全部走 AI 线路（POWER云 优先，否则当前节点），没线路 reject，绝不直连，与劫持开关无关。约定文件 %APPDATA%\proxysplit\ai-proxy.json（version/running/available/url/httpUrl/port/username/password/node/official/pid/updatedAt），内核停 = running:false。实现 internal/service/aiproxy.go + core AIProxy。不保证出口一定在台湾：official=true 才是我们的出口，地区以实际 trace 为准。
- 审计（v1.9.91）：aienv Restore 发现当前值已不是我们配的（用户后改）就跳过并忘记该项；FixAIEnv("all") 只修 warn/fail；ours() 自带 5s 超时，失败缓存 2 分钟、成功 30 分钟；AI 代理端口每次冷启动复检被占则换；设置页 AIEnvPanel always 不自动检测。
