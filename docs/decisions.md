# ProxySplit 发布与决策档案（L3）

> 倒序（新在前），每个版本一个小节；条目原文迁自旧 .ankotti/MEMORY.md（commit、SHA256、releases id、incoming 目录、回滚方式、验收）。
> 结论与坑已提炼到 `docs/memory/<主题>.md`；这里是事实存档，按标题取（`node ~/.ankotti/ai-kit/mem.mjs <关键词>`），不要整份读。
> 约定：sz = 深圳生产机；incoming = sz `/opt/proxysplit/incoming/`；客户端回滚 = 该版本 incoming 目录 `python3 publish-client.py rollback` 并删 releases 表里该版本那行。

## v1.10.1（2026-10-28 03:40，全站发布，强制）
- release id 20261028-032339-0607adf-v1.10.1，上一版 releases/20261028-031250-94ac7cb-v1.10.0；备份 backups/postgres-20261028-032339-0607adf-v1.10.1.sql.gz；无新迁移。exe SHA256 0c26eaeceb5d4324767581bfee77ed1888306579272c57cd431bcf0b4bcb47c0。
- 新增 net.conn_summary（每 5 分钟连接成败汇总）。先部署服务端再测（新事件类型要服务端合同先认），alonehome2 正式包实测：自测 20/20，03:33 汇总事件进 client_events，内容正确；之后才登记 releases。

## v1.10.0（2026-10-28 03:25，全站发布，强制）
- release id 20261028-031250-94ac7cb-v1.10.0，上一版 releases/20261028-020437-d65f5fb-v1.9.99（另一会话发）；备份 backups/postgres-20261028-031250-94ac7cb-v1.10.0.sql.gz；无新迁移。
- 内容：双栈电脑打不开部分网站（claude00002 / ippure.com，节点无 IPv6 出口、浏览器经 TUN 连 IPv6 一直重试）→ DNS 一律 ipv4_only + 公网 IPv6 去节点前 reject；无前缀 socks（IP:端口:用户名:密码）导入。
- 客户端 commit 94ac7cb，SHA256 277183423a0f4e24f68a7a8932cbb9f4d5ffd32ef89e8151aefe8434132c5f64；releases（强制，min 1.9.51）+ audit_logs。版本号进位前已确认 license / updater / 服务端 latest 全是数字比较。
- 验收：alonehome2 正式包自检 20/20×2、/api/exits 三条通、IPv6 字面地址 0 秒被拒、无前缀 socks 导入成功；飞牛 latest = 1.10.0 mandatory；/health、官网、/admin/ 200；三个下载 sha 一致。

## v1.9.99（2026-10-28 02:15，全站发布，强制）
- release id 20261028-020437-d65f5fb-v1.9.99，上一版 releases/20261028-013858-7cc9c3e-v1.9.98；备份 backups/postgres-20261028-020437-d65f5fb-v1.9.99.sql.gz；无新迁移。
- 内容：域名节点多 DNS 并行预解析选最快 IP、节点保活 + DNS 乐观/持久缓存 + 常用域名预热（AI 劫持开着时不缓存 AI 域名）、「清除与重置」中心（含撤销、诊断接口 / MCP）、设置页重新分组。
- 客户端 commit d65f5fb，SHA256 331aa60c281a9d8457b2d8d9312bab2a8f0f4c9823ec07ac9de5a80d6eab6fca；releases（强制，min 1.9.51）+ audit_logs。
- 验收：alonehome2 测试包 AI 劫持与官方版对照一致（全绿，出口 TW）、自检 20/20×2、强制 Xray / 自动都 204、重置应用名单后撤销恢复、缓存清理通过；PVE VM153 Defender（签名 1.461.230.0）扫正式 exe 0 威胁。飞牛 latest = 1.9.99 mandatory；/health、官网、/admin/ 200；三个下载 sha 一致。

## v1.9.98（2026-10-28 01:46，全站发布，强制）
- release id 20261028-013858-7cc9c3e-v1.9.98，上一版 releases/20261028-011619-e73c2db-v1.9.97；备份 backups/postgres-20261028-013858-7cc9c3e-v1.9.98.sql.gz；无新迁移。
- 内容：IPv6 防泄露（TUN 一律带 IPv6；本机 IPv6 出口只在内核停着时检测）。
- 客户端 commit 7cc9c3e，SHA256 6f4a4cd6f3cfd14e798f84530f317e02b7b34239568df553628be66e05fa8d06；releases（强制，min 1.9.51）+ audit_logs。
- 验收：alonehome2 正式包自检 20/20×2、/api/exits 三条通、tun0 带 fdfe::1；测试包另测关 IPv6 绑定 20/20。飞牛 latest = 1.9.98 mandatory；/health、官网、/admin/ 200；三个下载 sha 一致。未测：有真实 IPv6 出口的电脑（劫持用户 1.9.71 起即同一路径）。

## v1.9.97（2026-10-28 01:22，全站发布，强制，修 1.9.96 事故）
- release id 20261028-011619-e73c2db-v1.9.97，上一版 releases/20261028-002750-ea7928e-v1.9.96；备份 backups/postgres-20261028-011619-e73c2db-v1.9.97.sql.gz；无新迁移。
- 事故：1.9.96 没带另一会话 release/1.9.96 分支上的 cea431c（无 IPv6 出口时 DNS 只回 IPv4），无 IPv6 的电脑开代理后直连站（百度 / QQ）全部 TLS 失败。alonehome2 上原先装的是那个会话的测试版（同为 1.9.96，所以没被自动更新替换），发版前自检被它掩盖。教训：发版前用**正式下载的包**跑自检，并先 `git branch -a` / coord_read 看有没有别的会话未合并的发布分支。
- 内容：合并 release/1.9.96（IPv6 DNS 修复、Xray DNS 走直连、节点内核可选）+ 独立 AI 页（实时三出口）。
- 客户端 commit e73c2db，SHA256 4114c66f380d99fc1c9f7f97c6fe2d55af85b744b1a9865b6f9677c99532ed2e，101,577,216 字节；releases（强制，min 1.9.51）+ audit_logs。
- 验收：alonehome2 正式包自检 20/20 ×2、/api/exits 三条全通；飞牛 latest = 1.9.97 mandatory；/health、官网、/admin/ 200；三个下载 sha 一致。

## v1.9.96（2026-10-28 00:31，全站发布，强制）
- release id 20261028-002750-ea7928e-v1.9.96，上一版 releases/20261024-234641-50d4859-v1.9.95；备份 backups/postgres-20261028-002750-ea7928e-v1.9.96.sql.gz；迁移 0016_client_telemetry.sql。
- 内容：Xray 双内核；仅接管选中程序（WinDivert 按需下载）；客户端日志上报；socks/http 远程 DNS 走 TCP；AI 锁启动先锁 + 开机任务 ProxySplit-AILock；环境配置单项恢复 / 全部恢复（含劫持）。
- 客户端 commit ea7928e，SHA256 965e008f2ba3d675b883137528d298c78bc974e13897e1a55ae46b11339391af，101,521,408 字节；releases（强制，min 1.9.51）+ audit_logs。
- 验收：飞牛 latest = 1.9.96 mandatory；/health、官网、/admin/ 200；三个下载 sha 一致。开机任务 alonehome2 SYSTEM 实测通过。Defender 扫描未做（tw-win11 离线、alonehome2 是火绒），待补。

## v1.9.95（2026-10-24 23:50，全站发布，强制）
- release id 20261024-234641-50d4859-v1.9.95，上一版 releases/20261024-190306-f4a5cd9-v1.9.94；无新迁移。
- 内容：已付费会员（登录 + 非试用套餐，isPaidMember）不弹赞赏码，弹窗开着时变成付费也自动关；试用 / 未登录照常弹（业主 2026-10-24 定）。
- 客户端 commit 50d4859，SHA256 da965e7bb1f87e63ff8c79e5882ab08dbb6f01d3c8edb293089323bdd897595d，101,070,848 字节；releases（强制，min 1.9.51）+ audit_logs。
- 验收：飞牛 latest = 1.9.95 mandatory；/health、官网、/admin/ 200；三个下载 sha 一致。

## v1.9.94（2026-10-24 19:07，全站发布，强制）
- **全站发布**：release id 20261024-190306-f4a5cd9-v1.9.94，上一版 releases/20261024-140848-cb0d214-v1.9.93；备份 backups/postgres-20261024-190306-f4a5cd9-v1.9.94.sql.gz；迁移 0015_fenxiao_v2.sql（加法，发布前生产 fx 表为空）。
- 内容：分销换用公司 fenxiao 包 0.1.0（vendor）；后台新增按套餐规则、复购限制、大额待复核（放行 / 作废）、调账、提现手续费；最多 3 级。
- 客户端 v1.9.94：commit f4a5cd9，SHA256 d5573126f04e10b1a8fbb7bdf73f9d91cdba6a6845e84c349235e1e1c85c8981，101,070,336 字节；releases（强制，min 1.9.51）+ audit_logs。
- 验收：飞牛 latest = 1.9.94；/health、官网、/admin/ 200；三个下载 sha 一致。本地真库场景 14 项 + 后台逐页点击通过。

