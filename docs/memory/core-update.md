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
- **待人工上传**：把产物传到 Gitea generic `gonggong/generic/xray/26.6.1/xray-windows-amd64.exe`（未上传前 fetch-core 只警告，发版用 `fetch-core.ps1 -RequireXray`）。客户端懒下载用 xray-release.json 的 `urls`（公网镜像，最后一个是源站），目前为空 → 没内置就提示「该节点需要 Xray 内核，下载失败：没有可用的下载源」；要开懒下载先把文件放到公网下载站再填 urls。
- 内置：`bin/xray.exe` 在就随客户端打包（xraypayload.go，`//go:embed bin/xray*`），启动时 EnsureBundledXray 按 sha 安装到数据目录 bin，保留 xray.exe.old 可 RollbackXray；不跟随面板自动更新，换版本 = 改 pin + 发客户端。
- Xray v26 坑：`allowInsecure` 2026-06-01 起直接拒启动（不写）；mKCP 的 header/seed 已删，改写 `finalmask.udp` 的 `mkcp-legacy`；REALITY 公钥字段叫 `password`；freedom 默认拦私网目标（测试服务端要 `finalRules:[{"action":"allow"}]`）。
- 真内核测试：bin/sing-box.exe + bin/xray.exe 都在时跑 `internal/core/xray_e2e_test.go`（本机 VLESS+XHTTP 服务端，探针 / 端口代理 / 主内核三条链路），缺文件自动跳过。
