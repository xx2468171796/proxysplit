# POWER云 / 会员 / 刷新令牌 / aigw / 支付

> 逐版事实见 docs/decisions.md；设计 docs/中转站渠道.md、docs/线路设计.md。

## POWER云 接入是公司标准
改 internal/powervpn、internal/coreupdate、bin/core-release.json、PanelPublicKey、服务端 /v1/auth/powervpn 之前，先读 powervpn 仓 `docs/platform/PowerVPN-客户端接入标准.md`（字段合同 openspec/changes/client-device-identity/design.md），按其第 8 节清单三处一起改。
- 发布顺序 面板 → 节点 → 本仓服务端 → 客户端；换签名密钥必须先发带新公钥的客户端。
- POWERVPN_BASE_URL 用默认 https://lxc.5fskins.com；/v1/auth/powervpn 假令牌返回 401 POWERVPN_TOKEN_INVALID（commit 9a5a6d8，迁移 0012_powervpn_identity）。
- 复审修复（v1.9.59）：按面板稳定节点标识 key 认自家节点、认领设备名不为空、endpoints 失败退避、导入第三方 sing-box 出站去掉作者本机字段、分流名单热更新先加后减。

## 中转站客户会员跟 AI 套餐走（aigw）
POWER云 /client/me 的 aiPlanExpiresAt → licenses 单独一行 source='aigw'（普通会员），登录时 + 客户端每 3 小时 POST /v1/auth/powervpn/sync 同步。
- grantWithinTx / extendLicense 永不碰 aigw 行；AI 到期该行标 expired，客户在会员中心单独买。
- 首次 POWER云 登录（中转站渠道、应用分流为空）预置 chrome/msedge/claude/codex/Code/Cursor。
- 交付先开会员：`POST /v1/admin/users/powervpn {externalId:<POWER云 客户 uuid>, channel:"aigw"}` 预建 pv_<前 8 位> 账号 → `/v1/admin/users/<id>/grant`。

## 中转站渠道认定（迁移 0013_user_channel）
AI 编程官网（aigw）客户不显示作者联系方式（QQ 群 / 微信 / 赞赏码 / 官网 / GitHub），登录按钮改「用 AI 编程官网账号登录」并打开 POWER云 `/api/auth/aigw/start`。
- 认定条件：安装包名带 proxysplit-ai（AI 官网给 /v1/download/proxysplit-ai-latest.exe，downloads/ 里是 latest 的软链，remote-deploy.sh 每次发版原子重建），或 users.channel='aigw'（/api/client/me 的 sources 含 aigw 时登录记上）。
- 本机标记 %APPDATA%/proxysplit/channel，只升不降。

## 从 AI 官网下载即登录（v1.9.62）
文件名 proxysplit-ai-<43 位 POWER云 一次性凭据>.exe，启动后后台 startAutoLogin 换令牌 + finishPowerVPNLogin（与浏览器登录同一套后续步骤）。
- 凭据面板有答复才记哈希（%APPDATA%/proxysplit/download-ticket）；界面 AutoLoginPending / WaitAutoLogin。
- 下载走深圳 Nginx 静态路径 /download/proxysplit-ai-<凭据>.exe（嵌套 location，不记日志），不经 /v1/download（Fastify / Nginx 会记查询串）。

## 访问范围（egress，v1.9.63）
签名配置 accounts[].egress 含拦截名单 + 「仅 AI」名单，`internal/core/egress.go` 把指向受限线路的路由拆成「拦截名单 → direct」「仅 AI：名单 → 线路，其余 → direct」，TUN 与分线路两种模式都生效。
- 真内核测试 TestRoutingMatrixAIOnly / TestRoutingMatrixBlockedList；合同见 powervpn 仓 docs/platform/PowerVPN-订阅访问范围.md。

## 刷新令牌丢响应容错（服务端 0a3cfc9）
旧令牌已轮换、其后继（同事务 created_at = 父 consumed_at）从没用过、同设备、10 分钟内，视为重试：作废后继再轮换；否则仍按重放整条作废（`classifyRefresh`，store.ts）。
- 起因 cpcc00004：刷新 200 后客户端没接住，下一分钟旧令牌 → REFRESH_REPLAY，一上午被踢 5 次，付了款还显示「暂无有效会员」。
- 客户端配套：刷新 401 清在线会话回登录页（只进 main，随后续发版）。

