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
- 客户端配套：只有明确的吊销错误码才清会话（见下「授权与租约」），不再是「刷新 401 就回登录页」。

## 免费档 / 手机号 / 云同步（服务端，迁移 0019）
- 权益只认 core `entitlement.ts` 的 `effective()`：无会员 = 免费版（tier free、设备数 = default_device_limit，现为 1），会员 = 1 + 套餐 max_devices，管理员不限。免费也签租约。
- `/v1/accel/token` 仍只认真实会员（加速是会员功能），不走 effective。`/v1/me` 的 membership 仍是原始会员（老客户端看它），新增 license / user.phoneBound。
- 手机号存 users.phone（11 位）；登录框纯 11 位 1 开头先按手机号查、查不到当用户名。老客户端只发邮箱注册仍接受。
- 云同步 / 云端配置 / 分享导入在 core config-sync.ts / config-profiles.ts，路由 api sync-routes.ts；份数免费 0 / 普通（含试用）1 / 超级 5。

## 短信验证码走雷池验证中心（2026-11-17 随 v1.12.5 上线）
业主定：注册 / 找回密码 / 绑定手机号的短信验证码与开箱站一样，只走公司验证中心 leichiwaf-verify（参考实现 V7），不再由本站直连云片。起因：用户反馈「注册不了」，本站直发时通道拒发一律显示「短信发送失败」且没有日志。
- **两种模式，没有第三种**：`LCV_SITE_ID` / `LCV_HOST` / `LCV_SITE_SECRET` 三项都配 = 中心模式；都不配 = 本地模式（原来的云片 + sms_codes 表，开发 / 测试 / 回退用，行为不变，只多了一行失败日志）。只配一部分、或中心模式没配 REDIS_URL：启动直接报错。启动日志有一行 `sms mode: center|local`。
- **代码**：core `sms-center.ts`（公司包 yanzheng/verify-client 的 createSiteOtp，vendor 在 core/src/vendor/yanzheng，tag yanzheng-v2.43.0，`node scripts/vendor-company.mjs <yanzheng 仓> yanzheng` 升级）；AuthService `setSmsCenter` / `sendSmsCode`；api `phone-routes.ts`。站点 KV 用 API 现有的 Redis，键 `proxysplit:lcvotp:{vid|ok|miss}:sms:<用途>:<手机号>`（只用 get / set / del / incr / expire）；暂存哈希密钥 stashSecret = LCV_SITE_SECRET。
- **发码** `POST /v1/auth/sms/send` 多收 `captchaTicket`（≤ 2048）和 `deviceFp`（≤ 128，只认请求体；不读 x-device-fingerprint 头，原始指纹不会转给中心）；用户 IP 取 req.ip（trustProxy 只信 1 跳，nginx 覆盖 X-Forwarded-For）。成功回 `{ok, cooldownSeconds, message}`。文案全部用 SDK 默认值，错误码：
  | 中心 / SDK 结果 | 本站错误码（HTTP） |
  |---|---|
  | 没带凭证字段（已发版老客户端） | CLIENT_UPGRADE_REQUIRED（400）「请升级到最新版本后再获取验证码」 |
  | 没带凭证字段且请求带 Origin 头（浏览器里缓存的旧官网页面） | PAGE_REFRESH_REQUIRED（400）「请刷新页面后重试」 |
  | 凭证为空 / CAPTCHA_REQUIRED / CAPTCHA_INVALID | CAPTCHA_REQUIRED（403）——只用这一个码，客户端据此重新弹验证 |
  | COOLDOWN {resendAfter} | SMS_COOLDOWN（429），错误体里带 `cooldownSeconds` |
  | QUOTA_EXCEEDED {bucket} | SMS_DAILY_LIMIT（429） |
  | BLOCKED_PREFIX / BAD_RECIPIENT | SMS_BLOCKED_PREFIX / SMS_BAD_RECIPIENT（400） |
  | SEND_FAILED / CHANNEL_NOT_CONFIGURED | SMS_SEND_FAILED（502）/ SMS_UNAVAILABLE（503） |
  | 中心不可用、本站 Redis 不可用 | SMS_BUSY（503），一律拒发（fail-closed） |
  核码：格式错 / 没发过 / 错码（带剩余次数）/ 失效 → SMS_CODE_INVALID（400）；中心不可用 → SMS_BUSY（码没烧，原码可重试）。
