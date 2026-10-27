# 分流规则 / TUN 配置

> 代码 internal/core（BuildTUNConfig、egress.go、routing_matrix_test.go）、internal/service。规则审计过程见 docs/decisions.md「分流规则两轮审计」与 v1.9.55。

## BuildTUNConfig 规则顺序
顺序固定为：固定直连(API / 内网 / 自身) → 应用拦截 / 直连 → clash 直连 → 局域网 → 屏蔽 QUIC → clash 全局(列出应用走各自节点，其余走 proxy) → 规则模式(细分规则 / 自定义 / 各应用线路)。
- 拦截排在自家接口 / 内网直连之前；阻止 QUIC 只挡进隧道流量（国内 / 直连不挡）。
- 按目标细分的应用规则：直连 / 拦截排在应用直连之后（各代理策略都生效），走节点的排在 clash 直连之后、clash 全局之前。
- 全局自定义规则带 clash_mode=rule：白名单下「代理」规则按组限定进程并走组节点，排在应用直连 / 拦截 / 细分规则之后（以前不限进程，会把列表外应用拉进隧道）；TUN 配置补上 DirectDomains。
- 默认全走代理下，自定义「走代理」规则也按各应用自己的节点；DefaultLine 只在默认全走代理下决定没列出程序的线路（Options.SplitDefault），不允许拦截。
- 自定义线路出口「直连」可保存且真走直连（lineOutbound）。
- 新装默认 RuleMode=whitelist。

