> **[代码已完成，生产服务端待部署 2026-07-23]** 下面内容保留作复盘记录。
> `/api/v1/pay/query` 已比对深圳机上的统一收款（5ff）网关客户端确认为真实接口，
> 查单/回调共用幂等 `fulfillPaidOrder`；查单兜底 + 客户端自动轮询已实现并提交（`d223503`），
> 桌面端 v1.9.15 已在本机正式打包。深圳生产 API 当前仍是
> `/opt/proxysplit/releases/20260723-194500-851230a`，尚不包含 `syncOrder`，必须部署服务端并对真实订单完成一次渠道查单后才能判定事件闭环。
> 下文 §4 的未提交改动清单/`HEAD=05a4e16` 已过时。

# ProxySplit 新会话交接文档（2026-07-23 21:05）

## 1. 当前最高优先级问题

用户已通过自己的支付宝商户完成真实付款，但 ProxySplit 订单仍为 `pending`，会员权益没有更新。

- ProxySplit 订单号：`PS20260723115254CA606319C5`
- 支付网关订单号：`GW20260723195254689110`
- 套餐：普通会员月卡
- 金额：`¥15.90`（数据库为 `1590` 分）
- ProxySplit 用户 ID：`2e463ea5-bf32-4dda-beaa-b250361f16c3`
- 创建时间：`2026-07-23 19:52:54 +08:00`
- 当前数据库状态：`pending`
- `paid_at`：空
- `payment_events`：没有该订单的任何记录

结论：ProxySplit 没有收到或没有成功处理这笔订单的支付回调。不能在未核验渠道状态前直接伪造已支付；应先向自有支付网关查单，确认 `PAID` 后通过既有幂等发放逻辑补发权益。

## 2. 已确认的支付链路

ProxySplit 创建订单时调用：

```text
POST https://zf.zygskins.cn/api/v1/pay/create
```

ProxySplit 提交给中转支付网关的回调地址：

```text
https://proxysplit.zygskins.cn/v1/payments/zhongzhuan/notify
```

支付网关返回的收钱吧二维码链接中，收钱吧通知地址是：

```text
https://zf.zygskins.cn/api/v1/pay/notify
```

因此完整链路应为：

```text
支付宝/收钱吧
  -> zf.zygskins.cn/api/v1/pay/notify
  -> proxysplit.zygskins.cn/v1/payments/zhongzhuan/notify
  -> 校验签名、金额、订单号
  -> orders.status = paid
  -> 发放会员权益
```

目前 ProxySplit API 最近两小时日志中没有这笔订单的 callback/notify 记录，`payment_events` 也为空，优先排查 `zf.zygskins.cn` 是否收到收钱吧通知、是否保存 ProxySplit 的 `notify_url`、是否成功转发。

## 3. 服务器与生产信息

- 项目目录：`D:\code\vscodedaili\proxysplit`
- 生产站点：`https://proxysplit.zygskins.cn`
- 管理后台：`https://proxysplit.zygskins.cn/admin/`
- 深圳服务器 SSH：`ssh proxysplit-shenzhen`
- 当前生产发布目录：`/opt/proxysplit/releases/20260723-194500-851230a`
- 当前软链接：`/opt/proxysplit/current`
- API 容器：`proxysplit-api-1`
- PostgreSQL 容器：`proxysplit-postgres-1`
- Redis 容器：`proxysplit-redis-1`
- 三个容器当前均 healthy
- 支付凭据文件：`/opt/proxysplit/secrets/payment-zhongzhuan.env`
- 支付凭据只能在服务器使用，不要打印、复制到仓库或交接文档
- `zf.zygskins.cn` 当前解析到 `110.40.185.27`
- `proxysplit.zygskins.cn` 当前解析到 `103.109.23.200`

生产支付适配器使用自有中转支付服务和同一个“收钱吧”商户。这是用户自己的商户收款，不是外部目标。

## 4. 当前工作区状态（重要）

当前分支：

```text
main
HEAD = 05a4e16 docs: record membership checkout UI release
origin/main = 05a4e16
```

当前存在 Claude Code 刚写入、尚未提交的改动，不要覆盖：