- **中心模式注册必须带手机号 + 验证码**：只带邮箱的注册（老客户端、绕过页面直接调接口）一律拒——客户端接口回 CLIENT_UPGRADE_REQUIRED「请升级到最新版本后再注册」，官网接口回 PHONE_REQUIRED「请使用手机号注册」；否则短信和滑块都能被绕开。邮箱只是可选附加字段。本地模式仍接受老客户端的邮箱注册。
- **用户名不能是手机号**（两种模式、两个注册接口）：`^1[3-9]\d{9}$` 的用户名回 USERNAME_IS_PHONE「用户名不能是手机号」，除非就是本次验证的手机号。只管注册，登录不动——已有的「用户名 = 手机号」老账号照常登录。
- **防枚举**：注册、绑定发码对每个号照常发（绑定发码不回「号已被占用」，PHONE_TAKEN 只在提交绑定、核码之后才报）；「已注册」只在注册那一步核码之后才说；找回发码用 sendIfExists，已注册 / 未注册同一句「若该手机号已绑定账号，验证码已发送，5 分钟内有效」、至少 2.5 秒，没注册的号只核凭证不发码；找回改密那一步核码的所有失败统一「验证码错误」、至少 800 毫秒。「今天已找回过」改到改密那一步（核码之后）才提示。
- **顺序（同 V7，被闸门拒掉的人码不会被烧掉）**：只读核码（consume=false）→ 其它闸门（撞号、用户名 / 邮箱占用、注册开关、设备 / IP 账号上限、试用套餐是否存在、当天找回次数、换绑密码）→ 消费（consume=true，在线核销只成功一次）→ 写库。注册的消费放在建号事务里、插入用户之前（store.registerTrialUser / registerWebUser 的 beforeInsert）。
- **客户端**：三处「获取验证码」（注册 / 找回 / 绑定，共用 features/account/sms-fields.tsx）先弹滑块：`state/human-verify.ts` 的 openHumanVerify("sms") 盖全屏 iframe 加载中继页 `/pay-verify.html?n=<nonce>&action=sms`，凭证经 Go `SendSMSCode(phone, purpose, captchaTicket)` 带给服务端。取消 = 不发请求；中继页 12 秒没起来 = 带空凭证照发、把服务端的话原样显示（**不假装成功**，这点和付款不同）；回 CAPTCHA_REQUIRED 且本次带了凭证 = 再验一次重发，最多一次。付款验证改为共用同一个 helper（pay-verify.ts 只剩下单流程）。
- **中继页** website/public/pay-verify.html：`action` 白名单 pay / sms / register / reset，不带或不认识按 pay（已发版客户端打开的就是不带 action 的地址，文件名因此不改）；回传消息带 action，客户端核对用途——老中继页不认 action、一律出付款用途的凭证，拿去发短信必被拒，客户端把它当「验证页没起来」。
- **官网注册表单**（同源）：website/src/human-verify.ts 直接加载 `/__leichiwaf/hv/hook.js` 调 `LcVerify.open({action:"sms"})`，凭证随发码请求带上；短信相关的错误提示改用服务端原话。
- **启动**：日志 `sms mode` 记的是 core 实际生效的模式；env 配了 LCV_* 而 core 没切到中心模式 = 启动失败（不会悄悄回落到本地直发）。
- **找回改密时中心故障**：对用户仍是统一的「验证码错误」，服务端日志有 `sms center check unavailable … fail-closed {"reason":…}` 和 `sms center check unavailable purpose=reset phone=… consume=…` 两行，和真错码（不记 unavailable）分得开。
- **日志**：中心模式失败记 `sms center send failed purpose=… phone=138****8000 result=… center=… bucket=…`；本地模式云片拒发记 `sms yunpian send failed phone=… http=… code=…`。不记验证码、凭证、密钥。
- **上线步骤**（顺序不能乱）：
  1. 中心登记站点（sz `LCV_SITES_FILE`，改完 `kill -HUP`）：`"proxysplit": {"secret": "<≥32 字符，存堡垒机资产>", "hosts": ["proxysplit.zygskins.cn"], "sms": "<云片通道名>", "bindIp": false, "failClosed": ["register","sms","reset","withdraw"]}`；不要配 captchaExempt（三种用途都过滑块）；要自动化测试再加 aiPass。云片模板要有 register / reset / bind（或 default）。
  2. sz 加签名端口桥接（api 在 docker 里连不到宿主 127.0.0.1:8977）：仿 `/www/conf.d/proxysplit-hv-bridge.conf` 再开 `172.20.0.1:18977 → 127.0.0.1:8977`，只许 docker 网段访问，**原样透传 Host、不许加 X-Real-IP / X-Forwarded-For**（中心对带 X-Real-IP 的签名请求一律 404）。
  3. 发官网（中继页认 action + 注册表单弹滑块）和新客户端（发码带凭证）——这两样在服务端还是本地模式时就能先上，互不影响。
  4. 最后在 /opt/proxysplit/secrets/runtime.env 加 `LCV_SITE_ID=proxysplit`、`LCV_HOST=proxysplit.zygskins.cn`、`LCV_SITE_SECRET=…`、`LCV_URL=http://172.20.0.1:18977` 并重启 api；看启动日志 `sms mode: center`，真机各发一条注册 / 找回 / 绑定。回退 = 删掉这四行重启（云片的 YUNPIAN_* 先别删）。
  - nginx 站点配置不用动：中继页地址没变，`$ps_embed_ok` 已放行 /pay-verify.html 和 /__leichiwaf/hv/。
