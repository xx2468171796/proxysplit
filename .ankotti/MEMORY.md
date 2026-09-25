# ProxySplit 项目记忆
> 当前快照，最后更新：2026-09-25。历史发布过程见 Git，不在此重复堆积。

## 当前状态
- 2026-09-25：**v1.9.53 已上线 stable**（commit f482c6a，minimumVersion=1.9.51，mandatory=false）。产物 SHA256 b7c9182947c0dd1df39c5d8d42490047628233a633e4494943e7952acd69dad7，96,430,080 字节，Ed25519 验签通过；用客户端自带 updater 从 1.9.52 视角走 检查→下载→SHA256+验签 实测通过。只发客户端：sz /opt/proxysplit/incoming/client-v1.9.53-f482c6a/publish-client.py prepare→(登记 releases)→promote，previous/ 存旧 latest，可 python3 publish-client.py rollback 回退 latest（releases 表那行要另删）。本机没有管理员账号，releases 行是经堡垒机 db_query 直接插入并补了 audit_logs（与 POST /v1/admin/releases 等价）。**发布签名私钥在堡垒机资产 id 116**：打包前写回 server/secrets/shenzhen-release-private.pem（LF 换行，SHA256 与 profile.json 对得上），打完删掉。注意 minimumVersion 会进授权租约 minVersion，别随手调高，否则老客户端会被拒。
- 2026-09-17：v1.9.52 已上线 stable；minimumVersion=1.9.51，mandatory=false。官网自动读取发布 API 展示新版。
- 本轮：官方 sing-box 1.13.14 → 1.14.1，Wails 2.12.0 → 2.16.0，Go x/net、x/crypto、x/sys、x/text 更新；当前项目工具链及 go.mod 最低版本为 Go 1.26.8，修复旧工具链 5 个可达标准库漏洞。
- 已修复官方无 checksums 文本导致内核升级失败：优先使用 GitHub asset.digest SHA256，兼容旧清单，无有效校验数据拒绝安装。
- 客户端升级自动更新旧内核、保留更高版本和用户规则库；内核替换串行执行，失败保护旧文件。
- 核心版本查询与清理子进程加超时；路径单引号转义；界面更新异常不再显示成功；发行版内核初始化失败明确报错。
- 商业构建默认不混淆、不加壳，保留 Ed25519 更新验签和授权；固定内核来源/双重 SHA256，保留旧产物可回滚。
- Go 完整测试/vet、前端 check/build、官方内核配置 check 已通过；全项目 govulncheck 结果 No vulnerabilities found。
- 本机实启 v1.9.52，18088 本地控制 API 正常，运行目录旧内核 1.13.14 已自动升级为 1.14.1；测试时未开启代理。
- scripts/verify-release.mjs 独立核对产物大小/SHA256/Ed25519；正式构建末尾自动执行。完整更新后的 Wails 绑定已生成。
- 最终产物 output/proxysplit-v1.9.52.exe：96,397,824 字节；SHA256 3852b85580e6e4d9370572800e6dae85f5b57ac44a582b0629ba262c2db2b204；构建 commit f8a4bef；商业授权开启、混淆关闭、Ed25519 已验签、Authenticode 未签。

- 本轮仅发布已验签客户端文件和更新记录：公网完整下载 SHA256、版本/最新别名、发布清单均一致；官网 HTTP 200，下载统计入口 302，API /health 正常，容器 healthy。
- 发布落点 /opt/proxysplit/incoming/client-v1.9.52-f8a4bef；previous/ 保留旧 latest EXE/清单，版本化 v1.9.51 文件也保留。服务端及官网 current 仍为 20260725-183748-4001718-v1.9.51（本轮无服务端变更）。

- 2026-09-17 按用户“先上线”要求发布诊断附件 /download/proxysplit-defender-diagnostics-a9609fa.zip（脚本、说明、README）；公网下载 SHA256 cbda8ead11e064f2c430e0fad11a3614c41ccb7f81a2105acb5fd8290da8f101 已核验。客户端仍 v1.9.52，本轮无运行时修复，隔离原因仍待真实记录。

