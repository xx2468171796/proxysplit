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