## v1.9.93（2026-10-24 14:13，全站发布，强制）
- **全站发布**：release id 20261024-140848-cb0d214-v1.9.93，上一版 releases/20261024-040747-7f041c1-v1.9.92；备份 backups/postgres-20261024-140848-cb0d214-v1.9.93.sql.gz；无新迁移。
- 内容：后台概览 / 用户与会员 / 订单接入分销（列、筛选、档案分销栏、订单佣金、退款提示）；修手动确认订单网关单号写死 MANUAL 撞唯一约束；分销页比例显示修正。
- 客户端 v1.9.93：commit cb0d214，SHA256 7a7d638e77fd7356c77d16d3374d6c35abf5ec5b7425f9c381c0ef50ae209dbf，101,070,336 字节；releases id ae5b90f1-280c-470f-b482-09937d72cd33（强制，min 1.9.51）+ audit_logs。
- 验收：飞牛 latest = 1.9.93；/health、官网、/admin/ 200；三个下载 sha 一致。本地 PGlite 逐页点击（分销四个标签、用户列表列与筛选、档案、订单佣金与退款弹窗）+ 场景 9 项连跑 3 次通过。

## v1.9.92（2026-10-24 04:12，全站发布，强制）
- **全站发布**：release id 20261024-040747-7f041c1-v1.9.92，上一版 releases/20261023-012224-55103f0-v1.9.82；备份 backups/postgres-20261024-040747-7f041c1-v1.9.92.sql.gz；新迁移 0014_fenxiao（四张 fx_ 表，纯新增）。
- 客户端 v1.9.92：exe 源 commit 7f041c1（tag v1.9.92），SHA256 c58ebb228fd0e7886feb4af511db3b0c769bc83293bb2391b44326bb88e3f744，101,069,824 字节，内核 1.14.3-relayops.1；releases id 73a74200-a442-4139-ab82-c9c36de3d59b（强制，min 1.9.51）+ audit_logs。
- 内容：多级分销（公司 SDK tuiguang/fenxiao 1.8.2，vendor 进 server/packages/core/src/vendor/fenxiao）——注册带邀请码绑上级、付款同事务分佣（手动确认的单不分，业主定）、退款冲回、提现审核；后台「分销」页；官网 ?ref=；客户端注册邀请码 + 「推广赚钱」。佣金规则默认关。
- 验收：飞牛查公网 latest = 1.9.92 mandatory；/health、官网、/admin/ 200；/v1/fenxiao/me 未登录 401；三个下载 sha 一致；生产后台「分销」页实开正常（未开启状态）。真库场景 9 项（PGlite）+ 包测试 65 项 + 独立复审修复后发布。

## v1.9.90（2026-10-23，只发客户端，强制）
- exe 源 commit 38053ad，SHA256 3608b9f9687837e4c69f2131db90927bc7d469471f251fcc5d7785386fa7eea2，101,052,416 字节，内核 1.14.3-relayops.1；incoming/client-v1.9.90-38053ad；releases 行（强制，min 1.9.51）+ audit_logs。
- 内容：节点分享改为链接 + 复制、二维码按需；POWER云 官方线路禁止分享（之前二维码入口可分享，已堵）。
- 验收：公网 latest = 1.9.90 mandatory；飞牛下载 sha 一致；预览截图检查分享弹窗；业主真机实测分享二维码可用（2026-10-23）。

## v1.9.89（2026-10-23，只发客户端，强制）
- exe 源 commit 43c96ca，SHA256 db0e86ffd0f97a34eeff802912eb15980b8877a5b9307c62d3788ebbc6975569，101,049,344 字节，内核 1.14.3-relayops.1；incoming/client-v1.9.89-43c96ca；releases 行（强制，min 1.9.51）+ audit_logs。
- 内容：本机 AI 线路代理（127.0.0.1 优先 18089，带密码，全部走 AI 线路，没线路 reject）+ %APPDATA%\proxysplit\ai-proxy.json 约定，应 aigw（sub2api-05 会话）指纹浏览器 --ai-proxy 需求。
- 验收：公网 latest = 1.9.89 mandatory；飞牛下载 sha 一致；AI 代理配置过真实 sing-box check。真机端到端（经代理 trace 出口）待测。

## v1.9.88（2026-10-23，只发客户端，强制）
- exe 源 commit 46d36e7，SHA256 9c5fe9208149e145f4b03421e4a5d083de5b1044a94e701f246a2bf60f28a92a，101,035,520 字节，内核 1.14.3-relayops.1；incoming/client-v1.9.88-46d36e7；releases 行（强制，min 1.9.51）+ audit_logs。
- 内容：新包 pkg/aienv + 设置「环境配置」一键配置 / 恢复，与劫持分开。
- 验收：公网 latest = 1.9.88 mandatory；飞牛下载 sha 一致；本机真机 culture / homeloc 配置再恢复原样（zh-CN / 45）。

## v1.9.87（2026-10-23，只发客户端，强制）
- exe 源 commit 78ffeea，SHA256 414a185091eca034a401f4beda6f5743c00d9ef62d100fb4f79bf7c7ea3b8f98，101,004,288 字节，内核 1.14.3-relayops.1；incoming/client-v1.9.87-78ffeea；releases 行（强制，min 1.9.51）+ audit_logs。
- 内容：劫持开着时浏览器 / AI 客户端 STUN 走 AI 线路（防 WebRTC 泄露）；一键修复浏览器语言（ForcedLanguages）、Claude Code 遥测（CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC），「恢复」时撤销。
- 验收：公网 latest = 1.9.87 mandatory；飞牛下载 sha 一致；STUN 规则过真实 sing-box check。真机 WebRTC 检测站验证待测。

## v1.9.86（2026-10-23，只发客户端，强制）
- exe 源 commit 2ed320d，SHA256 4d48da2199b8c6cbca62e4097f5e06be1d1aaa9177c357a6346dcf4d480c77b1，100,986,368 字节，内核 1.14.3-relayops.1；incoming/client-v1.9.86-2ed320d；releases 行（强制，min 1.9.51）+ audit_logs。
- 内容：AI 环境检测细化（出口 IP / 类型 / 一致 / 延迟 / 语言），出口线路认 POWER云 名单；sz 新增 /opt/proxysplit/rules/egress-ours.json（不随发版，改出口机时更新）。
- 验收：公网 latest = 1.9.86 mandatory；飞牛下载版本化 / latest sha 一致，egress-ours.json 公网可读；本机真实网络临时测试：出口 122.116.1.113 认成住宅 + 官方线路，HiNet 动态 IP 经 DDNS 认出。

## v1.9.85（2026-10-23，只发客户端，强制）
- exe 源 commit 25b52a7，SHA256 c284022cab2549d822253014cbd434c86fa553731b2b7166c5f0108579ffc20a，100,952,576 字节，内核 1.14.3-relayops.1；incoming/client-v1.9.85-25b52a7；releases 行（强制，min 1.9.51）+ audit_logs。
- 内容：子进程一律 CREATE_NO_WINDOW（设备识别 PowerShell、sing-box check、路线测试 curl、更新脚本），新增 hidewindow_test.go 防再漏。
- 验收：公网 latest = 1.9.85 mandatory；飞牛下载版本化 / latest sha 一致。

## v1.9.84（2026-10-23，只发客户端，强制）
- exe 源 commit 4d5e778，SHA256 d14601451272db0c20593098ff3ffb2d652ab205e364b8ec046938e6aaba6491，100,948,480 字节，内核 1.14.3-relayops.1；incoming/client-v1.9.84-4d5e778；releases 行（强制，min 1.9.51）+ audit_logs。
- 内容：设置新增「AI 劫持」分区对所有用户开放（复用 AIEnvPanel always）；无 POWER云 线路时 AI 走当前选中节点，不再 reject。
- 验收：公网 latest = 1.9.84 mandatory；飞牛下载版本化 / latest 两个地址 sha 一致。真机劫持 / 恢复端到端仍待测。