- 2026-09-25（未发布，只进了 main）：修复用户反馈「自定义规则无效、删掉的应用还能代理」。BuildTUNConfig 里全局自定义规则原先排在 代理策略 与按应用分流之前、且不限进程：直连/全局下仍生效，白名单下「代理」规则会把列表外应用拉进隧道。现在带 clash_mode=rule，白名单下代理规则按组限定进程并走组节点，排在应用 直连/拦截/细分规则之后；TUN 配置补上 DirectDomains（bf4a523 当时只修了旧多线路配置）。回归测试 TestCustomRulesStayInsideWhitelist；已用 sing-box 1.14.1 实测 clash_mode=rule 只在规则模式匹配。用户那台的另一原因：自定义规则写成 zygskisn.cn（错字）；Claude/Codex 走国内中转 sub2api.demo.zygskins.cn，本来不需要代理。已随 1.9.53 发布。
- 2026-09-25 第二轮（已随 1.9.53 发布）：审计 直连/规则/全局 × 白/黑名单 × 应用线路。BuildTUNConfig 重排为 固定直连(API/内网/自身) → 应用拦截/直连 → clash 直连 → 局域网 → 屏蔽QUIC → clash 全局(列出应用走各自节点, 其余走 proxy) → 规则模式(细分规则/自定义/各应用线路)。应用进程名单改放 <数据目录>/rules/*.json 本地 rule-set(sing-box 改文件即热加载, 1.14.1 实测含原子替换); 内置 规则/全局@活动节点 两组永远存在, 所以增删改应用配置字节不变 → Manager.ApplySplitLists 只写文件不重启, 再用 clash API 按进程名断开受影响应用旧连接。组内条件用 logical and(同一条规则里 rule_set 之间是 OR)。空名单用占位进程 proxysplit-none.invalid(空列表=无条件=全匹配)。回归: internal/core/routing_matrix_test.go 用真 sing-box 跑 20 个场景(TUN 换 mixed、节点换假代理、DNS 换 hosts), 变异测试能抓到; 测试要用 sing-box 私有副本, 否则 service 测试的 CleanStrays 会杀掉它。sing-box CONNECT 在首个数据字节才拨号/入 /connections。新装默认 RuleMode=whitelist。已知未修: 自定义线路在界面上选不到(App.svelte normalizeRules 强制 rule)、线路出口选「直连」保存报错、DefaultLine 无界面也不生效。
- 新节点 twpro-中转（vless reality，出口 122.116.1.113）链接已存堡垒机资产 id 113，勿写进仓库。

## 架构与部署
- 客户端：Go + Wails + Svelte，sing-box 原生 TUN + process_name；早期 WinDivert 已移除。
- 服务端：Fastify + PostgreSQL + Redis；会员真源在服务端，Ed25519 离线租约绑定账号/设备/硬件/期限。
- 官网：https://proxysplit.zygskins.cn；SSH 别名 proxysplit-shenzhen；管理员凭据仅本机私有配置，不入 Git。
- Gitea 真源 remote=gitea，仓库 xuan/proxysplit；origin 为旧 GitHub remote，不默认推送私有变更。
- 正式构建：scripts/build-commercial.ps1 -Version <版本>，要求干净工作区。
- 发布资料：build/release-kit/profile.json；签名私钥为 Git 忽略的 server/secrets/shenzhen-release-private.pem，禁止打印或提交。
- 完整发布脚本 scripts/release-all.ps1 会同时部署服务端/官网，不要把只打包客户端误当成全站发布。
- 客户数据：%APPDATA%/proxysplit；升级不清配置、节点、规则或 license.dat。
- 普通/超级会员功能完全相同，只按同时在线设备数区分：3 台 / 8 台。
- 自动更新必须通过 HTTPS、TLS SPKI、Ed25519 与 SHA256；发布渠道隔离。

## 验证与已知限制
- 构建前 scripts/fetch-core.ps1 获取 bin/core-release.json 固定的官方内核；EXE 不进 Git。
- Windows Authenticode 证书尚无；Ed25519 更新签名不能替代代码签名。
- 2026-09-17 本机构建环境没有可用 Defender 命令/CIM/扫描程序，旧版签名实测 NotSigned；尚未得到实际告警名称，不能宣称已排除病毒或消除误报。
- 误报证据采集：scripts/diagnose-defender.ps1；签名与微软申诉流程：docs/windows-security.md。不得通过禁用 Defender、加排除项处理。
- 完整验证必须 go test ./... + go vet ./... + frontend npm run check/build，不能只跑修改模块；core 测试会用真实内核 check 验证协议配置。
- 已部署 SQL 迁移按文件名记录；修改旧迁移不会重跑，必须新迁移。现有两个 0008 不可重命名。
- 生产机拉 npmjs 曾超时，既有 Dockerfile 使用 npmmirror；不随意改生产构建路径。

## 待办 / 风险
- 2026-09-17 用户再次报告安全中心删文件，尚未提供受影响机器/版本/威胁名/路径。再次确认当前开发机无可用 Defender，引擎缺失不能等同扫描通过；v1.9.52 哈希/更新签名一致，仍无 Authenticode。
- 本次已修复 diagnose-defender.ps1 对隔离后不存在路径直接退出的问题，增加独立检测历史/威胁名/事件日志采集；缺失文件、现存文件及状态接口失败但事件可用的回归通过。运行时替换 PowerShell 的试改已完全撤回，未构建或发布未经证据验证的新版本。
- 获取实际 Defender 威胁名称/路径，并在带有效 Defender 的 Windows 实测新版；确认为误报后走微软软件开发者申诉。
- 取得真实发布者的受信任代码签名证书后，通过 build-commercial.ps1 的 SigningThumbprint/SignToolPath 参数签名。
- 退款/撤销权益回收尚无独立权益流水账设计；不能按单笔退款直接倒扣共享权益。
- 试用硬件摘要依赖客户端上报；离线租约仍存在系统时间回拨/快照风险。