- **坑**：① LCV_HOST 必须是出滑块那个页面的域名（凭证按域名绑定），客户端中继页和官网都在 proxysplit.zygskins.cn。② 服务端切到中心模式后，v1.12.4 及更早的客户端发码只会看到「请升级到最新版本后再获取验证码」，所以必须先发客户端。③ 中心的冷却 / 限额才算数，本站 sms_codes 表在中心模式下不读不写（表和迁移保留，本地模式还用；后台统计里的短信条数在中心模式下不再增长，条数看雷池面板）。④ SDK 只能用 node:http 显式带 Host，别改成 fetch。⑤ 核码成功后 SDK 会把结果票据暂存到 Redis（最长 10 分钟），Redis 不可用时一律拒（fail-closed）。
- **没验证的**：没连过真中心（站点未登记、桥接未建）；8977 签名端口在 sz 的实际监听情况、云片通道名、WebView2 / WKWebView 里 sms 用途的滑块真机表现、官网真实边缘下的 hook.js。测试用假中心 + 本机假端口覆盖了签名头 / Host / 错误码映射 / 顺序。

## 授权与租约
Ed25519 离线租约绑定账号 / 设备 / 硬件 / 期限；minimumVersion 会进租约 minVersion，别随手调高。
- 离线授权防调早时钟：lease iat + LastSeenAt 高水位，容差 10 分钟。
- 试用硬件摘要依赖客户端上报；离线租约仍存在系统时间回拨 / 快照风险（见 known-issues.md）。
- **吊销只认错误码（2026-11-18 审计，`internal/license/rejection.go`）**：`ACCOUNT_UNAVAILABLE / DEVICE_MISMATCH / REFRESH_INVALID / REFRESH_REPLAY` 才清会话，而且会话和租约一起清（`applyRejectionLocked` 是唯一改状态的入口）；`DEVICE_LIMIT` 只清租约、留会话去解绑；408 / 425 / 429、WAF 或上网认证页（没有本站 JSON 错误码的 4xx）、断网都按临时故障，保留会话与租约走离线宽限。POWER云 那边是另一套协议：只有 OAuth `invalid_grant` 才丢授权（`powervpn.grantRejected`），两处各管各的服务端，不合并。
- 刷新节奏：巡检每 60 秒只取租约（不轮换凭据，封号 / 解绑 / 套餐变化仍在一个周期内生效）；访问令牌剩余不足 2 分钟或年龄未知才刷新（`renewOnlineLocked`，按本机收到时间 + 服务端有效期算，不受时钟不准影响）；租约 401 且不是吊销码时补一次刷新。巡检条件 = 有会话 / 租约仍有效 / 代理在跑 任一成立（未登录但代理在跑会被停）。没有会话的租约加载时丢弃。
- 设备指纹：成分第一次完整算出后用 DPAPI 封存到数据目录 `device.dat`（`machine_store.go`，唯一来源），之后直接复用不再探测；老用户首次按 4 / 8 / 15 秒重试探测成功才落盘（指纹不变），连续 3 次启动都失败才把注册表成分定为指纹。**device.dat 不能删**（指纹变 = DEVICE_MISMATCH + 多占一个名额），清除与重置任何一项都不碰它。powervpn 的设备 ID 取同一份。
- 签租约按设备自己的平台取最低版本与最新版（macOS 不再拿到 Windows 的版本线）。