```text
 M frontend/src/App.svelte
 M server/apps/api/src/app.ts
 M server/packages/core/src/payments.test.ts
 M server/packages/core/src/payments.ts
 D frontend/dist/gitkeep
?? frontend/pnpm-lock.yaml
?? frontend/pnpm-workspace.yaml
```

其中支付相关改动是“主动查单兜底”：

- `PaymentService.syncOrder(orderNo)`
- `GET /v1/me/orders` 在读取待支付订单时主动调用 `syncOrder`
- 当前猜测的查单接口：`POST /api/v1/pay/query`

这些改动尚未经过真实网关验证，也尚未测试、提交或部署。必须先确认 `zf.zygskins.cn` 实际查单接口、请求签名字段和返回格式，不能直接按猜测部署。

另外，`frontend/pnpm-lock.yaml`、`frontend/pnpm-workspace.yaml` 是否应保留需要结合项目原有 pnpm 工作区结构判断，不要盲目提交。

## 5. 已执行的生产核查

### 容器状态

```text
proxysplit-api-1        healthy
proxysplit-postgres-1   healthy
proxysplit-redis-1      healthy
```

### 数据库订单证据

```sql
select * from orders
where order_no = 'PS20260723115254CA606319C5';
```

关键结果：

```text
status            = pending
amount_cents      = 1590
provider_code     = zhongzhuan-prod
provider_order_no = GW20260723195254689110
paid_at           = NULL
```

### 回调事件证据

```sql
select * from payment_events
where order_no = 'PS20260723115254CA606319C5';
```

结果：`0 rows`

### API 日志

```powershell
ssh proxysplit-shenzhen "docker logs --since 2h proxysplit-api-1 2>&1" |
  Select-String -Pattern 'PS20260723115254CA606319C5|payment|notify|callback|rejected'
```

没有匹配记录。

## 6. 新会话建议执行顺序

### 第一步：保护 Claude Code 的未提交改动

```powershell
cd D:\code\vscodedaili\proxysplit
git status --short
git diff -- server/packages/core/src/payments.ts `
  server/packages/core/src/payments.test.ts `
  server/apps/api/src/app.ts `
  frontend/src/App.svelte
```

不要执行 `reset --hard`、`checkout .` 或清理未跟踪文件。

### 第二步：查自有中转支付服务

需要登录承载 `zf.zygskins.cn` 的服务器，检查：

1. 收钱吧回调是否到达 `/api/v1/pay/notify`
2. 网关数据库中 `GW20260723195254689110` 的状态
3. 网关是否保存外部订单号 `PS20260723115254CA606319C5`
4. 网关是否保存 ProxySplit 的 `notify_url`
5. 转发 ProxySplit 回调时的 HTTP 状态和响应正文
6. 实际查单接口路径、签名参数与响应字段

如果中转服务已有查单 API，优先使用真实 API；如果没有，应在中转服务补一个仅允许 AppID + HMAC 调用的查单接口。

### 第三步：确认支付后补发权益

确认渠道状态确为 `PAID` 后：

- 优先调用 `PaymentService.syncOrder()`；
- 或让中转网关重新投递签名回调；
- 两者最终都必须调用现有 `store.fulfillPaidOrder()`；
- 不要直接只改 `orders.status`，否则会漏掉会员权益发放；
- `fulfillPaidOrder()` 已包含 `payment_events` 幂等去重和订单/权益事务。

补发后核对：

```sql
select status, paid_at, provider_order_no
from orders
where order_no = 'PS20260723115254CA606319C5';

select provider_code, event_id, order_no, verified, result
from payment_events
where order_no = 'PS20260723115254CA606319C5';