## v1.9.82（2026-10-23 01:30，全站发布，强制）
- **全站发布**：release id 20261023-012224-55103f0-v1.9.82，上一版 releases/20261023-011333-9997134-v1.9.81；备份 backups/postgres-20261023-012224-55103f0-v1.9.82.sql.gz；无新迁移，服务端代码无变化。
- 客户端 v1.9.82：exe 源 commit 55103f0（tag v1.9.82），SHA256 8382bf40e7341cabd8d6eb0c6adaf29b1cd653dbba7766b1d44c57203b0eb18a，100,945,408 字节，内核 1.14.3-relayops.1；releases id f156b245-d623-4e27-9ee1-dd01c2497947（强制，min 1.9.51）+ audit_logs。
- 内容：Wails `Frameless: true`，窗口按钮用 qiantai 0.8.0 `DesktopShell windowControls`（`frontend/src/app/window-controls.ts`），登录 / 会员画面包 `DesktopFrame`（`gate-frame.tsx`）；官网改用 qiantai 站点配方 + `SiteView` 重写（`website/src/recipe.ts` + slots）。业主 2026-10-23 定：桌面客户端一律不用系统标题栏。页面审阅 rhesntp6esv 全部通过。
- 真实窗口验收（临时 Wails 程序 + user32 驱动）：拖动、双击标题栏最大化 / 还原、最大化 / 还原按钮、最小化、拉边缘、关闭都正常。
- 验收：公网 latest = 1.9.82 mandatory，/health、官网、/admin/ 200，三个下载 sha 一致；浏览器打开官网无控制台报错、套餐加载、页脚 v1.9.82。

## v1.9.81（2026-10-23 01:20，全站发布，强制）
- **全站发布**：release id 20261023-011333-9997134-v1.9.81，上一版 releases/20261023-001358-463943b-v1.9.80；备份 backups/postgres-20261023-011333-9997134-v1.9.81.sql.gz；无新迁移。
- 客户端 v1.9.81：exe 源 commit 9997134（tag v1.9.81），SHA256 59a7a229a8f5c9b236e6b23038ea9b605c06de0bcb75c77be1d83c5105da9393，100,942,336 字节；releases 行（强制，min 1.9.51）+ audit_logs。
- 内容：支付审计后修拆单——付一半可续付（resumeSplitInTx）、手动确认拆单子单不多发（payGroupPieceInTx），见 docs/memory/account-membership.md；真库场景 14 项过（pve-pg-proxysplit-paytest）。
- 过程：修复先误落在另一会话切出的 frameless 分支（共享目录被切分支），改在 worktree 里 cherry-pick 到 main 发布；frameless 上那份原样留着，合并时 CHANGELOG 取 main 的 v1.9.81。
- 验收：公网 latest = 1.9.81 mandatory，/health、官网、/admin/ 200，三个下载 sha 一致，支付回调地址可达（空请求 400）。

## v1.9.80（2026-10-23 00:20，全站发布，强制）
- **全站发布**：release id 20261023-001358-463943b-v1.9.80，上一版 releases/20261022-162423-310cf62-v1.9.79；备份 backups/postgres-20261023-001358-463943b-v1.9.80.sql.gz；服务端无变化。
- 客户端 v1.9.80：exe 源 commit 463943b（tag v1.9.80），SHA256 075787e25273bab0eb1161a534c581ed3cb5a94c05bf4ee3ea3e9c80ca23af88，100,941,824 字节，内核 1.14.3-relayops.1；releases id a80fd265-e73a-4b64-bcb9-987bad2becfc（强制，min 1.9.51）+ audit_logs。
- 内容：界面换成 qiantai 0.5.0 桌面外壳（DesktopShell +「外观」面板 + 背景性能调度），概览改为用户向连接面板，端口代理详情铺在表格下面；页面审阅台 rbbk46jcpup 两轮全部通过。
- 验收：前端 / Go / 服务端 / 官网门禁全过；飞牛取公网 latest = 1.9.80 mandatory，/health、官网、/admin/ 200，三个下载地址整包 sha 一致。

## v1.9.79（2026-10-22 16:40，全站发布，强制）
- **全站发布**：release id 20261022-162423-310cf62-v1.9.79，上一版 releases/20261022-160422-1c42cbd-v1.9.78；备份 backups/postgres-20261022-162423-310cf62-v1.9.79.sql.gz；服务端无变化。
- 客户端 v1.9.79：exe 源 commit 310cf62（tag v1.9.79），SHA256 3ac3c3f09cd033cb9faac9eeb97687c8d0bdfbdf1b4a05a932611aedfd41e0de，100,683,264 字节；releases 行（强制，min 1.9.51）+ audit_logs。
- 内容：界面说人话（shared/app-names、state/routing BUILTIN_LINES、shared/rule-text）。
- 验收：公网 latest = 1.9.79 mandatory，/health、官网、/admin/ 200，三个下载地址整包 sha 一致。

## v1.9.78（2026-10-22 16:08，全站发布，强制）
- **全站发布**：release id 20261022-160422-1c42cbd-v1.9.78，sz current 切到该目录，上一版 releases/20261022-031739-3059197-v1.9.77；备份 backups/postgres-20261022-160422-1c42cbd-v1.9.78.sql.gz；服务端无新迁移。
- 客户端 v1.9.78：exe 源 commit 1c42cbd（tag v1.9.78），SHA256 8ce06c7966f64471d85f80df9c4e16f960d77b059126b936cc4237b6607d6fa9，100,679,680 字节，内核 1.14.3-relayops.1；releases 行（强制，min 1.9.51）+ audit_logs。
- 内容：appid 识别层（应用库 + 按目录自动识别模拟器 + 逐应用连接监测），见 docs/memory/app-monitor.md；雷电 14 真机两轮实测、两轮独立审计问题全部修复。
- 验收：飞牛取公网 latest = 1.9.78 mandatory，/health、官网、/admin/ 200，三个下载地址整包 sha 一致。

## v1.9.77（2026-10-22 03:20，全站发布，强制）
- **全站发布**：release id 20261022-031739-3059197-v1.9.77，sz current 切到该目录，上一版 releases/20261022-021444-37136b1-v1.9.76；备份 backups/postgres-20261022-031739-3059197-v1.9.77.sql.gz；服务端代码无变化、无新迁移（官网文案更新）。
- 客户端 v1.9.77：exe 源 commit 3059197（tag v1.9.77），SHA256 67772ae15597c30909d69ff996798c02ee794de07839e4127f6ad39119a40125，100,534,784 字节，内核 1.14.3-relayops.1；releases id e18e0754-fe79-4729-88a3-cbf402337c80（强制，min 1.9.51）+ audit_logs。客户端回滚 = downloads 的 latest / latest.manifest 换回 1.9.76 版本化文件并删 releases 表 1.9.77 那行。
- 内容：端口代理（docs/memory/proxy-ports.md）、升级后弹出本次更新内容、官网加两条功能说明并修 admin-ui-audit。
- 发布坑：release-all.ps1 从 Git Bash 调用时 tar 是 GNU tar（把 C: 当远程主机）→ 改用 System32\tar.exe；脚本无 BOM 时 PowerShell 5.1 读乱中文注释吞掉下一行（$siteDist 未定义）→ 存为带 BOM 的 UTF-8；remote-deploy.sh 的 exe / manifest 要传绝对路径，这次 API 已切换后在「放安装包」一步失败，按脚本原步骤手工补完。
- 验收：go test / vet、前端与官网门禁全过；独立审计 9 条问题全部修复并加测试；飞牛取公网 latest = 1.9.77 mandatory，/health、官网、/admin/ 200，官网含新功能文案，三个下载地址整包 sha 一致。

## v1.9.76（2026-10-22 02:21，全站发布，强制）
- **全站发布**（服务端 + 后台 + 新官网 + 客户端），经堡垒机手工执行 remote-deploy.sh（没用 release-all.ps1 的 ssh/scp）：release id 20261022-021444-37136b1-v1.9.76，sz current 切到该目录，上一版 releases/20261005-130907-0a3cfc9-v1.9.64；迁移前备份 backups/postgres-20261022-021444-37136b1-v1.9.76.sql.gz；服务端代码无变化（只删旧静态官网、后台加 favicon），无新迁移。
- 客户端 v1.9.76：exe 源 commit bbee7b7（tag v1.9.76），SHA256 6ab7b85bb25e22eff6572ae52d2920846aa947f476571c0133ce34756283f0ec，100,400,640 字节，内核 1.14.3-relayops.1；releases 行 + audit_logs 经 db_query 插入（强制，min 1.9.51）。remote-deploy.sh 直接换了 downloads 的 latest / ai-latest，所以没走 publish-client.py；客户端回滚 = 把 downloads/proxysplit-latest.exe 与 latest.manifest.json 换回 1.9.75 的版本化文件并删 releases 表 1.9.76 那行。
- 内容：有新版一律自动升级（不再看 mandatory / 开关），升级后刷新桌面快捷方式图标；规则库走深圳镜像（见下一节）；官网 React + admin-ui + dongxiao 重做。
- 验收：go vet / go test / 前端与官网门禁全过；飞牛取公网 latest API = 1.9.76 mandatory，/health 200，官网与 /admin/ 200，三个下载地址整包 sha 一致；浏览器打开线上官网无报错，套餐接口 200，页脚显示 v1.9.76。

