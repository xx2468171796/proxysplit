# 站内通知 / 公告（公司包 tongzhi）

- 2026-10-29 接入 tongzhi-v1.7.0，vendor 在 `server/packages/core/src/vendor/tongzhi`（`node scripts/vendor-company.mjs <yanzheng 仓> tongzhi`，改 tag 后重跑）。后台用 git 依赖拿 React 整块（`tongzhi/react/admin`）。
- 表：`notice` / `notice_delivery` / `notice_receipt`（迁移 0020）。老 `announcements` 已迁进来（id `ann-<uuid>`、`source='migrate'`，摘要 / 版本号 / 老类型放 `meta`），老表只读保留，下一个版本确认无人读后删。
- 接口：用户侧 `/v1/tongzhi/*`（登录后；身份只投影 id + 档位 `free/trial/standard/premium` + 角色），后台 `/v1/admin/tongzhi/*`（管理员会话或 `TZ_AI_TOKEN` + 本机来源，给 tzctl）；老客户端的 `/v1/announcements` 由 `notify.legacyAnnouncements()` 从「全员、已发布、窗口内」的 notice 派生。
- 业务消息只走 `notify.send` / `notify-events.ts`，一律带 idemKey、事务提交后调：
  - 会员到账 `paid:<拆单组 id 或订单号>`（PaymentService 的 onPaid + 后台手动确认）；
  - 会员快到期 `expire:<licenseId>:<到期日>`（到期前 3 天，非永久、非试用、非 AI 套餐，且没有更晚的会员）；
  - 分销佣金：fenxiao 包自带文案，经 `store.notifySink` 发。
- 定时：每 6 小时跑一次到期提醒 + `purge(90 天)`（进程内 setInterval，幂等键保证重跑无害；单实例部署）。
- 审计：后台 / AI 操作记 `admin.notice.<事件>`，业务自动发的不记。
- 客户端：Go 绑定 `TongzhiCall`（`internal/license/tongzhi.go`，子路径 + 方法白名单）转发到 `/v1/tongzhi`；前端 `features/inbox/inbox.tsx` 把 tongzhi 客户端的 fetch 换成这个绑定，标题栏铃铛 + 横幅 / 弹窗 / 提示由包组件渲染。铃铛下拉在标题栏里，`.qd-title:has(.tz-bell.is-open)` 抬层级。
- 迁移来的老公告在生产已改为只进收件箱（置顶老公告迁成横幅会让所有人看到过时内容）；以后迁移类通知默认只进收件箱。
- 生产 env：`TZ_AI_TOKEN`（≥32 位，不配 = 没有 AI 通道）。接会员中心跨站广播在 huiyuan 那期做。