## 应用名单热加载
应用进程名单放 <数据目录>/rules/*.json 本地 rule-set，sing-box 改文件即热加载（1.14.1 实测含原子替换）。
- 内置 规则 / 全局@活动节点 两组永远存在，增删改应用配置字节不变，所以 Manager.ApplySplitLists 只写文件不重启，再用 clash API 按进程名断开受影响应用旧连接；sing-box 改文件后约 0.11 秒才生效，故 0.6 秒后再断（ruleSetReloadWait）。
- 组内条件用 logical and（同一条规则里 rule_set 之间是 OR）。
- 空名单用占位进程 proxysplit-none.invalid（空列表 = 无条件 = 全匹配）；占位还有第二个作用：sing-box 只在启动时根据规则集里有没有进程规则决定是否识别进程（SagerNet/sing-box#4341），去掉占位会让之后热加载进来的应用全部失效。
- 整机全局下改应用规则不再重启，白名单下改 DefaultLine 不重启。

## 测试
internal/core/routing_matrix_test.go 用真 sing-box 跑 20 个场景（TUN 换 mixed、节点换假代理、DNS 换 hosts），变异测试能抓到回归。
- 测试要用 sing-box 私有副本，否则 service 测试的 CleanStrays 会杀掉它。
- sing-box CONNECT 在首个数据字节才拨号 / 入 /connections。
- 另有 TestCustomRulesStayInsideWhitelist、TestRoutingMatrixAIOnly、TestRoutingMatrixBlockedList。

## 自定义规则的使用坑
规则写错字是常见原因（用户那台把 zygskins.cn 写成 zygskisn.cn）；Claude / Codex 走国内中转 sub2api.demo.zygskins.cn，本来不需要代理。
- 1.9.70 起有写法说明表 + 输入自动纠正（canonicalRuleInput）。
- *.zygskins.cn 规则命中正常，但台湾节点 → 深圳站点约 1/3 TLS 失败（深圳链路 / WAF，非客户端问题），自家国内站点应设直连。
- 2026-10-23 起内置：`service.DirectDomains` 把 `zygskins.cn`（含全部子域：sub2api.demo / codex.demo 等 AI 中转站、ai.zygskins.cn）和商业 API 主机设为强制直连，排在应用「线路」规则之前，Codex / VS Code 选了线路也直连国内中转。不进 AI 锁（ProxySplit 关了中转站也要能用）。

## 自动更新相关（影响分流重启）
SelectNode / RemoveNode / SetRouting / SetSettings / SetLogLevel 返回重启错误并在界面提示；restart() 在一把 lifecycleMu 下停 + 启，用户中途点停止不会被重新启动。

## 规则库来源（2026-10-22 起）
- 主源是深圳镜像 https://proxysplit.zygskins.cn/rules/（manifest.json + 三个 .srs，sz 每天 05:00 由 proxysplit-rules.timer 从 SagerNet 同步）。客户端 geoupdate.Sync 只走镜像、按 sha256 判断要不要下；手动「更新规则库」用 Update，镜像不行再经节点回退上游。
- 后台同步：service.StartRuleSync（启动 30 秒后、每 6 小时），不需要代理在跑；sing-box 本地 rule_set 文件变化自动重载。
- 镜像出问题先看 sz `journalctl -u proxysplit-rules`；sz 能直连 GitHub，jsDelivr 是兜底源。

## 仅接管选中程序（captureMode=process，2026-10-27 起；v1.10.2 起为默认，空值即此模式，只有显式 "tun" 才整机虚拟网卡）
代码 internal/divert（WinDivert 2.2.2 免 cgo 绑定 + 纯 Go 包头 / 校验和）、internal/capture（引擎）、core/process_config.go + process_routes.go、service/capture_svc.go。
- 目的：TUN 下所有程序的包都进内核再判直连，直播推流偶发卡顿、内核重启断全部直连。此模式只接管名单里的程序，其它程序不经过本软件（无 TUN 路由、无 DNS 劫持）。
- 抓包设计（WinDivert 能做到的最低开销，WFP 连接重定向要自写内核驱动，不考虑），分条如下。
- 探测句柄 `outbound and !loopback and (纯 SYN 或 UDP 53)`：没列出的程序每条 TCP 连接只有第一个 SYN 过一次用户态，DNS 查询也过一次；数据包一个不进来。
- SOCKET 层 sniff 句柄记录 本地端口 → PID（connect / bind / close 事件），没赶上时探测循环不等：把 SYN / DNS 复制进待定队列（512 条，满了直接放行），resolveLoop 到达后最多等 2 ms 再查 GetExtendedTcp/UdpTable（探测循环里不 sleep）；PID → exe 路径缓存一分钟，按 capture.Routes 判定（自家内核排除 > 拦截 > 有按目标规则的应用 > 直连 > 分组 > 默认线路）。
- 自家内核排除（2026-10-27 审查 BLOCKER）：binDir 下的 sing-box.exe 和 xray.exe（主 / 端口代理 / 测速的 xray 旁路都跑这同一个文件）按完整路径永不接管；TUN 规则里的 process_path → direct（端口代理内核、XrayPath）由 core.processPathDirect 转成 Routes.Exclude，否则默认全走代理时 xray 的上游被接管回 sing-box 形成回环。测试 TestProcessRoutesExcludeProcessPathRules 守住「TUN 树里每条 process_path 都被排除」。
- 数据句柄的过滤器只列被接管连接的本地端口（连续端口合成区间）；变更按 25 ms 批量合并成一次换句柄（先开新句柄再 ShutdownRecv 旧句柄排空），被接管的 SYN 拿一份副本等覆盖它的那次换句柄后才放行，避免握手后的 ACK 漏到原目标被 RST。端口比较项上限 FilterBudget=200（WinDivert 过滤器最多 256 个对象），超了就把间隔最小的区间合并——多盖进来的别的程序的少数端口进用户态查表后原样放回，绝不退回「全部出站流量」。
- 看门狗：每个正在处理的包 / 被扣住的 SYN、DNS 都记开始时间，任何一个超过 3 秒就判定卡死：立即 Shutdown 全部句柄（流量直接放行=直连），日志提示「…请在设置里改用「整机虚拟网卡」」，再后台 Stop。
- UDP 登记带 PID，端口换了主人（漏了 close 事件）就作废；TCP 数据包核对原目标 IP 和端口。连接表只放 TCP、UDP 另有表，所以按本地端口做键不会跨协议串。
- TCP：SYN 及后续包改写成 127.0.0.1→127.0.0.1:中转端口（保留源端口作连接表键），中转 accept 后按表查原目标，SOCKS5 CONNECT 原 IP:端口 到该组的 sing-box mixed 入站（sing-box 嗅探出域名再走原规则）；中转回包改回「原目标 → 应用」从原网卡注入。
- UDP：按 bind 事件登记端口；数据报用 SOCKS5 UDP ASSOCIATE 交给组入站，回包在 Go 里拼 IPv4/UDP 注入。DNS（53）同样走组入站，由 sing-box 的 sniff + hijack-dns 应答。QUIC 仍由配置里的 quicRules 拒绝（BlockQUIC）。
- 被接管程序的 IPv6 SYN 回 RST（divert.BuildRSTv6，v1.10.2 起；原来静默丢弃要等约 21 s），IPv6 UDP 丢弃，逼它立即回落 IPv4（中转只做 IPv4），避免 IPv6 漏直连。拦截程序在 WinDivert 直接丢包。
- sing-box 配置：BuildProcessConfig 先生成 TUN 配置再改写，规则顺序不变：去掉 tun 入站，每个分组一个 mixed 入站 in-<组规则集 tag>；有按目标规则的程序单独一个 in-s-<hash>；默认全走代理多一个 in-default。rule_set 应用组 → inbound；process_name / process_path_regex（按目标规则）→ 该程序入站；自身 / 端口代理的进程规则删掉；应用规则集定义删掉（sing-box 不再查进程）。
- 热更新：入站集合只随分组 / 按目标程序变化。应用在已有分组之间移动时配置字节不变，ApplySplitLists 返回 true，service 只换引擎里的 Routes；已在中转的旧连接按旧入站跑到关闭（clash 按进程名断旧连接在此模式下无效）。
- 生命周期：内核起来后才开引擎；停止 / 内核退出（onCoreExit）先关引擎再停内核。句柄关完驱动自动卸载，进程崩溃句柄随进程关闭，不会残留拦截。需要管理员权限（manifest 已是 requireAdministrator）。
- 限制：AI 强制走线路需要全机 DNS / 流量，开着时自动退回 TUN；只对「按应用分流」生效，整机全局仍是 TUN；UDP 端口登记靠 bind 事件，极少数程序首个非 DNS 数据报可能抢在过滤器更新前直连（毫秒级）；按目标规则的程序必须单独入站，增删这种程序会重启内核。
- 二进制：scripts/fetch-core.ps1 从官方 basil00/WinDivert v2.2.2 下 zip，校验 zip 与 x64 dll / sys 的 SHA256 后放 bin/（git 忽略），仅供开发 / 测试；客户端不内嵌，运行时由 internal/coreupdate/windivert.go 按需从自家下载站拉取（同一组 SHA256）。下载只在拿 lifecycleMu 之前做：SetSettings 切到该模式时、Start 开头（ensureWinDivertUnlocked，最多等 60 秒，超时后台继续）；prepareProcessCapture 发现驱动没就绪时本次回落 TUN 并后台下载（v1.10.2 起，不再报错），不会因镜像慢卡住启停。Defender 风险见 known-issues.md。
- 集成测试：管理员 PowerShell 里 `$env:PROXYSPLIT_CAPTURE_IT=1; go test ./internal/capture -run Engine -v`（curl.exe 当被接管程序，需联网）。

- **系统 DNS 被污染（2026-10-27 alonehome2 实测）**：curl / Git / 游戏等走 Windows DNS 客户端的程序，查询由 svchost 发出、不被接管，墙内拿到假 IP（www.google.com → 31.13.92.37）；Edge / Chrome 自带 DNS 不受影响。sing-box 1.14 已无「用嗅探域名覆盖目标」，故中转 internal/capture/sniff.go 先读首包（≤300 ms、≤8 KB），有 TLS SNI / HTTP Host 就按域名 SOCKS CONNECT，让节点解析；服务器先发话的协议超时后照旧按 IP。
## 推流程序默认直连（只在「仅接管选中程序」下生效）
service.streamPreset：直播伴侣.exe、MediaSDK_Server.exe（抖音直播伴侣）、obs64/obs32.exe、快手直播伴侣.exe、kwailive.exe、livehime.exe（B站直播姬）没出现在任何名单时自动进直连列表（应用规则集热加载，不重启）。用户把它们加进任何名单则按名单；设置「推流程序默认直连」可关（streamDirectOff）。exe 名除 OBS / livehime 外待真机核对。 TUN 下不生效：会把老用户经代理推海外（OBS → YouTube）的流悄悄改直连（2026-10-27 审查）。

## 节点域名预解析（internal/noderesolve，1.9.96 分支起）
- 问题：域名节点以前只靠一个 DNS（sing-box default_domain_resolver = 223.5.5.5，Xray 223.5.5.5/119.29.29.29），移动 / 联通 / 电信用户会遇到超时、劫持、或拿到对本运营商很差的 CDN IP。
- 时机：启动 / 重启内核前（`startLocked`，只持 lifecycleMu，总时长 ≤2.5 s）并行解析主节点 + 额外 / 线路节点；端口代理、测延迟、测速走同一个解析器（`s.pinned`），显示的延迟就是实际要连的 IP。
- 同时问：本机网卡（运营商）DNS（GetAdaptersAddresses，跳过自家 TUN 172.19.0.0/30 / fdfe:、127.x、fec0:: 占位）、阿里 223.5.5.5/223.6.6.6、DNSPod 119.29.29.29、114、百度 180.76.76.76（UDP），加 DoH https://223.5.5.5 与 https://1.12.12.12（按 IP，无需引导）。每个 ≤1.5 s；第一个答复到后其余再等 400 ms 记 late（别的 TUN 开着 strict_route 时 UDP 53 被静默丢，开发机实测只有 DoH 通）。有 IPv6 出口（hostnet.HasIPv6）才问 AAAA。
- 套接字用 IP_UNICAST_IF 绑物理默认网卡（`noderesolve.DirectDialer`），不进自家 TUN；自家内核运行时只用 DoH。
- 合并去重、丢弃无效地址（私网、回环、198.18/15 fake-ip、100.64/10、保留段），按票数取前 8 个并行 TCP 探测（≤1 s）按耗时排名；都连不上按票数（fallback）；一个都没解析到 → 不填，沿用域名交给内核（老行为）。hysteria2 / tuic / mKCP 是 UDP，不做 TCP 探测。缓存：成功 10 分钟、失败 30 秒，singleflight。
- 改写点只有 `core.PinNode`（Options.ServerIPs 域名 → IP）：server/address 换 IP，把原来隐式来自域名的名字写死——SNI 为空时按各构建器原规则补（vless/vmess/trojan+TLS：SNI→Host→Server；其他：SNI→Server），ws/http/h2/httpupgrade/xhttp 的 Host 为空时补域名。原始 sing-box outbounds（含 POWER云 签名配置）和带插件的 ss 不改。Xray 在 `withSidecar` 用同一份 pin 后的节点，`xray.Key` 两边一致。
- 日志：「节点域名 x 解析：8 个 DNS（2 个成功）返回 1 个 IP，选 1.2.3.4（连通 35 ms）」；遥测 node.resolve。
- 没把 sing-box "local"（系统）解析器加进 default_domain_resolver：TUN + strict_route 下系统解析会被 hijack-dns 抓回内核，有回环 / 泄漏风险；预解析已覆盖节点域名。

## 节点保活 + DNS 缓存 / 预热（internal/nodewarm、internal/dnswarm，1.9.96 分支起）
- 保活（warm_svc.go）：代理运行时每 30 s 直连（绑物理网卡、不握 TLS）TCP 探测主节点和在用线路 / 额外节点的预解析 IP:port，最多同时 3 个；每节点留最近 20 个 RTT；连续 3 次失败 = down（中文日志 + node.health，只报状态变化），之后 5 分钟不探测；恢复时绕过缓存重新解析（新 IP 下次启动内核才用）。只观察，不改任何路由（AI 劫持也不动）。UDP 协议节点（hy2 / tuic / mKCP）不探测。/api/diag 的 `nodeHealth`：lastRttMs / p50Ms / fails / state。停内核时一起停。
- DNS 缓存（core/dnscache.go）：TUN 配置加 `dns.optimistic: true`（1.14 起，过期答案先回、后台刷新）+ `experimental.cache_file {path: <dataDir>/dns-cache.db, store_dns: true}`，重启也是热缓存。**AI 劫持开着时两样都不加**：sing-box 不能按规则排除，AI 域名要 10 秒 TTL 尽快过期。回归测试 `TestAIGuardUntouchedByPreresolveAndCache`（AI DNS 规则、全部路由规则及顺序、TUN 入站逐字节不变，缓存未开）。
- 预热：每分钟从 Clash API /connections 记下走节点（非 direct / reject）的域名，跳过 AI 劫持名单、IP、.cn；本地 `<dataDir>/dnswarm.json` 留前 50、3 天半衰。启动 5 秒后用 Clash API `GET /dns/query?name=&type=A`（1.14.3 实测可用，按内核自己的 DNS 规则走）并发 4 解析一遍；只上报汇总 dns.prewarm{count, ok, ms}，域名不出本机。

## 节点测试（2026-10-28，参考 v2rayN SpeedtestService）
- Google 延迟：同一隧道连发两次 204 取最小（首次含握手），任一次成功即算通；首次已用满超时则不再试第二次（latency.bestOf）。TestAllLatency 并发上限 latencyConcurrency=8（forEachBounded，单个 panic 不影响其它，探针由 measureNode defer 关闭；活动节点仍复用主内核）。
- 「测速全部（先测通）」：TestThenSpeedAll 先全量测延迟，再对 Latency>0 的节点逐个（串行，避免抢带宽）SpeedTestNode，返回 total / passed / speedOk。

## 自动选择（最快）（v1.10.4，参考 v2rayN urltest 组）
- 活动节点切换器第一项「自动选择（最快）」= `SelectedID "auto"`（service/auto_svc.go）。`selectedNode()` 返回合成节点 {ID:auto, Type:urltest, Members}：成员 = 非官方、非整组导入（HasRaw）、非 Xray 的已存节点，各自过 `chainLocked`（前置代理照用）。官方 POWER云 线路按自己的出站 tag 带出口限制（egress.go），混进组会失效，所以排除；Xray 节点为了简单先不进组。
- 内核（core/urltest.go，buildNodeOutbounds 入口分流）：成员按 `<tag>/m<i>` 走原单节点构建器（预解析 IP 钉住 / 前置 detour 都生效），组 `{type:urltest, url: gstatic generate_204, interval 3m, tolerance 50, idle_timeout 30m, interrupt_exist_connections:false}`，sing-box 1.14 check 通过。没有成员 → 启动报「没有可自动选择的节点」。
- 跟随「活动节点」的线路 / 按应用线路 / 端口代理自然跟着组走；startNodes 展开成员和前置节点，预解析与保活都覆盖。测速活动节点走主内核（或同组探针），不写回节点；TCP 延迟对 auto 不测。
- 「选中节点不存在就改选第一个」的三处（lines.go healDangling、service_store dropPlaceholder、apptest 导入校验）都放过 auto。
- 顺带修：`isCoreConfig` 原先在整个文件里找 `"outbounds"`，存了整组导入 / 官方节点（自带 outbounds）的配置会被当成内核配置，重载时退回 .bak；现只看顶层键。