## 2026-10-22 规则库深圳镜像
- sz：/opt/proxysplit/bin/rules-sync.py（仓库 server/deploy/）+ systemd proxysplit-rules.timer（每天 05:00），GitHub raw → jsDelivr，校验 SRS 头 / ≤8MB / 不缩水一半以上，原子替换、旧版放 previous/，manifest.json 带 sha256；OpenResty `/rules/`（previous/ 404）。sz 能直连 GitHub。systemd 下没有 UTF-8 locale，Python 打中文会 UnicodeEncodeError，服务里设了 PYTHONIOENCODING=utf-8。
- 客户端 internal/geoupdate：Sync（只走镜像、直连、sha 一致不下载）与 Update（镜像不行再回退上游，可经节点 SOCKS）；service.StartRuleSync 启动 30 秒后 + 每 6 小时；sing-box 本地 rule_set 文件变化自动重载，不重启。去掉「添加节点后自动更新规则库」开关（autoUpdateRules）。

## v1.9.75（2026-10-22 01:43，stable，强制）
- 2026-10-22 01:43：**v1.9.75 已上线 stable（强制，min 1.9.51）**，commit f1e121c（tag v1.9.75），SHA256 e0d05448e453d3196352b4928c42dfd1bb35bc82056fc597c000adb265dd1a48，100,392,448 字节，内嵌内核 1.14.3-relayops.1；releases id 35290b86-d6cd-4b2f-9caf-441cfd06f746（经堡垒机 db_query 插 releases + audit_logs）；sz incoming/client-v1.9.75-f1e121c（previous/ = 1.9.74，回滚 = 该目录 `python3 publish-client.py rollback` 并删 releases 表 1.9.75 那行）。内容：界面用 @ankotti/admin-ui 重写（见下一节）+ 新墨色图标。保持强制的原因：服务端只看 latest 那条的 mandatory，设成非强制会让还没升到 1.9.71–1.9.74 的老用户不再被强制。验收：go vet / go test / 前端门禁全过；公网 latest API = 1.9.75 mandatory；飞牛下载版本化 / latest / ai-latest 整包 sha 一致；internal/updater 以 1.9.74 身份 Check → 下载 → 验签通过。

## 2026-10-22 前端用 @ankotti/admin-ui 重写（随 v1.9.75 上线）
- 前端已用 @ankotti/admin-ui 重写（React 19 + Vite 8 + TS 7 + pnpm 12.9.1，替换旧的单文件 Svelte）；分支 feat/admin-ui-frontend。
- 主色近黑墨色（浅色 #1c1f24 / 深色 #6b7584，组件库深色会把主色压暗，近黑会看不见），无背景光晕，motionStyle calm；新图标墨色圆角方块 + 白色分叉箭头。
- 门禁 `pnpm --dir frontend check`（typecheck / biome / vitest / admin-ui-audit / check-size）；开发预览 `pnpm --dir frontend dev` 无 Wails 时自动装 mock（?theme=dark ?gate=login|member ?split=1 ?update=1|force）；结构见 docs/architecture.md。
- 细节与用法见 docs/memory/frontend.md。

## v1.9.74（2026-10-22 00:30，stable，强制）
- 2026-10-22 00:30：**v1.9.74 已上线 stable（强制，min 1.9.51）**，commit c60a4a1，SHA256 6e4dc74f9d03ffe4b9ee67ff6cd0973c286a691ac4352192b60d08edcb2c2fa2；releases id 6a928e20-d5e3-4ba8-871b-fc569236f101；sz incoming/client-v1.9.74-c60a4a1（previous/ = 1.9.73）。修 1.9.73：握手复刻不了而暂停加速时，已指向编码端的会话继续走中继（以前一直收 503）；暂停期间 60 秒才复查（以前每 3 秒打招呼）。tw-pro 现网互通测试三项全过（含兜底直连真官方 401）。sub2api 哨兵新自有特性 `proxysplit-accel-fallback` 盯 cc-follow 的配置本仓复刻不复刻得了（词表抄自 tlsprofile.go，两边同改）。

## v1.9.73（2026-10-21 22:45，stable，强制）
- 2026-10-21 22:45：**v1.9.73 已上线 stable（强制，min 1.9.51）**，commit 9c6dfe8，SHA256 7d37932e99c2e1d79509270cb7288773055d26f7633f0099a39f4be12e4c5be1；releases id 73ac4a9d-43e2-42fa-a329-eee1373d6a56；sz incoming/client-v1.9.73-9c6dfe8（previous/ = 1.9.72）。**Claude 加速兜底握手跟着中继走**（业主问「官方更新了没跟上会不会出错」）：实查原先写死的兜底握手从没与官方对齐过（多 GREASE ECH / padding、缺 X25519MLKEM768、10-17 起又缺 ed25519 / ECDSA+SHA512）。现在中继 accel 0.6.3 打招呼交来整份稳定握手配置（指纹 hs 经 v2 签名），`internal/accel/tlsprofile.go` 按 BoringSSL 复刻，复刻不了 → 不接管 Claude Code、旧会话回 503 不直连；direct_test 与官方 2.1.306 实抓逐字节比对，tls.peet.ws 实测 JA4 t13d1713h1_5b57614c22b0_7f527383e249 与官方一致，tw-pro 现网打招呼验签 + 复刻通过。官方要改代码的握手变化 → sub2api docs/cc-follow.md §6 第 8 步同步本仓。坑：Windows 上 `git archive HEAD:子目录` 不套用根 .gitattributes，会按 autocrlf 输出 CRLF（加 `-c core.autocrlf=false`）。

## v1.9.72（2026-10-21 18:30，stable，强制）
- 2026-10-21 18:30：**v1.9.72 已上线 stable（强制，min 1.9.51）**，commit d2cbadf，SHA256 0566827703647352204a98ef9a168bccbe2d314b3cdd93c41d148479ea585ee6；releases id 937c3259-c869-43ce-9ed4-dd9f7adf7685；sz incoming/client-v1.9.72-d2cbadf（previous/ = 1.9.71）。业主定**劫持只管 Claude（Claude Code CLI / 客户端 / 网页）和 OpenAI（ChatGPT / Codex）**，名单在 internal/aiguard/list.go（不再整份照搬规则包）；环境检测分别测两家出口。开发机坑：Git for Windows 升到 2.56 后系统 gitconfig 的 credential manager 抢在 store 前且不能弹窗——推 Gitea 用 `git -c credential.helper= -c credential.helper=store push`，推 GitHub 用资产 10 的 PAT 临时 extraheader。

## v1.9.71（2026-10-21 18:05，stable，强制）
- 2026-10-21 18:05：**v1.9.71 已上线 stable（强制，min 1.9.51）**，commit 8574e96，SHA256 9764a6cf91602164d619d5b8a09e2780e954c723e0ec711ddce9b86d46fb5550；releases id 09670604-5049-4de7-a55b-ddd8c761dedf；sz incoming/client-v1.9.71-8574e96（previous/ = 1.9.70，回滚 = 该目录 `python3 publish-client.py rollback` 并删 releases 表 1.9.71 那行）。**AI 劫持模式**（业主定，设计 docs/AI强制走线路.md）：中转站客户 AI 一律走 POWER云 线路（没线路就拦）；NRPT 把 AI 域名解析锁到 127.0.0.53（内核监听），软件关了 AI 打不开；**只有界面「恢复」能解除**（退出登录 / 删数据目录都不解，无命令行 / 远程解锁）；概览页 AI 环境检测 + 一键修复；开机自启改计划任务（Run 键对 requireAdministrator 程序开机不生效）。坑：锁最初指向 TUN 对端 172.19.0.2，内核停后被办公室路由器 DNS 劫持代答（198.18.x），所以必须回环地址。sing-box 1.14 DNS 规则 `strategy` 已弃用（1.16 删），只要 IPv4 改用 query_type AAAA/HTTPS → predefined NOERROR。**待办：alonehome2 一上线就用正式版做端到端实测**（开着 AI 走台湾、关掉 AI 打不开、恢复后正常），本次发布时它和 tw-win11 都离线，只在业主办公电脑用测试域名验证了锁机制。

