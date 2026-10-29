# ProxySplit 项目记忆（L1，一屏）
> 最后更新：2026-10-28。细节按下方路由表读 docs/memory/，逐版发布史在 docs/decisions.md（按标题取）。

## 当前状态
- 线上：**v1.11.3 stable（强制，min 1.9.51；Windows + macOS 同号）**，2026-10-29 全站发布（1.11.1 加「连接」实时连接图；1.11.0：免费版（1 台）、会员设备叠加、配置导出导入 / 云同步 / 云端多份配置与分享、手机号注册登录与短信找回、运营后台 admin-ui 重做（设计 docs/plan-2026-10-29-free-sync-phone.md）。）。服务端 current = releases/20261029-134448-6ac6b6f-v1.11.3，上一版 releases/20261029-125855-d631bcc-v1.11.2。macOS 版本次未随发。Mac 测试机与账号见 docs/memory/macos.md。
- 前端已用 @ankotti/admin-ui 重写（React 19 + Vite 8 + TS 7 + pnpm 12.9.1，替换旧单文件 Svelte），随 v1.9.75 上线（已并入 main）；门禁 `pnpm --dir frontend check`，预览 `pnpm --dir frontend dev`。
- 技术栈：Go + Wails + React 前端，sing-box 原生 TUN + process_name；服务端 Fastify + 深圳共享 PG（堡垒机数据源 sz-pg-proxysplit）。
- **下一步**：日志详细化（net.conn_summary 连接成败汇总，业主 2026-10-28 要求，方便版本迭代排查）；有真实 IPv6 的电脑仍待实测（claude00002 是现成用户）；socks5 链式前置代理待业主决定；macOS 版：分支 feat/macos 已移植（Apple 芯片，构建机 xuan-macbook-air，见 docs/memory/macos.md），待 root 实测与随版本发布；不买 Apple 开发者账号（ad-hoc 签名）。发版前用正式下载包跑 alonehome2 自检，查别的会话未合并分支，测试机经 coord 轮流用。

## 红线（不得做）
- 不碰腾讯云 110.40.185.27（支付网关），只能以客户端身份调接口。
- 服务器只经堡垒机操作，不直连 ssh/scp；密钥、私钥、令牌、节点链接（资产 113）不入仓库、不打印；发版私钥（资产 116）用后即删。
- 不随手调高 minimumVersion（进租约 minVersion，老客户端会被拒）；换签名密钥必须先发带新公钥的客户端。
- 不改旧 SQL 迁移（不会重跑），只能新增；两个 0008 不可重命名。
- 不通过禁用 Defender / 加排除项处理误报；没有证据不发版。
- AI 劫持只管 Claude 与 OpenAI，且只能界面「恢复」解除，不加命令行 / 远程解锁。
- 加速兜底握手复刻不了就不接管、不直连；词表与 sub2api 两边同改。
- 动 POWER云 接入（powervpn / coreupdate / core-release.json / PanelPublicKey）前先读 powervpn 仓接入标准。
- 全站发布按 docs/RELEASE-PROCESS.md（release-all.ps1 只构建打包，部署经堡垒机）；只发客户端走 incoming + publish-client.py。
- 每次发版都设 mandatory=true（服务端只看 latest 那条）。
- 不随意改生产构建路径（Dockerfile 用 npmmirror）；不用旧 Svelte / npm 流程。

## 路由表（主题 → 文件）
| 主题 | 文件 | 一句话 |
|---|---|---|
| 发版/回滚/私钥/构建坑 | docs/memory/release-process.md | 只发客户端流程、验收、回滚、资产 116、PowerShell 构建坑 |
| 架构与生产环境 | docs/memory/deploy-architecture.md | 技术栈、sz 共享 PG/Redis、产品规则、remote |
| Claude 加速/握手 | docs/memory/accel.md | 编码模式、兜底握手跟中继、暂停行为 |
| AI 劫持模式 | docs/memory/ai-guard.md | NRPT 锁随代理切换（运行→隧道 fdfe::2、停→127.0.0.53）、范围、恢复、待实测 |
| macOS 版 | docs/memory/macos.md | 平台差异表、root 控制脚本、.app 规则、Tailscale 排除、Mac 上构建与发版 |
| 内核/多源下载/自动跟随 | docs/memory/core-update.md | relayops 内核版本线、mirror.go、corefollow.go、Xray 双内核（XHTTP/mKCP/VLESS encryption，待上传制品） |
| POWER云/会员/aigw/支付 | docs/memory/account-membership.md | 接入标准、AI 套餐会员、egress、刷新令牌容错、退款 |
| 分流规则/TUN 配置 | docs/memory/routing.md | 规则顺序、热加载、占位进程、真内核测试、仅接管选中程序（WinDivert）、推流直连预设 |
| AI 控制/MCP/诊断接口 | docs/memory/ai-control.md | 18088 诊断接口、--mcp 桥、DNS 12 秒问题 |
| 测试机/远程测试 | docs/memory/testing-machines.md | alonehome2、火绒复现、本机拍图坑 |
| 开发机坑 | docs/memory/dev-machine-pitfalls.md | git credential、PATH、Windows 实现坑、自动更新 |
| 前端（admin-ui） | docs/memory/frontend.md | 配色、门禁、mock 预览参数、设置分节 |
| 清除与重置 | docs/memory/reset-center.md | 唯一入口、每项做法、备份撤销、AI 劫持红线、RegisterResetter |
| 应用识别/模拟器/逐应用监测 | docs/memory/app-monitor.md | internal/appid 应用库、模拟器预设、连接成功失败判定 |
| 端口代理/更新说明弹窗 | docs/memory/proxy-ports.md | 指纹浏览器多端口独立进程、设备与日志、防火墙、升级后弹更新内容 |
| 多级分销/推广赚钱 | docs/memory/fenxiao.md | tuiguang/fenxiao 接线、分佣 / 冻结 / 冲回 / 提现、规则存哪、坑 |
| 本机日志文件 | docs/memory/logs.md | %APPDATA%/proxysplit/logs 按天文件、脱敏、50 MB 封顶、保留天数（默认 7）、每分钟连接记录 [conn] |
| 客户端日志上报 | docs/memory/telemetry.md | 日志 + 事件自动上传、脱敏规则、0016 表、后台「客户端日志」、AI 用 sz-pg-proxysplit 查询 SQL |
| 同事节点上报（内部） | docs/节点上报.md | 节点 / 订阅整份上报、0017 表、AES-GCM 链接加密（NODE_LINK_KEY）、后台「同事节点」、超管解密记审计 |
| 运营后台（admin-ui） | docs/admin-rebuild.md | admin-ui 9.6.1 重做、验收表、总览分类卡与指标字典、假后端与截图脚本、新只读接口 |
| 站内通知/公告 | docs/memory/notify.md | 公司包 tongzhi、老公告迁移、到账 / 到期 / 佣金通知、TZ_AI_TOKEN |
| 已知限制/待办 | docs/memory/known-issues.md | 无代码签名、Defender 误报、权益风险、待办 |
| 逐版发布史 | docs/decisions.md | commit、SHA256、releases id、incoming 目录 |

## 其它入口
- 设计文档在 docs/（AI强制走线路、Claude加速-网关切换、中转站渠道、AI诊断接口、RELEASE-PROCESS、architecture 等）。
- 查旧事实：`node ~/.ankotti/ai-kit/mem.mjs <关键词>`，不要整份读 decisions.md。