select *
from entitlements
where user_id = '2e463ea5-bf32-4dda-beaa-b250361f16c3'
order by created_at desc;
```

预期：

- 订单变为 `paid`
- 产生一条已验证、已发放的 `payment_events`
- 用户新增或续期普通会员 30 天
- 客户端“刷新到账/刷新授权”后显示普通会员与正确剩余时间

### 第四步：修复可靠性

支付可靠性应同时保留两条路径：

1. 异步回调：支付成功后网关主动通知 ProxySplit
2. 主动查单：客户端点击“我已支付/刷新到账”时，ProxySplit 服务端向网关查单

还应增加：

- 待支付订单后台定时对账任务
- 回调投递失败重试与死信记录
- 管理后台订单手动“渠道查单”
- 回调日志包含订单号、渠道订单号、状态码，但不能记录密钥或完整签名
- 查单和回调共用 `fulfillPaidOrder()`，保证幂等

## 7. 相关源码

- 支付适配器：`server/packages/core/src/payments.ts`
- 支付测试：`server/packages/core/src/payments.test.ts`
- API 路由：`server/apps/api/src/app.ts`
- 订单与权益事务：`server/packages/core/src/store.ts`
- 数据库迁移：`server/packages/db/migrations/0002_commerce.sql`
- 客户端会员/支付界面：`frontend/src/App.svelte`

当前回调路由：

```text
POST /v1/payments/zhongzhuan/notify
```

当前回调成功响应：

```json
{"code":0,"message":"success"}
```

需核对中转网关是否要求纯文本 `success`；如果它只把 HTTP 2xx 视为成功，现状可用。不要未经网关规范确认就修改响应格式。

## 8. 测试、发布与交付要求

### 正式客户端一键打包

正式打包所需的公开公钥、TLS 固定值、生产地址和私钥引用均已纳入仓库：

```text
build/release-kit/
scripts/build-commercial.ps1
```

本机发布私钥位于已忽略但实际存在的：

```text
server/secrets/shenzhen-release-private.pem
```

其他本机 AI 不需要再拼接构建参数，直接执行：

```powershell
.\scripts\build-commercial.ps1 -Version 1.9.15 -CheckOnly
.\scripts\build-commercial.ps1 -Version 1.9.15
```

私钥不允许明文推送到远程仓库；包装脚本会自动读取并校验本机私钥。完整说明见
`build/release-kit/README.md`。

修复后至少执行：

```powershell
cd D:\code\vscodedaili\proxysplit\server
pnpm typecheck
pnpm test
pnpm build

cd D:\code\vscodedaili\proxysplit
go test ./...

cd D:\code\vscodedaili\proxysplit\frontend
npm run check
npm run build
```

部署时：

- 新建版本化 release 目录
- 必须包含重新构建的 `server/apps/admin/dist`
- 切换 `/opt/proxysplit/current`
- 重建/重启 API
- 验证 `/health`、`/admin/`、套餐接口、订单查单和真实订单权益
- 更新 `.ankotti/MEMORY.md`
- `git commit`、`git push`
- 调用生态 `report` 汇报阶段结果

## 9. 近期已完成版本

- 最新桌面端：`v1.9.15`
- 产物：`output/proxysplit-v1.9.15.exe`
- 文件大小：`80,924,672` 字节
- SHA256：`e7240a230d4216bd9cbff171c8503d572775d7865c3e9cfbf85e4ba0a5bf6900`
- 发布清单：`output/proxysplit-v1.9.15.manifest.json`
- 构建类型：商业版、Garble 混淆、Ed25519 自动更新签名
- 未做 Windows Authenticode 签名
- 当前支付 UI 支持本地生成支付宝二维码、会员权益对比、设备解绑、顶部会员身份与剩余时间，并在二维码显示期间每 3 秒自动向服务端刷新到账状态

## 10. 新会话可直接使用的开场指令

```text
请先读取：
D:\code\vscodedaili\proxysplit\docs\HANDOFF-2026-07-23-payment-callback.md
以及：
D:\code\vscodedaili\proxysplit\.ankotti\MEMORY.md

继续处理真实支付宝订单 PS20260723115254CA606319C5 已付款但未回调的问题。
先保护 Claude Code 的未提交改动，再核对 zf.zygskins.cn 的实际渠道订单状态和回调转发日志。
确认 PAID 后必须通过 fulfillPaidOrder 幂等补发权益，不要直接只改订单状态。
修复主动查单和异步回调后完成测试、生产部署、提交推送和生态汇报。
全程中文、自主执行，不要泄露支付密钥。
```