## v1.9.70（2026-10-16 02:05，stable，强制）
- 2026-10-16 02:05：**v1.9.70 已上线 stable（强制，min 1.9.51）**，commit 31e75b0（tag v1.9.70），SHA256 1555b1affa634bb2441c5f7526cdadc35fc0898ee6571ba9c1ade538617edcab；releases id efd00c9b-085b-4867-bec6-831ddc6adc8c；sz incoming/client-v1.9.70-31e75b0（previous/ = 1.9.69）。**「开代理百度打不开」复现成功 = 安全软件拦了 sing-box.exe**：alonehome2 装火绒 6.0.12.2，默认设置不拦；在「访问控制 → IP协议控制」加规则阻止 sing-box.exe 后，代理照常启动、20/20 全失败、DNS 全超时、原版本无任何报错。1.9.70：启动后 2 秒拨百度 / QQ:443，连不上 → net-blocked 事件 + 界面顶部常驻提示（带安全软件名和放行路径）；诊断 / 自检 / 启动失败都带火绒等识别（internal/service/security.go）。自定义规则：写法说明表 + 输入自动纠正（canonicalRuleInput）；*.zygskins.cn 规则命中正常，但台湾节点 → 深圳站点约 1/3 TLS 失败（深圳链路 / WAF，非客户端问题），自家国内站点应设直连。测试注意：装了火绒后 Windows 防火墙规则不生效（火绒接管），模拟拦截要用火绒 IP协议控制；远程关 IP协议控制会弹 UAC 安全桌面，远控点不了。

## v1.9.69 与 v1.9.68（2026-10-16 01:30，stable，强制）
- 2026-10-16 01:30：**v1.9.69 已上线 stable（强制，min 1.9.51）**，commit 0b4ec29（tag v1.9.69），SHA256 34f9376874ec8d78181a078d9ae2794020ca4fa5cbfee9998dcc3db405123d5e；releases id 7f3470db-4987-4d0b-9e47-544d774af4eb；sz incoming/client-v1.9.69-0b4ec29（previous/ = 1.9.68）。路由测试按探针完整路径认连接（同名程序在运行时不再误报）。同晚 v1.9.68（commit 7d51759，SHA256 ffde6dae…，releases id 34142566-9c3b-492c-a229-c73ce6d7cf17，强制）：控制接口补齐 /api/account、/api/account/login、/api/settings（部分更新）、/api/nodes/add|remove。**远程操控测试机 = 阿龙家里电脑2（alonehome2）**：正式版装在 %LOCALAPPDATA%\ProxySplit\proxysplit.exe（--background 启动），经堡垒机 run_command 调 `C:\ProgramData\ps-diagrun\psapi.ps1 GET|POST <路径> [body]`（token 自读）；账号 pv_442924c8（POWER云 power1010250），10-16 后台发普通会员 7 天到 10-23。用业主原配置（只代理列出的，Edge/VS Code/Copilot/WebView2 走规则，twpro 节点）自检 20/20 符合、自定义规则 4 类都生效，仍没复现「百度打不开」。本机 ~/.config/proxysplit/shenzhen-admin.txt 密码已同步资产 205。

## v1.9.67（2026-10-15 16:22，stable，只发客户端，强制）
- 2026-10-15 16:22：**v1.9.67 已上线 stable（只发客户端，强制更新 mandatory=true，min 仍 1.9.51）**，commit de1fcaf（tag v1.9.67），SHA256 fa012deb9374546e24d293d21ea7d5984512f8b86bb54d00a691f9829b1ca801，99,407,872 字节，内嵌内核 1.14.3-relayops.1；releases id c18096bf-ee29-4594-a975-2a1cdfb93063（经堡垒机 db_query 写 sz-pg-proxysplit + audit_logs）；sz incoming/client-v1.9.67-de1fcaf（previous/ = 1.9.66 latest，回滚 = 该目录 `python3 publish-client.py rollback` 并删 releases 表 1.9.67 那行）。内容：内置分流诊断与自检接口。验收：公网 latest API = 1.9.67 mandatory；飞牛下载版本化 / latest / ai-latest 整包 sha 一致；internal/updater 以 1.9.66 身份 Check 通过（验签 + TLS pin）。

## 2026-10-15 alonehome2 实测记录
- 2026-10-15 阿龙家里电脑2（alonehome2，真实墙内网络）用 cmd/diagrun 实测：只代理列出的 / 默认全代理 / 整机全局三种模式下，列出与未列出程序 × 百度/QQ/Google/YouTube 全部符合预期，自定义规则生效；**没复现「百度打不开」**（用的是 twpro 普通节点，POWER云 节点 + 访问范围未测）。新发现：系统 DNS 为公网地址时，开代理后查**不存在的域名**要等约 12 秒（strict_route 拦其它网卡 DNS，Windows 等全部网卡回答），详见 docs/AI诊断接口.md「已知问题」。办公室这台走 3 层路由、DNS 是内网 192.168.10.1，测不出 DNS 问题，主路由也无法单独排除这台。

## v1.9.66（2026-10-14 21:24，stable，只发客户端，非强制）
- 2026-10-14 21:24：**v1.9.66 已上线 stable（只发客户端，非强制，min 1.9.51）**，commit ee829b3（tag v1.9.66，含 ca494b2 内核多源下载 + e10c1cc 内嵌内核 r17），SHA256 55d19ab6c180cfae9bf007fb8e06530e53f3062ca47ed85703e9dd411ef347bf，99,338,752 字节，内嵌内核 1.14.3-relayops.1（windows sha 1f112e9d…）；releases id 231ca955-7028-4454-a934-fd80ff5be1a8；sz incoming/client-v1.9.66-ee829b3（previous/ = 1.9.65 latest，回滚 = 该目录 `python3 publish-client.py rollback` 并删 releases 表 1.9.66 那行）。**内核更新多源下载**（internal/coreupdate/mirror.go）：面板 /api/client/core 的 urls（深圳 powerdl → DC9 → tw-pro → 天理云 → 源站最后）测速择优、跨源续传、每源校验 sha256。验收：公网 latest API = 1.9.66；飞牛下载版本化 / latest / ai-latest 三个地址整包 sha 一致（tw-bbr3 ↔ 深圳大文件仍会中途截断，验收用国内机）。登记用本机 ~/.config/proxysplit/shenzhen-admin.txt 调 /v1/admin/releases（Node 脚本，用完删）；fetch-core.ps1 的 GITEA_TOKEN 用堡垒机资产 197（旧 xuan 令牌已废）。

## v1.9.65（2026-10-08 19:06，stable，只发客户端，非强制）与内核自动跟随
- 2026-10-08 19:06：**v1.9.65 已上线 stable（只发客户端，非强制，min 1.9.51）**，commit 4f99d43（tag v1.9.65），SHA256 e780a715385eeec01310b34b30c28b63abe437413ee7f689bda5fdbd4d75f0ad，99,253,248 字节，内嵌内核 1.14.2-relayops.15；releases id b0f4ea0c-2d9a-4e50-94ad-fd17a11dbe53；sz incoming/client-v1.9.65-4f99d43（previous/ = 1.9.64 latest，回滚 = 该目录 `python3 publish-client.py rollback` 并删 releases 表 1.9.65 那行）。验收：公网 latest API = 1.9.65 且签名与 manifest 一致；tw-bbr3 / sz 下载版本化与 latest / ai-latest 整包 sha 一致（tw-bbr3 首次下载 latest 中途截断，重下正常）。发版：登记用本机 ~/.config/proxysplit/shenzhen-admin.txt 调 /v1/admin/releases（Node 脚本），没用 release-all.ps1（直连 ssh）。服务端没动。
- 2026-10-08（随 1.9.65 发布）：**内核自动跟随**（公司规定：面板发布新标准内核，所有客户端自动跟上）。internal/service/corefollow.go：启动 30 秒后 + 每小时 + POWER云 登录后查 /api/client/core，比本机新就装（coreupdate 保留 sing-box.exe.old + 版本标记备份），代理在跑则在 lifecycleMu 下停 + 启，新内核起不来 → coreupdate.Rollback 换回旧内核再启，该版本 24 小时内不自动装；失败指数退避（2 分钟起、封顶 1 小时）；与手动按钮共用单飞。设置 autoUpdateCoreOff（零值 = 开）。下载上限 160 MB。

## 服务端 0a3cfc9（2026-10-05 13:10，只发服务端）
- 2026-10-05 13:10：**服务端上线 0a3cfc9**（只发服务端，客户端 latest 仍 1.9.64 原文件）：releases/20261005-130907-0a3cfc9-v1.9.64（上一版 20260930-234156-fc2053a-v1.9.61，无迁移，备份 postgres-20261005-130907-…sql.gz）。**刷新响应丢失容错**：旧令牌已轮换但其后继（同事务 created_at = 父 consumed_at）从没用过 + 同设备 + 10 分钟内 = 重试，作废后继再轮换；否则仍按重放整条作废（`classifyRefresh`，store.ts）。起因 cpcc00004：刷新 200 后客户端没接住（之后没领租约），下一分钟旧令牌 → REFRESH_REPLAY，一上午被踢 5 次，付了款还显示「暂无有效会员」。客户端同改（刷新 401 清在线会话回登录页）只进 main，随下次发版。