## 登录、限流与后台权限（服务端，2026-11-18 审计）
- 登录：账号不存在 / 密码错 / 被锁定统一回 `AUTH_INVALID` 401 和同一句文案（锁定期间不验密码，也花一次哈希时间，区别只进审计）。锁定规则在 `core/login-lockout.ts`：最长 30 分钟，成功登录或 24 小时没再被锁则级别归零，自助改密也清零；手机号形状的输入有人绑定就只认绑定者，没人绑定才按用户名找。
- 自助改密只吊销其它设备的会话，保留本人正在用的这台。
- 限流（`apps/api/src/rate-limits.ts`）：Redis 不可用时默认放行（skipOnError），只有发短信、客户端注册、官网注册拒绝并回 503 `RATE_LIMIT_UNAVAILABLE`；键前缀 `proxysplit:rl:`。每台在线客户端都会定时调的接口（刷新、POWER云 同步、订单 / 通知轮询、配置同步、日志上报）统一 `FLEET_LIMIT` 每 IP 每分钟 600，刷新另加每会话 family 每分钟 30 次；人手动触发的接口限额不变。
- 匿名节点上报口：每 IP 每 10 分钟 64 MB、库里没见过的设备号每 IP 每小时 30 个（内部功能，见 docs/节点上报.md）。
- 后台：动管理员账号（改状态 / 重置密码 / 封禁 / 强制下线 / 解绑设备 …）或新建管理员必须是超级管理员（`admin-guard.ts`，`SUPER_ADMIN_USERNAMES`，配成空串按默认 admin）。
- 会话 / 审计表：迁移 0024 补索引；成功刷新不再写审计；API 进程每小时清过期超过 1 天、或吊销 / 消费超过 7 天的会话行（`session-retention.ts`）。

