# 免费档 / 会员设备叠加 / 配置同步 / 手机号注册（2026-10-29 业主需求）

## 业主拍板
1. 免费用户：全部功能可用，同时只能绑 1 台设备；云同步不可用。
2. 会员设备上限 = 免费名额（后台「默认设备数」，改为 1）+ 套餐 max_devices（普通 1+3=4，超级 1+8=9）。管理员不限。
3. 本地「导出配置 / 导入配置」所有人可用；登录后自动云同步只给会员。
4. 云同步数据服务端 AES-256-GCM 加密存（密钥环境变量 CONFIG_SYNC_KEY，32 字节 base64，存堡垒机资产，不入仓库）。
5. 免费用户首次进入弹一次会员介绍；没开会员时侧栏有「会员」页（权益对比、价格、设备数、同步说明、开通按钮）；开通后该页变「我的权益」（套餐、到期、设备 x/y、同步状态），个人信息（账号区）也能看到。
6. 新注册改手机号：手机号 + 短信验证码 + 用户名 + 密码；登录框接受「用户名或手机号」+ 密码；忘记密码用手机号短信重置，每个手机号每天（北京日）只能成功重置 1 次。短信走公司云片（堡垒机资产 #289，IP 白名单 = 深圳 103.109.23.200，即本服务所在机）。

7. （补充）老用户没绑手机号：每次登录后都弹「绑定手机号」，可点「下次再说」跳过，下次登录还弹。
8. （补充）多份云端配置：会员可把当前配置另存为多份命名配置（如「公司电脑」「家里」），随时恢复成任意一份；每份可设分享密码，生成分享码，别人在自己软件里登录后输入分享码 + 密码即可导入（导入方不要求会员，只要已登录）。

### 补充合同（7、8）
- 登录 / /v1/me 响应 user 增 `phoneBound:boolean`；客户端 phoneBound=false 时每次登录成功后弹绑定框（「下次再说」只关本次）。
- 表 config_profiles(id uuid PK, user_id, name text ≤40, ciphertext/iv/tag, size, device_name, share_code text UNIQUE NULL（8 位大写字母数字，去掉易混字符）, share_password_hash text NULL（argon2id，同现有密码哈希）, created_at, updated_at)；每用户最多 20 份。
- `GET /v1/me/config-profiles` → `{items:[{id,name,deviceName,size,updatedAt,shared:boolean,shareCode?}]}`（不含 payload）。
- `POST /v1/me/config-profiles {name, payload}`、`PUT /v1/me/config-profiles/:id {name?, payload?}`、`GET /v1/me/config-profiles/:id`（含 payload）、`DELETE /v1/me/config-profiles/:id` —— 会员专属（403 SYNC_MEMBER_ONLY）。
- `POST /v1/me/config-profiles/:id/share {password}`（4–64 位）→ `{shareCode}`；`DELETE /v1/me/config-profiles/:id/share` 取消分享。会员专属。
- `POST /v1/config-share/import {shareCode, password}`（需登录，任何档位）→ `{name, payload}`；码不存在或密码错同一个 404 SHARE_INVALID；每用户 10 次/10 分钟、每码 20 次/小时失败锁。
- 客户端：「配置与同步」分节加「我的云端配置」列表（另存为、恢复、改名、删除、分享/取消分享、复制分享码）和「导入别人分享的配置」（分享码 + 密码 → 预览 → 确认导入，同样先自动备份）。分享出去的配置一律剔除 POWER云官方线路和账号信息。

9. （再补充，覆盖第 8 条的数量）云端配置份数：免费 0、普通会员 1 份、超级会员 5 份（服务端按 tier 判断，超出 403 PROFILE_QUOTA「当前会员最多保存 N 份配置」）。
10. （再补充）恢复密码：每份配置可设「恢复密码」（可选）。设了密码后，恢复时必须输入，同账号别的设备 / 别人登录这个账号也一样，用于把账号借给别人时保护配置。分享密码和恢复密码可以不同；同一份配置既能设恢复密码，也能另外开分享。
11. 配置包内容（定稿）：节点（含手动添加的、从别人分享链接导入的）、订阅（地址 + 名称 + 更新设置）、分流规则与应用列表、端口代理、软件设置（主题、启动、DNS、模式等）。不含：登录令牌、license.dat、设备指纹、内核缓存、日志、POWER云官方线路与账号。包格式 `{schema:1, app:"proxysplit", exportedAt, device, sections:{nodes,subscriptions,rules,proxyPorts,settings}}`，恢复时可勾选只恢复某几部分。

### 补充合同（9、10）
- config_profiles 加 `restore_password_hash text NULL`；列表项加 `locked:boolean`。
- `GET /v1/me/config-profiles/:id` 若 locked 须带头 `x-restore-password` 或改用 `POST /v1/me/config-profiles/:id/restore {password?}` → `{name,payload}`（推荐后者）；密码错 403 RESTORE_PASSWORD_WRONG，每份 10 次/10 分钟失败锁。
- `PUT /v1/me/config-profiles/:id/restore-password {password|null, currentPassword?}`：改 / 清除恢复密码须先给旧密码。
- 服务端返回 profile 配额：列表响应带 `{quota, used}`。

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

## 12. 管理后台整体重做（业主 2026-10-29）
server/apps/admin 现为手写组件（未用 @ankotti/admin-ui），整体改用 admin-ui 最新 tag（与 frontend 同 9.6.x+），按 admin-backend 技能：先分类卡再设计看板（订阅会员 + 支付对账 + 推广返利 + 客户端运维），各资源页用 PAGE-TEMPLATES 骨架，详情用工作页签，覆盖本次新功能（免费/会员分布、手机号绑定率、云端配置与分享、短信发送量与失败）。功能清单逐页对照验收，交付前 1440 / 390 / 360 / 深色截图自查。在服务端分支合并后开工，避免冲突。