## v1.9.64（2026-10-02 01:55，stable，只发客户端，非强制）
- 2026-10-02 01:55：**v1.9.64 已上线 stable（只发客户端，非强制，min 1.9.51）**，commit 5124aeb（+ 93684ac 真内核测试，只进 main），SHA256 f30d2cf3…，releases id b3f4cd0e…；incoming/client-v1.9.64-5124aeb（previous/ = 1.9.63 latest，回滚 = `python3 publish-client.py rollback` 并删 releases 表 1.9.64 那行）。**内嵌内核 1.14.2-relayops.9**（windows sha 3064946b…，Gitea gonggong/generic/sing-box/1.14.2-relayops.9）；内核 Tags 带 `relayops_reality_hybrid` 时（coreupdate.HasTag，按内核文件缓存）只给 POWER云 签名配置里的 VLESS + Reality 出站加 `tls.reality.relayops_hybrid`（ClientHello 带 X25519MLKEM768，与真 Chrome 一致），第三方节点不加。验收：tw-bbr3 以 1.9.63 身份跑 internal/updater 检查→下载→验签通过；公网版本化 / latest / ai-latest 下载 sha 一致。构建坑：bin/sing-box.exe 与 core-release.json 不一致时构建第一步就停，先跑 scripts/fetch-core.ps1。

## v1.9.63（2026-10-01 13:38，stable，只发客户端，非强制）
- 2026-10-01 13:38：**v1.9.63 已上线 stable（只发客户端，非强制，min 1.9.51）**，commit 5dcec7f（+ ca97d91 绑定），SHA256 93bf77d5…，releases id d6fb4c1c…；incoming/client-v1.9.63-5dcec7f（previous/ = 1.9.62 latest）。**POWER云 访问范围**：签名配置 accounts[].egress（拦截名单 + 「仅 AI」名单），`internal/core/egress.go` 把指向受限线路的路由拆成「拦截名单 → direct」「仅 AI：名单 → 线路，其余 → direct」，TUN 与分线路两种模式都生效；真内核测试 TestRoutingMatrixAIOnly / TestRoutingMatrixBlockedList。合同见 powervpn 仓 docs/platform/PowerVPN-订阅访问范围.md。发版私钥按资产 116 临时写回、构建完即删；audit_logs.ip 不能为空。

## v1.9.62（2026-10-01 01:00，stable，只发客户端，非强制）
- 2026-10-01 01:00：**v1.9.62 已上线 stable（只发客户端，非强制，min 1.9.51）**，commit a71b82b，SHA256 fd5457a9…，releases id 947b9c6a…；incoming/client-v1.9.62-a71b82b（previous/ = 1.9.61 latest）。**从 AI 编程官网下载即登录**（设计 docs/中转站渠道.md「免登录下载」）：文件名 proxysplit-ai-<43 位 POWER云 一次性凭据>.exe，启动后后台 startAutoLogin 换令牌 + finishPowerVPNLogin（与浏览器登录同一套后续步骤），界面 AutoLoginPending / WaitAutoLogin；凭据面板有答复才记哈希（%APPDATA%/proxysplit/download-ticket）。下载走深圳 Nginx 静态路径 /download/proxysplit-ai-<凭据>.exe（嵌套 location，不记日志，模板 server/deploy/proxysplit.nginx.conf），**不经 /v1/download**（Fastify / Nginx 会记查询串）。本机测试：用临时 APPDATA 启动带凭据的副本，测完删桌面快捷方式（程序会建）。
- 发版坑：PowerShell 里 `& build-commercial.ps1` 会因 wails 的 stderr 中断并留下私钥文件——在 Bash 用 `powershell.exe -File scripts/build-commercial.ps1 -Version x` 并 `trap 'rm -f server/secrets/shenzhen-release-private.pem' EXIT`。

## v1.9.61（2026-09-30 23:45，stable，非强制）
- 2026-09-30 23:45：**v1.9.61 已上线 stable（非强制，min 1.9.51）**，commit fc2053a，SHA256 97f4ba4c…，releases id c3ceb7ae…；服务端 releases/20260930-234156-fc2053a-v1.9.61（上一版 20260930-215112-21a2d26-v1.9.60，无新迁移，备份 postgres-20260930-234156-…sql.gz）。**中转站客户会员跟 AI 套餐走**：POWER云 /client/me 的 aiPlanExpiresAt → licenses 单独一行 source='aigw'（普通会员），登录时 + 客户端每 3 小时 POST /v1/auth/powervpn/sync 同步；grantWithinTx / extendLicense 永不碰 aigw 行；AI 到期该行标 expired，客户在会员中心单独买。首次 POWER云 登录（中转站渠道、应用分流为空）预置 chrome/msedge/claude/codex/Code/Cursor。线上实测：guide-demo 登录后 aigw 行到期 = 其 AI 套餐到期、6 个程序已加好、3 个节点在。ai0782（pv_b303fe4c）原手动月卡已改成 aigw 行，到期 2026-10-30 21:12（= AI 套餐）。

## v1.9.60（2026-09-30 21:53，stable，非强制，含服务端与中转站渠道）
- 2026-09-30 21:53：**v1.9.60 已上线 stable（非强制），minimumVersion 1.9.51**（commit 21a2d26；内嵌内核 1.14.2-relayops.8；SHA256 9d98bac1943222493393ea00a9ae760a1ae9a447c062422130f53f65248a8d16，98,715,648 字节；releases id d362d052-1ee8-46bb-a341-6fb2651c5655）。**服务端同批上线** releases/20260930-215112-21a2d26-v1.9.60（上一版 20260929-072050-a401dee-v1.9.58），迁移 0013_user_channel，备份 /opt/proxysplit/backups/postgres-20260930-215112-21a2d26-v1.9.60.sql.gz。发布方式同 v1.9.58（本机构建 → transfer_link 传 incoming → run_command 跑 remote-deploy.sh → 本机调 /v1/admin/releases，管理员凭据 = 堡垒机资产 205）。
  - **中转站渠道**（设计 docs/中转站渠道.md）：AI 编程官网（aigw）客户不显示作者联系方式（QQ 群 / 微信 / 赞赏码 / 官网 / GitHub），登录按钮改「用 AI 编程官网账号登录」并直接打开 POWER云 `/api/auth/aigw/start`。认定：安装包名带 proxysplit-ai（AI 官网给 /v1/download/proxysplit-ai-latest.exe，downloads/ 里是 latest 的软链，remote-deploy.sh 每次发版原子重建）或 users.channel='aigw'（POWER云 /api/client/me 的 sources 含 aigw 时登录记上）。本机标记 %APPDATA%/proxysplit/channel，只升不降。
  - 交付先开会员：`POST /v1/admin/users/powervpn {externalId:<POWER云 客户 uuid>, channel:"aigw"}` 预建 pv_<前 8 位> 账号 → `/v1/admin/users/<id>/grant`。首个：ai0782 → pv_b303fe4c（acf58990…），普通会员月卡到 2026-10-30。
  - 7e32c9b（登录提示「授权」→「同意」）只进 main，随下次发版。
  - 本机跑正式版拍图：单独 APPDATA 目录启动即可不碰本机配置，但**桌面 ProxySplit.lnk 会被改指向临时 exe**，拍完要删 / 还原。

## v1.9.59（2026-09-29 15:22，stable，非强制，只发客户端）
- 2026-09-29 15:22：**v1.9.59 已上线 stable（非强制），minimumVersion 1.9.51**（commit 4303f5d = POWER云 复审修复：按面板稳定节点标识 key 认自家节点、认领设备名不为空、endpoints 失败退避、导入第三方 sing-box 出站去掉作者本机字段、分流名单热更新先加后减；内嵌内核 **1.14.2-relayops.7**（windows sha 26ec61c6…，Gitea gonggong/generic/sing-box/1.14.2-relayops.7，本机经内网 http 下载 sha 一致）。SHA256 278e9c0f1b36db4e1234797f6cf6d16ba764c53711e41e9d09675afb0b1f04fc，98,708,992 字节，Ed25519 验签通过；releases id e10cad8e-550e-43fd-811e-b0bb40f4d05e。**只发客户端**（服务端自 a401dee 无改动，current 仍是 releases/20260929-072050-a401dee-v1.9.58，未 pg_dump、未重建容器）：build-commercial.ps1 → transfer_link 传 sz incoming/client-v1.9.59-4303f5d → 先装版本化文件再原子替换 latest（旧 latest 在该目录 previous/，回滚 = 拷回 downloads 并删 releases 表 1.9.59 那行）→ 本机调 /v1/admin/releases 登记。验收：latest API = 1.9.59、两个下载地址经 tw-bbr3 / sz 外网下载 sha 一致、/health 200。面板同日上线 relayops.7（PowerVPN 85b0cef），发布顺序 面板 → 节点 → 客户端。