## 收款与退款（服务端）
**2026-11-17 起改走公司统一支付中心 zhifu-service（分支 feat/zhifu-center，未上线）**：迁移 0022 加通道 `zhifu-center`（adapter `center`）并设为当前通道；中心按站点路由通道（目前只有微信 zyg1103wx），本站不选通道、**不拆单**（createOrders 对 center 只建一笔）。
- 代码：core/pay-center.ts（CenterPay，公司包 zhifu 6.17.1 的 zhifu/site，vendor 在 core/src/vendor/zhifu，只拷 site + center 用到的文件；运行时依赖 zod）、pay-center-book.ts（订单簿 pay_center_orders、回调去重 pay_center_notifies）；PaymentService 按 adapter 分 zhongzhuan / center。
- 下单：本地订单号作 requestId → 中心站点单号 `PR…`（同一本地单重试幂等），写进 orders.provider_order_no，pay_url = 中心给的码，expires_at 改成中心截止时间。subject 用 SDK 默认「充值」，不带站名 / 域名（业主红线）。中心拒单（COOLDOWN / QUEUE_FULL / QUEUED / PAY_BANNED / AMOUNT_INVALID / COLLECTION_OFF / CHANNEL_BUSY / CHALLENGE_REQUIRED / OPEN_ORDER / TRUST_REQUIRED）→ 错误码 `PAY_<码>`，中心的中文原因原样给客户端，本地单标 failed。本站自己另一笔未付单（OPEN_ORDER 同站）自动「取消后重新下单」。
- 回调：POST /v1/pay/center/notify（作用域内 JSON 按原始字符串收，验签要原字节），回复原样（2xx `{"code":0}` 才算收到，中心退避重试 72 小时）。SDK 核对用户与金额 → fulfillPaidOrder（事件号 `center:<站点单号>`，payment_events 唯一键 = 恰好一次落地、grantWithinTx、分销结算、到账通知）。**去重顺序（2026-11-18 审计）：seen → 发放 → mark**，发放成功后才把 notify_id 记成已处理（以前先记后发，进程在两步之间重启就再也不发放）；发放至少一次、落地恰好一次。
- 查单 / 对账（对账定时器 / 客户端轮询，`syncCenterOrder`）：中心 expired / cancelled → 本地标 failed；**中心已付而本地还是 pending / failed → 走同一个 fulfilCenter 补发并记 warn**（事件号与回调相同，两条路互相去重），被卡住的历史订单也由对账补上。
- 中心还回旧未付单（reused）时的接管规则只在 `core/order-reuse.ts`：同用户、同套餐、同金额、同通道、非拆单、且旧单是 pending / failed 才接管（已付的旧单绝不接管），并在与 createOrders 相同的事务 / 锁 / 在售 / 限购检查里作废新单、恢复旧单；不能接管就让中心取消旧单再开新码（重下成功后才清订单簿的 reused 标记），仍拿回旧单则明确报错。
- 退款：后台退款同下面老流程（本地标记 + 扣时长，钱在商户后台原路退）。**中心侧退款会同步回来**（onRefunded → `PaymentService.refundCenter` → `store.refundOrder`，原因「支付中心退款」，审计 `payment.center.refund` 写在退款事务里）：已退直接确认；本地还没发放则不确认、让中心重试；部分退款不自动收回整笔会员，记 warn + 审计交人工。动钱 / 动会员的后台操作（退款、手动确认、发放 / 续期、代理商结算 / 改比例）审计行都与业务同一事务（`core/audit.ts insertAudit`）。
- 付款前人机验证服务不可达时按通过放行，但记 warn 并累计 `CenterPay.stats.hvUnavailable`。老网关回调对「订单不存在 / 通道不符 / 签名错误」统一回 401 `PAYMENT_SIGNATURE_INVALID`（不让人按状态码探订单号）。
- 套餐目录 `GET /v1/catalog/plans`（免登录）除套餐外带 `freeDevices`（= 运营设置 defaultDeviceLimit）和 `paymentMethods`（按当前收款通道：通道 config.methods 优先，center = `wechat`，直连网关 = 设置项；`core/catalog.ts`）。官网与客户端的「免费版 N 台」「用微信扫码」都读它；后台「支付通道」页显示的也是这个。
- 运行时 env（不进仓，值在堡垒机资产）：PAY_MODE=center、PAY_CENTER_URL=https://zfzx.zygskins.cn、PAY_CENTER_APP_ID、PAY_CENTER_SECRET，PAY_HV_HOST=proxysplit.zygskins.cn（付款前人机验证，见下节）。不全 = 下单 503「统一支付中心尚未配置」。上线前在中心「站点」登记回调地址 https://<API 域名>/v1/pay/center/notify，WAF 放行该路径。
- 客户端：微信电脑码是 `weixin://wxpay/bizpayurl?…`，老客户端 validPaymentURL 只认 https / alipays 会报「支付链接格式无效」→ 需发带 wechatNativePayURL 的新客户端（只画二维码，不本机打开）；付款框按链接显示「微信 / 支付宝」。


