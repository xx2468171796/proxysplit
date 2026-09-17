# ProxySplit 项目记忆
> 当前快照，最后更新：2026-09-17。历史发布过程见 Git，不在此重复堆积。

## 当前状态
- 线上最新版本已实查为 v1.9.51；本轮准备 v1.9.52，尚未发布。
- 本轮：官方 sing-box 1.13.14 → 1.14.1，Wails 2.12.0 → 2.16.0，Go x/net、x/crypto、x/sys、x/text 更新；当前项目工具链及 go.mod 最低版本为 Go 1.26.8，修复旧工具链 5 个可达标准库漏洞。
- 已修复官方无 checksums 文本导致内核升级失败：优先使用 GitHub asset.digest SHA256，兼容旧清单，无有效校验数据拒绝安装。
- 客户端升级自动更新旧内核、保留更高版本和用户规则库；内核替换串行执行，失败保护旧文件。
- 核心版本查询与清理子进程加超时；路径单引号转义；界面更新异常不再显示成功；发行版内核初始化失败明确报错。
- 商业构建默认不混淆、不加壳，保留 Ed25519 更新验签和授权；固定内核来源/双重 SHA256，保留旧产物可回滚。
- Go 完整测试/vet、前端 check/build、官方内核配置 check 已通过；全项目 govulncheck 结果 No vulnerabilities found。v1.9.52 待正式构建。

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
- 获取实际 Defender 威胁名称/路径，并在带有效 Defender 的 Windows 实测新版；确认为误报后走微软软件开发者申诉。
- 取得真实发布者的受信任代码签名证书后，通过 build-commercial.ps1 的 SigningThumbprint/SignToolPath 参数签名。
- 退款/撤销权益回收尚无独立权益流水账设计；不能按单笔退款直接倒扣共享权益。
- 试用硬件摘要依赖客户端上报；离线租约仍存在系统时间回拨/快照风险。