# 免费档 / 会员设备叠加 / 配置同步 / 手机号注册（2026-10-29 业主需求）

## 业主拍板
1. 免费用户：全部功能可用，同时只能绑 1 台设备；云同步不可用。
2. 会员设备上限 = 免费名额（后台「默认设备数」，改为 1）+ 套餐 max_devices（普通 1+3=4，超级 1+8=9）。管理员不限。
3. 本地「导出配置 / 导入配置」所有人可用；登录后自动云同步只给会员。
4. 云同步数据服务端 AES-256-GCM 加密存（密钥环境变量 CONFIG_SYNC_KEY，32 字节 base64，存堡垒机资产，不入仓库）。
5. 免费用户首次进入弹一次会员介绍；没开会员时侧栏有「会员」页（权益对比、价格、设备数、同步说明、开通按钮）；开通后该页变「我的权益」（套餐、到期、设备 x/y、同步状态），个人信息（账号区）也能看到。
6. 新注册改手机号：手机号 + 短信验证码 + 用户名 + 密码；登录框接受「用户名或手机号」+ 密码；忘记密码用手机号短信重置，每个手机号每天（北京日）只能成功重置 1 次。短信走公司云片（堡垒机资产 #289，IP 白名单 = 深圳 103.109.23.200，即本服务所在机）。

## 服务端合同（server/）
### 免费档
- 新迁移 0019：`UPDATE system_settings SET value='1' WHERE key='default_device_limit'`（无行则插入），settingsDefaults.defaultDeviceLimit 改 1；后台设置页标签改「免费设备数（会员在此基础上叠加套餐设备数）」。
- AuthService 统一一个 `effective(user, ent, settings)`：
  - admin：保持现状（不限）。
  - 有会员 ent：返回 ent，maxDevices = settings.defaultDeviceLimit + ent.maxDevices。
  - 无会员：免费权益 `{licenseId:'free', planCode:'free', planName:'免费版', tier:'free', maxDevices:defaultDeviceLimit, features:['free'], expiresAt:2999-12-31, lifetime:true}`。
- completeLogin / activateDevice / lease / /v1/me / license() 全部用 effective；lease 不再因无会员 403，免费也签租约（tier='free'）。DEVICE_LIMIT 409 照旧。
- app.ts:85 那处 `entitlement` 闸门（看清用于什么接口）：若是加速等会员功能保持会员专属则保留，否则改为 effective；在汇报中说明。
- /v1/me 与登录响应 license 增加 `member:boolean`、`freeDevices:number`、`planDevices:number`。

### 配置同步（会员专属）
- 表 config_sync(user_id PK → users, ciphertext bytea, iv bytea, tag bytea, version int, size int, device_name text, updated_at timestamptz)。
- `GET /v1/me/config-sync` → `{exists, version, updatedAt, deviceName, size, payload?}`（payload 为解密后的 JSON 字符串；`?meta=1` 只回元数据）。
- `PUT /v1/me/config-sync {payload:string(≤2MB), baseVersion:number}` → 乐观锁：baseVersion ≠ 当前 version 返回 409 SYNC_CONFLICT（带当前元数据）；成功 version+1。
- `DELETE /v1/me/config-sync`。
- 非会员 403 SYNC_MEMBER_ONLY（「云同步是会员功能」）。限流 30/分钟。

### 手机号
- 迁移 0019 同时：users.phone text UNIQUE NULL（存 E.164 去 +86 的 11 位大陆号），表 sms_codes(phone, purpose 'register'|'reset', code_hash, expires_at, attempts, created_at)，表 password_reset_daily(phone, day date, PRIMARY KEY(phone,day))。
- `POST /v1/auth/sms/send {phone, purpose}`：同号 60 秒 1 条、每号每天 10 条、每 IP 每小时 20 条；register 用途号已注册 → 409 PHONE_TAKEN；reset 用途号未注册时也返回成功（不泄露）但不发；reset 当天已成功重置 → 429 RESET_DAILY_LIMIT。验证码 6 位、5 分钟、最多试 5 次。
- 云片发送：POST https://sms.yunpian.com/v2/sms/tpl_single_send.json（apikey、mobile、tpl_id、tpl_value=urlencode("#code#=123456")），配置 env YUNPIAN_API_KEY / YUNPIAN_TPL_ID（默认 6437354）；未配置时开发模式把码打到日志（NODE_ENV!=='production'），生产未配置 → 503 SMS_UNAVAILABLE。
- `POST /v1/auth/register` 新合同：`{phone, code, username, password, device, ref?}`（email 变可选）；旧客户端发 email 无 phone 的请求：仍接受（兼容已发版客户端），后台不强制。web 注册同理加 phone/code。
- 登录：loginSchema.username 字段接受用户名或 11 位手机号；纯 11 位数字且以 1 开头按手机号查。
- `POST /v1/auth/password/reset {phone, code, password}`：验码 → 写 password_reset_daily（冲突 → 429 RESET_DAILY_LIMIT）→ 改密 + 吊销该用户所有会话，同一事务。
- 已登录用户绑定手机：`POST /v1/me/phone {phone, code}`（purpose 'bind'，同发码规则），老账号据此补绑。
- 后台用户列表/详情显示手机号（中间 4 位打码），可搜手机号。

## 客户端合同（Go + frontend/）
- license.Status 增 `Member bool`、`FreeDevices`、`PlanDevices`；tier=='free' 时 Authenticated 照常 true（免费能用全部功能）；租约 409 DEVICE_LIMIT → PendingDevice=true 显示解绑页。
- MemberGate 只在 deviceLimitReached 时出现；无会员不再拦。
- 导出：App.ExportConfig() → 选保存路径，写 `proxysplit-config-YYYYMMDD.json`（含 schema 版本、节点、订阅、规则、设置；不含 license.dat、登录令牌、设备指纹、内核缓存）。导入：App.ImportConfig() → 选文件 → 预览（节点数/规则数）→ 确认后覆盖并自动备份当前配置（可撤销一次）。POWER云官方线路（Node.Official）不导出。
- 云同步：会员登录后默认开（设置里可关）；启动时 GET 元数据，云端较新（version > 本地记录的 lastSyncedVersion 且本地自上次同步无改动）→ 自动拉取应用；本地有改动 → 防抖 10 秒上传；冲突 → 弹窗「用云端 / 用本机」。设置页「配置与同步」分节：导出、导入、立即同步、上次同步时间。
- 会员页：侧栏「会员」（非会员）/「我的权益」（会员）；免费用户首次登录后弹一次会员介绍（本地标记 member-intro-seen）。
- 登录页：注册改手机号 + 发送验证码 + 用户名 + 密码；登录框提示「用户名或手机号」；「忘记密码」走手机号短信，提示「每天只能找回一次」；账号区可补绑手机号。