### 付款前人机验证（hvToken，分支 feat/pay-hv，2026-11-17，未上线）
支付中心全局开了「每笔订单都要先过验证」（challengeEveryOrder，中心统一，站点不能关），不带凭证的下单一律 `PAY_CHALLENGE_REQUIRED`。
- 客户端：点「立即购买」先盖全屏 iframe 加载 `https://proxysplit.zygskins.cn/pay-verify.html?n=<nonce>`（website/public/pay-verify.html），中继页在站点同源里调 `LcVerify.open({action:"pay"})`，凭证 postMessage 回 Wails 窗口（只发给 http(s)://wails.localhost / wails://wails；2026-11-18 起不再发给开发地址 localhost:34115，wails dev 联调办法写在该文件开头的注释里；客户端校验 origin + nonce）→ CreateMembershipOrder(planId, hvToken)。取消 = 不下单；验证页 12 秒没起来 = 不带凭证下单（中心关了全局开关时照常能付）；仍回 PAY_CHALLENGE_REQUIRED 就再验一次重下，最多一次。代码 frontend/src/state/pay-verify.ts、OrderResult.errCode。
- 为什么不在 Wails 页里直接引 hook.js：hook.js 的验证页 iframe 是相对路径、只认同源 postMessage，凭证又绑站点域名（hv 服务按 Host 绑 action + 域名，无 cookie），Wails 的 origin 不是站点域名。
- 服务端：POST /v1/orders 可选 `hvToken`（zod 1–2048，与 captchaTicket 同一上限；客户端收凭证上限 1024）。CenterPay.create 用 SDK 的 redeemHumanToken 兑换**一次**（bad = 不声明通过交中心拒；ok / 验证服务不可达 = challengePassed），同一结果用于 OPEN_ORDER 自动「取消后重下」的第二次下单——凭证一次性，交给 SDK 每次下单各兑一次会让第二次变 bad、玩家死循环。未配 PAY_HV_HOST = 忽略凭证。API 在 sz 本机，127.0.0.1:8976 可达（SDK 兑换只能本机直连）。
- 老客户端不带凭证：中心拒，提示「请先完成安全验证再购买（旧版客户端请先升级）」；新客户端发版即强制更新。
- 上线需要：① 服务端 env `PAY_HV_HOST=proxysplit.zygskins.cn`（PAY_HV_URL 默认 http://127.0.0.1:8976 不用配）② 官网带 pay-verify.html ③ sz nginx：本站 server 层 `X-Frame-Options: DENY` 连同源的 hv 验证页 iframe 都挡，要对 /pay-verify.html 和 /__leichiwaf/hv/ 去掉 XFO、改发 `Content-Security-Policy: frame-ancestors 'self' wails: http://wails.localhost https://wails.localhost wails://wails http://localhost:34115`（map 写法见下）④ 发新客户端。hook.js 本站已可用（2026-11-17 实测 200）。
- nginx（/www/conf.d/proxysplit.zygskins.cn.conf，文件顶部 http 层加 map，server 层把 `more_set_headers "X-Frame-Options: DENY";` 换成两行）：
  ```
  map $uri $ps_embed_ok { default 0; /pay-verify.html 1; ~^/__leichiwaf/hv/ 1; }
  map $ps_embed_ok $ps_xfo { 1 ""; default "DENY"; }
  map $ps_embed_ok $ps_frame_csp { 1 "frame-ancestors 'self' wails: http://wails.localhost https://wails.localhost wails://wails http://localhost:34115"; default ""; }
  # server 443 内：
  more_set_headers "X-Frame-Options: $ps_xfo";
  more_set_headers "Content-Security-Policy: $ps_frame_csp";
  ```
- 待实测：Windows WebView2 与 macOS WKWebView 各真付一次（mac 上 iframe 跨站，若验证页依赖 cookie 会被 ITP 挡；目前 hv 的 pay 凭证不用 cookie）。