## v1.9.58（2026-09-29 07:25，stable，非强制，含服务端）与 POWER云 接入标准
- 2026-09-29 07:25：**v1.9.58 已上线 stable（非强制），minimumVersion 1.9.51**（commit a401dee = 9a5a6d8 POWER云 接入 + 文档；SHA256 cb7eb75f78c366cf398ffc6746bd92022da3eb6f2c7fd6432d212e58bde72d42，98,689,536 字节，内嵌内核 1.14.2-relayops.6；release 20260929-072050-a401dee-v1.9.58，releases id d889baa6-bc72-44f2-b2b0-b578e7b13695）。服务端同批上线，迁移 0012_powervpn_identity 已应用，迁移前备份 /opt/proxysplit/backups/postgres-20260929-072050-a401dee-v1.9.58.sql.gz（10.9 MB）；上一版 releases/20260928-232301-afe83be-v1.9.57。POWERVPN_BASE_URL 用默认 https://lxc.5fskins.com（容器内实测可达）；/v1/auth/powervpn 假令牌返回 401 POWERVPN_TOKEN_INVALID。**发布方式**：release-all.ps1 的上传/远程执行用直连 ssh/scp，违反「服务器只经堡垒机」，本次按它的步骤手工执行——本机 -PreflightOnly → build-commercial.ps1 → git archive HEAD:server + admin dist 打包 → transfer_link 传 sz incoming → run_command 执行 remote-deploy.sh → 本机调 /v1/admin/releases 登记。待办：把 release-all.ps1 的上传/远程执行改走堡垒机。构建会重新生成 frontend/wailsjs 绑定（已随本次提交）。
- **POWER云 接入是公司标准**（2026-09-29，commit 9a5a6d8）：改 internal/powervpn、internal/coreupdate、bin/core-release.json、PanelPublicKey、服务端 /v1/auth/powervpn 前先读 powervpn 仓 `docs/platform/PowerVPN-客户端接入标准.md`（字段合同 openspec/changes/client-device-identity/design.md），按其第 8 节清单三处一起改，发布顺序 面板 → 节点 → 本仓服务端 → 客户端。换签名密钥必须先发带新公钥的客户端。

## v1.9.57（2026-09-28 23:23，stable，非强制，含服务端；Claude 加速）
- 2026-09-28 23:23：**v1.9.57 已上线 stable（非强制），minimumVersion 1.9.51**（commit afe83be，SHA256 78ed28aaf1b8145d9b0ad1fa6fee1f778d5bdcffd80b41b4401f26bd71dd6150，release 20260928-232301-afe83be-v1.9.57，服务端同批上线）。
  - **Claude Code 加速**（设计 docs/Claude加速-网关切换.md，代码 internal/accel + accel_app.go）：线路落地是 POWER云 节点（中继签名验过）→ 自动把 Claude Code 切编码模式（改 ~/.claude/settings.json 的 ANTHROPIC_BASE_URL 指向本机 127.0.0.1:18765，逐字节可还原），否则官方默认；设置页有卡片。编码端经 sing-box 本机入口 accel-in 走 Claude Code 所在线路，连 accel.powervpn.internal:8896（落地机改写到本机中继，sub2api 仓 accel/ 0.5+）。
  - 服务端 `POST /v1/accel/token` 签 24 小时加速令牌，密钥 sz `/opt/proxysplit/secrets/accel-token-private.pem`（挂进容器 → ACCEL_TOKEN_PRIVATE_KEY_PEM；资产「ProxySplit · Claude 加速令牌签发私钥」），与会员租约密钥分开。
  - **scripts/remote-deploy.sh 已修好，`release-all.ps1` 恢复为唯一发布入口**：pg_dump 改用宿主机连共享 PG 并校验（以前每次都是 20 字节空备份）；OpenResty 站点配置 /www/conf.d/proxysplit.zygskins.cn.conf 不覆盖只 `openresty -t`。本次备份 10.8 MB 真实有效。

## 2026-09-27 AI 可在软件没打开时控制它（只进 main，未发版）
- 2026-09-27（只进 main，未发版）：**AI 可在软件没打开时控制它**。新增 `proxysplit.exe --mcp`：stdio MCP 桥（mcpbridge.go），initialize/tools/list 本地应答不拉起程序，tools/call 时若 18088 不通就以 `--background`（StartHidden，只驻托盘；未登录/启动失败/托盘没起来时自动显示窗口）拉起再转发 /mcp；token 每次从 config.json 读。界面「复制 MCP 配置」改为 stdio 命令写法。自动更新助手：`.old` 若被仍在跑旧版的 --mcp 桥占着删不掉，改名为 `.old.<ticks>.stale`，程序启动时清理。本机用开发版（appVersion=dev，无授权）实测：关掉程序 → 桥收到 tools/call 自动后台拉起（无窗口）→ status/start 正常 → GitHub 可访问。下一步：堡垒机「翻墙」能力（按人授权、节点分类下发、延迟自检），客户端接堡垒机密钥鉴权。

## v1.9.56（2026-09-26 下午，stable，mandatory=true，含服务端、收款与退款）
- 2026-09-26 下午：**v1.9.56 已上线 stable，mandatory=true**，minimumVersion 1.9.51（client commit 6fbca6f，SHA256 2cd085d038a375b9af8dd4dbc15798375fb22933a9fc88fb56044d9a26719cec，releases id e582bf0d-3bb8-456a-addf-cdad4573cd93；发布目录 sz /opt/proxysplit/incoming/client-v1.9.56-6fbca6f）。**服务端同日上线 releases/20260926-152705-c21fb7e-v1.9.56**（此前一直是 7 月的 v1.9.51 服务端），迁移 0010/0011 已应用。
  - **收款改走中转站网关线路 4 = 支付宝直连（收款主体 宣时龙）**：payment_providers.config.line=4（后台可改），下单带 line，拆单子单带 split=1；线路 5=姚尧（收钱吧，不支持拆单、只收 ≤30 元）。线路编号是 2026-09-26 用 /api/v1/pay/lines + 一笔核验单(merchant=支付宝直连, qr.alipay.com)确认的，网关在腾讯云 110.40.185.27（绝对不碰），只能以客户端身份调接口。订单新增 checkout_url（电脑收银台）/merchant_name；网关换线时 API 打 warn 日志。
  - **退款**：后台订单「退款」→ POST /v1/admin/orders/:no/refund {reason}，整组拆单一起退，只扣未用时长（权益流水 license_grants 记录每次发放的 start/end；refundedLicense 纯函数有单测）；2026-09-26 之前的订单无流水，只标退款不动会员，需手动调。钱在支付宝商户后台原路退。单笔回调到账改走 grantWithinTx（以前漏了试用剩余时长合并）。
  - 客户端：拦截排在自家接口/内网直连之前；阻止 QUIC 只挡进隧道流量（国内/直连不挡）；桌面快捷方式改 IShellLinkW（任意字符）；更新安装改为新版写 %APPDATA%/proxysplit/started-ok 握手、60 秒内没到就回滚；离线授权防调早时钟（lease iat + LastSeenAt 高水位，容差 10 分钟）。
  - （已过时，2026-09-28 起脚本已修好，见上）当时服务端部署经堡垒机手工做（scripts/remote-deploy.sh 里的 pg_dump 用的是已停的 proxysplit-postgres-1 容器，nginx 步骤也不适用）：本机 pnpm build admin → git archive HEAD:server + admin dist 打包 → transfer_link 传 incoming → 解到 releases/<id> → docker compose build api migrate → backup_run sz-proxysplit → compose run migrate → up -d api → 等 healthy → 切 current 软链。回滚：cd 上一个 release && docker compose up -d api（迁移都是加法）。
  - 待办：FakeIP（白名单下没列出的程序查境外域名不再经节点）用户决定等有能开 TUN 的测试机实测后单独发。