## 免费档 / 手机号 / 云同步（服务端，迁移 0019）
- 权益只认 core `entitlement.ts` 的 `effective()`：无会员 = 免费版（tier free、设备数 = default_device_limit，现为 1），会员 = 1 + 套餐 max_devices，管理员不限。免费也签租约。
- `/v1/accel/token` 仍只认真实会员（加速是会员功能），不走 effective。`/v1/me` 的 membership 仍是原始会员（老客户端看它），新增 license / user.phoneBound。
- 手机号存 users.phone（11 位）；登录框纯 11 位 1 开头先按手机号查、查不到当用户名。老客户端只发邮箱注册仍接受。
- 云同步 / 云端配置 / 分享导入在 core config-sync.ts / config-profiles.ts，路由 api sync-routes.ts；份数免费 0 / 普通（含试用）1 / 超级 5。

## 授权与租约
Ed25519 离线租约绑定账号 / 设备 / 硬件 / 期限；minimumVersion 会进租约 minVersion，别随手调高。
- 离线授权防调早时钟：lease iat + LastSeenAt 高水位，容差 10 分钟。
- 试用硬件摘要依赖客户端上报；离线租约仍存在系统时间回拨 / 快照风险（见 known-issues.md）。

## 收款与退款（服务端，v1.9.56）
收款走中转站网关线路 4 = 支付宝直连（收款主体 宣时龙）：payment_providers.config.line=4（后台可改），下单带 line，拆单子单带 split=1；线路 5 = 姚尧（收钱吧，不支持拆单、只收 ≤30 元）。
- 网关在腾讯云 110.40.185.27，绝对不碰，只能以客户端身份调接口；线路编号 2026-09-26 用 /api/v1/pay/lines + 一笔核验单确认。
- 订单新增 checkout_url（电脑收银台）/ merchant_name；网关换线时 API 打 warn 日志。
- 退款：后台订单「退款」→ POST /v1/admin/orders/:no/refund {reason}，整组拆单一起退，只扣未用时长（权益流水 license_grants 记录每次发放的 start/end；refundedLicense 纯函数有单测）；2026-09-26 之前的订单无流水，只标退款不动会员，需手动调；钱在支付宝商户后台原路退。
- 单笔回调到账走 grantWithinTx（以前漏了试用剩余时长合并）。
- 拆单续付（2026-10-23）：拆单各笔共用一个过期时间，付了一部分、其余过期时，再买同一套餐会续付这一组（resumeSplitInTx）：还有效的那笔原样返回、不重复下单，过期的标 closed 并换新单号重发；「全部付齐」只数非 closed 的笔。旧二维码迟到付款照样算（closed 的笔仍对账、可到账，同序号的替补自动关掉）；后台手动确认拆单子单只确认这一笔、付齐才发（payGroupPieceInTx，与回调同一组级事件防重复发放）。真库场景脚本在 pve-pg-proxysplit-paytest 跑过 14 项全过。

## 免费档 / 手机号 / 配置同步（客户端，2026-10-29，docs/plan-2026-10-29-free-sync-phone.md）
- license.Status 增 member / freeDevices / planDevices / phoneBound；tier=free 照常签租约、全部功能可用；租约 409 DEVICE_LIMIT → PendingDevice（只有这时出整页闸门）。APIError 带服务端 code。
- 手机号：internal/license/phone.go（发码 / 手机注册 / 短信找回 / 补绑 / RefreshProfile 读 /v1/me）；老账号 phoneBound=false 每次登录后弹绑定框，「下次再说」只关本次。
- 配置包：internal/configsync（schema 1，sections nodes / subscriptions / rules / proxyPorts / settings）；不含 POWER云 官方线路与 powervpn://profile 订阅、apiToken、sysProxyLast、测速值。恢复可勾选部分，先备份到 %APPDATA%/proxysplit/config-before-import.json（撤销一次）；引用不存在的节点回落默认。
- 云同步：configsync.Syncer，状态存 configsync.json（lastVersion / lastHash）；启动 8 秒后对账、每 10 秒查改动（连续两次同一哈希才上传 = 防抖）、5 分钟查云端；从没同步过的电脑遇到云端已有内容也算冲突，弹「用云端 / 用本机」。哈希不含订阅节点列表和测速，订阅刷新不触发上传。退出账号清同步记录。
- 云端配置：列表 / 另存 / 覆盖 / 改名 / 删除 / 恢复密码（POST /:id/restore）/ 分享码；分享导入任何档位。界面在设置「配置与同步」；侧栏「会员」/「我的权益」。
