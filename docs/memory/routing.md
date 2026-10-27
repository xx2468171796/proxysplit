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

## 仅接管选中程序（captureMode=process，2026-10-27 起，默认仍是 TUN）
代码 internal/divert（WinDivert 2.2.2 免 cgo 绑定 + 纯 Go 包头 / 校验和）、internal/capture（引擎）、core/process_config.go + process_routes.go、service/capture_svc.go。
- 目的：TUN 下所有程序的包都进内核再判直连，直播推流偶发卡顿、内核重启断全部直连。此模式只接管名单里的程序，其它程序不经过本软件（无 TUN 路由、无 DNS 劫持）。
- 抓包设计（WinDivert 能做到的最低开销，WFP 连接重定向要自写内核驱动，不考虑）：
  - 探测句柄 `outbound and !loopback and (纯 SYN 或 UDP 53)`：没列出的程序每条 TCP 连接只有第一个 SYN 过一次用户态，DNS 查询也过一次；数据包一个不进来。
  - SOCKET 层 sniff 句柄记录 本地端口 → PID（connect / bind / close 事件），没赶上时探测循环不等：把 SYN / DNS 复制进待定队列（512 条，满了直接放行），resolveLoop 到达后最多等 2 ms 再查 GetExtendedTcp/UdpTable（探测循环里不 sleep）；PID → exe 路径缓存一分钟，按 capture.Routes 判定（自家内核排除 > 拦截 > 有按目标规则的应用 > 直连 > 分组 > 默认线路）。
  - 自家内核排除（2026-10-27 审查 BLOCKER）：binDir 下的 sing-box.exe 和 xray.exe（主 / 端口代理 / 测速的 xray 旁路都跑这同一个文件）按完整路径永不接管；TUN 规则里的 process_path → direct（端口代理内核、XrayPath）由 core.processPathDirect 转成 Routes.Exclude，否则默认全走代理时 xray 的上游被接管回 sing-box 形成回环。测试 TestProcessRoutesExcludeProcessPathRules 守住「TUN 树里每条 process_path 都被排除」。
  - 数据句柄的过滤器只列被接管连接的本地端口（连续端口合成区间）；变更按 25 ms 批量合并成一次换句柄（先开新句柄再 ShutdownRecv 旧句柄排空），被接管的 SYN 拿一份副本等覆盖它的那次换句柄后才放行，避免握手后的 ACK 漏到原目标被 RST。端口比较项上限 FilterBudget=200（WinDivert 过滤器最多 256 个对象），超了就把间隔最小的区间合并——多盖进来的别的程序的少数端口进用户态查表后原样放回，绝不退回「全部出站流量」。
  - 看门狗：每个正在处理的包 / 被扣住的 SYN、DNS 都记开始时间，任何一个超过 3 秒就判定卡死：立即 Shutdown 全部句柄（流量直接放行=直连），日志提示「…请在设置里改用「整机虚拟网卡」」，再后台 Stop。
  - UDP 登记带 PID，端口换了主人（漏了 close 事件）就作废；TCP 数据包核对原目标 IP 和端口。连接表只放 TCP、UDP 另有表，所以按本地端口做键不会跨协议串。
  - TCP：SYN 及后续包改写成 127.0.0.1→127.0.0.1:中转端口（保留源端口作连接表键），中转 accept 后按表查原目标，SOCKS5 CONNECT 原 IP:端口 到该组的 sing-box mixed 入站（sing-box 嗅探出域名再走原规则）；中转回包改回「原目标 → 应用」从原网卡注入。
  - UDP：按 bind 事件登记端口；数据报用 SOCKS5 UDP ASSOCIATE 交给组入站，回包在 Go 里拼 IPv4/UDP 注入。DNS（53）同样走组入站，由 sing-box 的 sniff + hijack-dns 应答。QUIC 仍由配置里的 quicRules 拒绝（BlockQUIC）。
  - 被接管程序的 IPv6 SYN / UDP 直接丢，逼它回落 IPv4（中转只做 IPv4），避免 IPv6 漏直连。拦截程序在 WinDivert 直接丢包。
- sing-box 配置：BuildProcessConfig 先生成 TUN 配置再改写，规则顺序不变：去掉 tun 入站，每个分组一个 mixed 入站 in-<组规则集 tag>；有按目标规则的程序单独一个 in-s-<hash>；默认全走代理多一个 in-default。rule_set 应用组 → inbound；process_name / process_path_regex（按目标规则）→ 该程序入站；自身 / 端口代理的进程规则删掉；应用规则集定义删掉（sing-box 不再查进程）。
- 热更新：入站集合只随分组 / 按目标程序变化。应用在已有分组之间移动时配置字节不变，ApplySplitLists 返回 true，service 只换引擎里的 Routes；已在中转的旧连接按旧入站跑到关闭（clash 按进程名断旧连接在此模式下无效）。
- 生命周期：内核起来后才开引擎；停止 / 内核退出（onCoreExit）先关引擎再停内核。句柄关完驱动自动卸载，进程崩溃句柄随进程关闭，不会残留拦截。需要管理员权限（manifest 已是 requireAdministrator）。
- 限制：AI 强制走线路需要全机 DNS / 流量，开着时自动退回 TUN；只对「按应用分流」生效，整机全局仍是 TUN；UDP 端口登记靠 bind 事件，极少数程序首个非 DNS 数据报可能抢在过滤器更新前直连（毫秒级）；按目标规则的程序必须单独入站，增删这种程序会重启内核。
- 二进制：scripts/fetch-core.ps1 从官方 basil00/WinDivert v2.2.2 下 zip，校验 zip 与 x64 dll / sys 的 SHA256 后放 bin/（git 忽略），仅供开发 / 测试；客户端不内嵌，运行时由 internal/coreupdate/windivert.go 按需从自家下载站拉取（同一组 SHA256）。下载只在拿 lifecycleMu 之前做：SetSettings 切到该模式时、Start 开头（ensureWinDivertUnlocked，最多等 60 秒，超时后台继续）；startCapture 在锁内只做 WinDivertReady 本地校验，没好就报「正在后台下载」并启动后台下载，不会因镜像慢卡住启停。Defender 风险见 known-issues.md。
- 集成测试：管理员 PowerShell 里 `$env:PROXYSPLIT_CAPTURE_IT=1; go test ./internal/capture -run Engine -v`（curl.exe 当被接管程序，需联网）。

- **系统 DNS 被污染（2026-10-27 alonehome2 实测）**：curl / Git / 游戏等走 Windows DNS 客户端的程序，查询由 svchost 发出、不被接管，墙内拿到假 IP（www.google.com → 31.13.92.37）；Edge / Chrome 自带 DNS 不受影响。sing-box 1.14 已无「用嗅探域名覆盖目标」，故中转 internal/capture/sniff.go 先读首包（≤300 ms、≤8 KB），有 TLS SNI / HTTP Host 就按域名 SOCKS CONNECT，让节点解析；服务器先发话的协议超时后照旧按 IP。
## 推流程序默认直连（只在「仅接管选中程序」下生效）
service.streamPreset：直播伴侣.exe、MediaSDK_Server.exe（抖音直播伴侣）、obs64/obs32.exe、快手直播伴侣.exe、kwailive.exe、livehime.exe（B站直播姬）没出现在任何名单时自动进直连列表（应用规则集热加载，不重启）。用户把它们加进任何名单则按名单；设置「推流程序默认直连」可关（streamDirectOff）。exe 名除 OBS / livehime 外待真机核对。 TUN 下不生效：会把老用户经代理推海外（OBS → YouTube）的流悄悄改直连（2026-10-27 审查）。