## v1.9.55（2026-09-26，stable，mandatory=true）
- 2026-09-26：**v1.9.55 已上线 stable，mandatory=true**，minimumVersion 仍 1.9.51（commit b4d8425，SHA256 78d502e7ff05bf9f0aa9f2e6ee8e662305bf8b2f5af60a229385789ae6ba080f，96,470,016 字节；releases id 6e19107a-2174-41ca-aff4-284ffb0db501，写在 sz-pg-proxysplit）。发布目录 sz /opt/proxysplit/incoming/client-v1.9.55-b4d8425，previous/ 存 1.9.54 的 latest，可 publish-client.py rollback。已用 internal/updater 以 1.9.54 身份实测 检查→下载→SHA256+验签 通过。内容为第三轮审计修复：① 自动更新安装助手：只重试换文件；换完启动新版并观察 8 秒，新版起不来(被杀软隔离/闪退)就换回旧版并重新打开；旧版启动时从 resume 标记(From==当前版本且有 To)识别安装失败，写 update-failed.json，24 小时内不再自动装同一版本(手动按钮仍可用)；InstallAppUpdate 加 atomic 防自动/手动并发安装；开发版(appVersion=dev)不建桌面快捷方式。已用假 old/good/bad 程序实测三种情况。② 应用热更新：sing-box 改文件后约 0.11 秒才生效，改为 0.6 秒后再断开受影响应用的旧连接(ruleSetReloadWait)。③ 按目标细分的应用规则：直连/拦截排在应用直连之后(各代理策略都生效)，走节点的排在 clash 直连之后、clash 全局之前。④ 默认全走代理下自定义「走代理」规则也按各应用自己的节点。⑤ 自定义线路：前端下拉可选、改别的应用不再把它冲成「规则」；出口「直连」可保存且真走直连(lineOutbound)。⑥ DefaultLine 接通：只在默认全走代理下决定没列出程序的线路(Options.SplitDefault)，不允许拦截，白名单下改它不重启。⑦ PowerShell 路径改用环境变量传入(弯引号 ‘’ 会结束 '…' 字符串)；WScript.Shell 本身存不了非 ANSI 字符(ß/emoji)，此时只记日志。⑧ SelectNode/RemoveNode/SetRouting/SetSettings/SetLogLevel 返回重启错误并在界面提示；restart() 在一把 lifecycleMu 下停+启，用户中途点停止不会被重新启动；整机全局下改应用规则不再重启。⑨ rulesio.go 乱码提示重写。界面: 节点表列宽/左栏比例、去掉重复「手动添加」、应用分流页默认线路选择。

## 2026-09-25 深夜 界面打磨（只进 main，未发版）与新节点
- 2026-09-25 深夜（只进 main，未发版，commit 2495514）：界面打磨——应用分流页按 整机全局/代理策略/分流模式 显示说明条、「未列出的应用」替代「默认出口」、概览延迟按好坏着色、侧栏联系卡改主题色、深色补 --surface-3/--bad-bg。浅色/深色实机截图已核对。下次发版随 1.9.55 带上。
- 新节点 twpro-中转（vless reality，出口 122.116.1.113）链接已存堡垒机资产 id 113，勿写进仓库。

## v1.9.54（2026-09-25 晚，stable，mandatory=true）
- 2026-09-25 晚：**v1.9.54 已上线 stable，mandatory=true（强制更新）**，minimumVersion 仍 1.9.51（commit b7373c8，SHA256 ba0b792b5269e2c9ead128a49be779ae7db5bd0fa4e7eda4c8e147ea121d01a1）。1.9.54 起客户端静默自动更新（autoupdate.go：启动 20 秒后 + 每 6 小时查；AutoUpdateApp 开或版本 mandatory 就自动下载验签安装重启；更新前代理在跑会写 %APPDATA%/proxysplit/resume-after-update.json，新版启动后自动恢复，10 分钟过期），每次启动确保桌面 ProxySplit.lnk（internal/shortcut，按长路径比较）。1.9.53 及以前的客户端只会弹不可关闭的强制升级框，用户点一次。已在本机实测：新代码按 1.9.53 编号本地构建 → 代理运行中 → 约 20 秒自动发现 1.9.54、下载验签替换、带 --updated 重启、代理自动恢复、桌面快捷方式自动建好，全程无点击。

## 2026-09-25 22:21 数据库迁到共享 PG
- **数据库已迁到共享 PG**（另一个会话 2026-09-25 22:21 做的）：现在用堡垒机数据源 **sz-pg-proxysplit**；旧容器 proxysplit-postgres-1 / redis-1 已停（数据源 sz-proxysplit-pg 已标停用），发版登记要写新库。

## v1.9.53（2026-09-25，stable）
- 2026-09-25：**v1.9.53 已上线 stable**（commit f482c6a，minimumVersion=1.9.51，mandatory=false）。产物 SHA256 b7c9182947c0dd1df39c5d8d42490047628233a633e4494943e7952acd69dad7，96,430,080 字节，Ed25519 验签通过；用客户端自带 updater 从 1.9.52 视角走 检查→下载→SHA256+验签 实测通过。只发客户端：sz /opt/proxysplit/incoming/client-v1.9.53-f482c6a/publish-client.py prepare→(登记 releases)→promote，previous/ 存旧 latest，可 python3 publish-client.py rollback 回退 latest（releases 表那行要另删）。本机没有管理员账号，releases 行是经堡垒机 db_query 直接插入并补了 audit_logs（与 POST /v1/admin/releases 等价）；**现在要写 sz-pg-proxysplit**。**发布签名私钥在堡垒机资产 id 116**：打包前写回 server/secrets/shenzhen-release-private.pem（LF 换行，SHA256 与 profile.json 对得上），打完删掉。注意 minimumVersion 会进授权租约 minVersion，别随手调高，否则老客户端会被拒。

## 2026-09-25 分流规则两轮审计（第一轮、第二轮均已随 1.9.53 发布）
- 2026-09-25（未发布，只进了 main）：修复用户反馈「自定义规则无效、删掉的应用还能代理」。BuildTUNConfig 里全局自定义规则原先排在 代理策略 与按应用分流之前、且不限进程：直连/全局下仍生效，白名单下「代理」规则会把列表外应用拉进隧道。现在带 clash_mode=rule，白名单下代理规则按组限定进程并走组节点，排在应用 直连/拦截/细分规则之后；TUN 配置补上 DirectDomains（bf4a523 当时只修了旧多线路配置）。回归测试 TestCustomRulesStayInsideWhitelist；已用 sing-box 1.14.1 实测 clash_mode=rule 只在规则模式匹配。用户那台的另一原因：自定义规则写成 zygskisn.cn（错字）；Claude/Codex 走国内中转 sub2api.demo.zygskins.cn，本来不需要代理。已随 1.9.53 发布。
- 2026-09-25 第二轮（已随 1.9.53 发布）：审计 直连/规则/全局 × 白/黑名单 × 应用线路。BuildTUNConfig 重排为 固定直连(API/内网/自身) → 应用拦截/直连 → clash 直连 → 局域网 → 屏蔽QUIC → clash 全局(列出应用走各自节点, 其余走 proxy) → 规则模式(细分规则/自定义/各应用线路)。应用进程名单改放 <数据目录>/rules/*.json 本地 rule-set(sing-box 改文件即热加载, 1.14.1 实测含原子替换); 内置 规则/全局@活动节点 两组永远存在, 所以增删改应用配置字节不变 → Manager.ApplySplitLists 只写文件不重启, 再用 clash API 按进程名断开受影响应用旧连接。组内条件用 logical and(同一条规则里 rule_set 之间是 OR)。空名单用占位进程 proxysplit-none.invalid(空列表=无条件=全匹配)。回归: internal/core/routing_matrix_test.go 用真 sing-box 跑 20 个场景(TUN 换 mixed、节点换假代理、DNS 换 hosts), 变异测试能抓到; 测试要用 sing-box 私有副本, 否则 service 测试的 CleanStrays 会杀掉它。sing-box CONNECT 在首个数据字节才拨号/入 /connections。新装默认 RuleMode=whitelist。占位进程名还有一个作用: sing-box 只在启动时根据规则集里有没有进程规则决定是否识别进程(SagerNet/sing-box#4341), 去掉占位会让之后热加载进来的应用全部失效。

## v1.9.52（2026-09-17，stable）与 Defender 误报排查
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
- 2026-09-17 用户再次报告安全中心删文件，尚未提供受影响机器/版本/威胁名/路径。再次确认当前开发机无可用 Defender，引擎缺失不能等同扫描通过；v1.9.52 哈希/更新签名一致，仍无 Authenticode。
- 本次已修复 diagnose-defender.ps1 对隔离后不存在路径直接退出的问题，增加独立检测历史/威胁名/事件日志采集；缺失文件、现存文件及状态接口失败但事件可用的回归通过。运行时替换 PowerShell 的试改已完全撤回，未构建或发布未经证据验证的新版本。

## 2026-10-23 v1.9.91 审计修复发布

- 最近改动（1.9.84–1.9.90）做代码审计后修复：环境配置恢复不覆盖用户后改的值、一键修复只修 warn/fail、公司出口名单查询自带超时与失败短缓存、AI 代理端口冷启动复检、设置页检测改为手动、二维码失败仍给链接。强制更新，min 仍 1.9.51。