### 老通道（zhongzhuan，v1.9.56，保留：历史单查单 / 迟到回调 / 退款）
收款走中转站网关线路 4 = 支付宝直连（收款主体 宣时龙）：payment_providers.config.line=4（后台可改），下单带 line，拆单子单带 split=1；线路 5 = 姚尧（收钱吧，不支持拆单、只收 ≤30 元）。
- 网关在腾讯云 110.40.185.27，绝对不碰，只能以客户端身份调接口；线路编号 2026-09-26 用 /api/v1/pay/lines + 一笔核验单确认。
- 订单新增 checkout_url（电脑收银台）/ merchant_name；网关换线时 API 打 warn 日志。
- 退款：后台订单「退款」→ POST /v1/admin/orders/:no/refund {reason}，整组拆单一起退，只扣未用时长（权益流水 license_grants 记录每次发放的 start/end；refundedLicense 纯函数有单测）；2026-09-26 之前的订单无流水，只标退款不动会员，需手动调；钱在支付宝商户后台原路退。
- 单笔回调到账走 grantWithinTx（以前漏了试用剩余时长合并）。
- 拆单续付（2026-10-23）：拆单各笔共用一个过期时间，付了一部分、其余过期时，再买同一套餐会续付这一组（resumeSplitInTx）：还有效的那笔原样返回、不重复下单，过期的标 closed 并换新单号重发；「全部付齐」只数非 closed 的笔。旧二维码迟到付款照样算（closed 的笔仍对账、可到账，同序号的替补自动关掉）；后台手动确认拆单子单只确认这一笔、付齐才发（payGroupPieceInTx，与回调同一组级事件防重复发放）。真库场景脚本在 pve-pg-proxysplit-paytest 跑过 14 项全过。
- 客户端接着付（2026-11-18 审计）：付款状态只在内存里，没付完的订单由 `frontend/src/state/payment-resume.ts` 的 `findResumable` 从 /v1/me/orders 认出来（启动时和打开会员页都会读订单）——剩下的几笔都没过期就直接出码，有过期的按同一套餐重新下单走上面的续付。入口是套餐区的「继续支付」提示；已经付过一部分时主界面顶部也出横幅。二维码生成失败显示原因 +「重新生成二维码」。拆单按订单的 groupId 认组（`license.Order.GroupID`）；服务端没给组号时才按「套餐名 + 总笔数」认。

## 免费档 / 手机号 / 配置同步（客户端，2026-10-29，docs/plan-2026-10-29-free-sync-phone.md）
- license.Status 增 member / freeDevices / planDevices / phoneBound；tier=free 照常签租约、全部功能可用；租约 409 DEVICE_LIMIT → PendingDevice（只有这时出整页闸门）。APIError 带服务端 code。
- 手机号：internal/license/phone.go（发码 / 手机注册 / 短信找回 / 补绑 / RefreshProfile 读 /v1/me）；老账号 phoneBound=false 每次登录后弹绑定框，「下次再说」只关本次。
- 配置包：internal/configsync（schema 1，sections nodes / subscriptions / rules / proxyPorts / settings）；不含 POWER云 官方线路与 powervpn://profile 订阅、apiToken、sysProxyLast、测速值。恢复可勾选部分，先备份到 %APPDATA%/proxysplit/config-before-import.json（撤销一次）；引用不存在的节点回落默认。
- 云同步：configsync.Syncer，状态存 configsync.json（lastVersion / lastHash）；启动 8 秒后对账、每 10 秒查改动（连续两次同一哈希才上传 = 防抖）、5 分钟查云端；从没同步过的电脑遇到云端已有内容也算冲突，弹「用云端 / 用本机」。哈希不含订阅节点列表和测速，订阅刷新不触发上传。退出账号清同步记录。
- 云端配置：列表 / 另存 / 覆盖 / 改名 / 删除 / 恢复密码（POST /:id/restore）/ 分享码；分享导入任何档位。界面在设置「配置与同步」；侧栏「会员」/「我的权益」。
