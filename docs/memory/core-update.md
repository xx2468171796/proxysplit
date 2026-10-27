# 内核 / 多源下载 / 自动跟随

> 逐版内嵌内核见 docs/decisions.md；内核发布与字段合同见 powervpn 仓标准（account-membership.md）。

## 内核来源与版本
内置内核是公司自编 sing-box（relayops 系），当前内嵌 1.14.3-relayops.1（v1.9.66 起，windows sha 1f112e9d…）；固定来源 + 双重 SHA256，旧产物保留可回滚。
- 版本线：1.14.1 官方（v1.9.52）→ 1.14.2-relayops.6/7/8/9（v1.9.58–1.9.64）→ 1.14.2-relayops.15（v1.9.65）→ 1.14.3-relayops.1（v1.9.66+）。制品在 Gitea gonggong/generic/sing-box/<版本>。
- 内核 Tags 带 `relayops_reality_hybrid`（coreupdate.HasTag，按内核文件缓存）时，只给 POWER云 签名配置里的 VLESS + Reality 出站加 `tls.reality.relayops_hybrid`（ClientHello 带 X25519MLKEM768，与真 Chrome 一致），第三方节点不加。
- 构建前 `scripts/fetch-core.ps1` 获取 bin/core-release.json 固定的内核；两者不一致构建第一步就停。

## 校验与替换
官方无 checksums 文本时优先用 GitHub asset.digest SHA256，兼容旧清单，无有效校验数据拒绝安装。
- 客户端升级会自动更新旧内核、保留更高版本和用户规则库；内核替换串行执行，失败保护旧文件。
- 核心版本查询与清理子进程有超时；路径单引号转义；发行版内核初始化失败明确报错。

## 多源下载（internal/coreupdate/mirror.go，v1.9.66）
内核更新从面板 /api/client/core 的 urls 多源下载：深圳 powerdl → DC9 → tw-pro → 天理云 → 源站最后，测速择优、跨源续传、每源校验 sha256。

## 自动跟随（internal/service/corefollow.go，v1.9.65）
公司规定面板发布新标准内核后所有客户端自动跟上：启动 30 秒后 + 每小时 + POWER云 登录后查 /api/client/core，比本机新就装。
- coreupdate 保留 sing-box.exe.old + 版本标记备份；代理在跑则在 lifecycleMu 下停 + 启。
- 新内核起不来 → coreupdate.Rollback 换回旧内核再启，该版本 24 小时内不自动装。
- 失败指数退避（2 分钟起、封顶 1 小时）；与手动按钮共用单飞；设置 autoUpdateCoreOff（零值 = 开）；下载上限 160 MB。
- 发布顺序 面板 → 节点 → 本仓服务端 → 客户端；改 core-release.json / PanelPublicKey 前先读接入标准。

## 其它升级记录
Go x/net、x/crypto、x/sys、x/text 已更新，Go 1.26.8 修复旧工具链 5 个可达标准库漏洞；全项目 govulncheck 无漏洞（2026-09-17）。

## Xray 双内核（2026-10-27，internal/xray）
sing-box 跑不了的节点（XHTTP/splithttp、mKCP、VLESS encryption）走 Xray 旁路内核，设计见 docs/architecture.md「Xray 双内核」。
- 固定版本 bin/xray-release.json（与 core-release.json 分开，不动面板合同 / PanelPublicKey）：上游 v26.6.1 @ 94ffd50，Go 1.26.8，sha256 dee38bbd…a8d6f。
- 构建：`scripts/build-xray.ps1` 从 Go 模块代理按 commit 取源码，参数同上游发布流程（-trimpath -buildvcs=false -gcflags=all=-l=4 -ldflags "-X core.build=<7位> -s -w -buildid="），两次构建 sha 一致（可复现）。
- 制品已上传（2026-10-27）：Gitea generic `gonggong/generic/xray/26.6.1/xray-windows-amd64.exe` + 公网 https://proxysplit.zygskins.cn/download/xray/26.6.1/（xray-release.json 的 `urls`，内置文件丢了时懒下载用）。发版用 `fetch-core.ps1 -RequireXray`。
- 内置：`bin/xray.exe` 在就随客户端打包（xraypayload.go，`//go:embed bin/xray*`），启动时 EnsureBundledXray 按 sha 安装到数据目录 bin，保留 xray.exe.old 可 RollbackXray；不跟随面板自动更新，换版本 = 改 pin + 发客户端。
- Xray v26 坑：`allowInsecure` 2026-06-01 起直接拒启动（不写）；mKCP 的 header/seed 已删，改写 `finalmask.udp` 的 `mkcp-legacy`；REALITY 公钥字段叫 `password`；freedom 默认拦私网目标（测试服务端要 `finalRules:[{"action":"allow"}]`）。
- **Xray DNS 模块自己的查询也走路由**，不指定就落到第一个出站 = 节点本身：解析节点域名要先过节点，死循环，域名型服务器的节点全部连不上（2026-10-28 alonehome2 实测踩到，端到端测试用 IP 服务器没测出）。现在 dns 带 `tag: dns-direct`，路由第一条把它送到 freedom 出站 `direct`。
- 真内核测试：bin/sing-box.exe + bin/xray.exe 都在时跑 `internal/core/xray_e2e_test.go`（本机 VLESS+XHTTP 服务端，探针 / 端口代理 / 主内核三条链路），缺文件自动跳过。
- 评审修复（2026-10-27，fix/review-xray）：
  - TUN + 远程解析：Xray 配置自带 `dns`（223.5.5.5、119.29.29.29 直连）且每个出站 `sockopt.domainStrategy=UseIP`，不走系统解析；sing-box 里 xray.exe 的 process_path 直连规则排在 hijack-dns 之前，DNS 规则首条 xray.exe → dns-direct（测试 TestXrayBypassesDNSHijack 锁顺序）。否则解析节点域名会被劫持进 dns-remote → 走代理 = 走 Xray 自己，永远连不上。
  - 侧车 SOCKS 入站每次启动随机用户名 / 密码（xray.Endpoint），sing-box 的 socks 出站带上；XrayPorts 的值类型由 int 改为 xray.Endpoint。
  - 启动不再同步哈希 xray.exe：数据目录 bin 下 `xray.exe.sha.json` 按 大小+mtime 缓存 sha，只在变化时重算；内置 EXE 仅在需要安装时才从 embed 读出；setupXray 在后台 goroutine 跑，需要 Xray 的启动经 core.BeginXraySetup 等它（最多 60 秒）。
  - 残留清理：KillStrays 先用 Toolhelp 快照看有没有 xray.exe，没有就不起 PowerShell；匹配改为命令行里 `-c <配置路径前缀>`（端口代理用 `proxyports\xray-` 完整路径）；启动时 core.CleanProbeStrays 杀测速探针遗留 Xray 并删 `probes\node-probe-*`。
  - Xray 意外退出：中文日志 + 2 秒后用同端口同密码重启一次；60 秒内再挂或重启失败 → 主节点需要 Xray 时直接杀 sing-box，走原有意外退出路径（onCoreExit 清系统代理 / 接管），只是附加节点则仅记日志；端口代理同理杀该端口进程触发 onExit。
  - waitPort 进程一退出就返回；起不来（含端口被抢）换新端口重试一次。
- 按节点选内核（2026-10-28，feat/node-core-switch）：节点字段 `core`（"" 自动 / "sing-box" / "xray"），随节点保存；订阅刷新按旧节点 ID 带回（service/nodecore.go keepNodeCores，刷新后不再合法的选择回到自动）。
  - 唯一判定 `nodes.Node.UseXray()` / `EffectiveCore()`：NeedsXray（XHTTP / mKCP / VLESS encryption）一律 Xray；`core=xray` 且 `XraySupports()` → Xray；其余 sing-box。主内核、附加 / 线路节点、端口代理、测速探针、侧车 Ensure 全部改用 UseXray（NeedsXray 只剩判定本身和 Clash 节点 ID）。
  - XraySupports：vless / vmess / trojan（raw/ws/grpc/xhttp/kcp）、shadowsocks（无 SIP003 插件）、socks、http（https = streamSettings tls）；raw sing-box 出站（POWER云）不支持。Xray 出站 ss / socks / http 用扁平 settings（address/port + method/password 或 user/pass，依据 xray-docs outbounds/*.md），`xray run -test` 实测通过（internal/xray/plain_test.go）。
  - 入口：Wails `SetNodeCore(id, core)`；诊断接口 `POST /api/nodes/core {"id","core":"auto|sing-box|xray"}`（返回 {ok} 或 {ok:false,error:中文}）；节点在用（活动节点 / 线路附加节点 / 端口代理出口）且实际内核变了才重启对应内核。/api/diag 节点带 `core`（实际）和 `coreSet`（用户选择）。
  - 界面：节点列名称旁显示实际内核标签；行操作「内核」弹窗（自动 / sing-box / Xray，不可选项置灰 + 说明）。界面数据来自 Service.Nodes() 副本上的派生字段 `coreInfo`（不落盘）。
  - 遥测：`node.core`（nodeType, transport, from, to, choice）；node.select / latency / tcp / speed 载荷多了 `core`。
- Xray v26.6.1 TLS / XHTTP 扩展（2026-10-28，同分支；字段名按模块缓存里 94ffd50 源码 infra/conf/transport_internet.go 核对）：
  - 分享链接 `ech`（→ tlsSettings.echConfigList，裸 "+" 会被解成空格已修正）、`echForceQuery`（只收 none/half/full，其它值会让 Xray 整个拒启动所以丢弃）、`pcs`（→ pinnedPeerCertSha256，只留 64 位 hex / 冒号格式）；vless 与 trojan 链接都读。Clash `ech-opts {enable, config}` 只取静态 config。
  - 我们的 sing-box 出站生成不了 ECH / 证书指纹固定 → `security=tls` 的 vless/vmess/trojan 带这两者即 NeedsXray（强制 Xray）。Clash 节点 ID 仍只看原规则（needsXrayTransport），老 ID 不变。
  - XHTTP `extra` 原样透传未知键；`xmux` 里已知键（maxConcurrency / maxConnections / cMaxReuseTimes / hMaxRequestTimes / hMaxReusableSecs 为整数或 "a-b"，hKeepAlivePeriod 为整数）值不合法就丢该键、xmux 不是对象就丢 xmux——否则 Xray 解析 extra 失败会拒启动。
  - 实测（internal/xray/reality_hello_test.go，真 xray 抓 ClientHello）：REALITY + fp=chrome 的 supported_groups 与 key_share 都含 X25519MLKEM768（0x11ec）；firefox、safari 也含；edge 不含；random 随机。
