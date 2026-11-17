# 多级分销（推广赚钱）

> 公司分销包 **fenxiao**（yanzheng 仓 packages/fenxiao，v1.9.94 起 fenxiao-v0.1.0，取代 tuiguang/fenxiao），接入手册在包里 INTEGRATION.md。服务端 vendor 在 `server/packages/core/src/vendor/fenxiao/`（含 http/ 子目录），升级改 `server/scripts/vendor-company.mjs（包名 fenxiao）` 的 UPSTREAM_TAG 重跑。

## 模型
- 用户带邀请码注册（客户端注册表单「邀请码」、官网 `?ref=` 记 30 天并预填）→ 建号事务里绑上级（一生一次，后台可改挂，整支下级跟着改）。
- 付款发货（grantWithinTx source=order，回调 / 拆单付齐）同事务按上级链分佣：来源 = 拆单组 id 或订单 id，基数 = 经网关实付的分（后台手动确认的单不算，业主 2026-10-24 定），productKey = 套餐 id；放在保存点里，分佣出错只记日志不挡发货。
- 佣金先冻结 freezeDays → API 每 5 分钟 releaseDue 转可提现；退款（refundOrder）同事务冲回，已提现的变欠款（可提现为负）。结算 / 退款按来源在 fx_sources 排队。
- 大额（holdAboveCents）佣金先「待复核」：后台「佣金流水 → 待复核」放行（进冻结 / 可提现）或作废（必须写原因）；推广人只看到「审核中」。
- 提现：客户端申请（按规则扣手续费）→ 后台「提现审核」按**实转金额**人工转账后点「已打款」，驳回退回余额。系统不自动打款。
- 后台「佣金流水 → 调账」：按用户名补发 / 扣减（必须写原因，推广人能看到），包内 fx_audit 记操作人。
- **欠款时不能打款（2026-11-18 第二轮审计）**：提现申请之后发生退款冲回、申请人可提现余额变负时，后台「已打款」被拒（409 `FX_BENEFICIARY_IN_DEBT`，提示欠多少）；做法是驳回（金额退回余额先抵欠款），结清后让他重新申请。检查在 `FenxiaoService.review` 里、与记账同一事务并锁住提现单和账户行（不改 vendor）。提现列表每行带 `debtCents`，后台显示「欠款」列并禁用「已打款」。
- **动钱操作的审计同事务**：调账、佣金复核、提现申请、提现审核经 `FenxiaoService.money()`（`audit.ts withAuditedTx`）——包的记账（传 tx）与本站 audit_logs 一起提交，审计写不进去整体回滚；包的通知经 afterCommit 提交后才发。用户兑换码（`store.redeemCode`）的审计行也在发放事务里。路由不再事后补写。

## 规则
- 存 system_settings.fenxiao_policy（zod fenxiaoPolicySchema；读坏 / 缺省 = 关；v1.9.94 的新字段都有默认值，老配置照样读）。后台「分销 → 分佣规则」改。
- 身份（tiers）逐级比例；算法 level / differential；totalCapBps 合计上限；openToAll 人人可推广；**maxLevels 最多 3**（合规）。
- 新字段：planRules（按套餐不返 / 倍率）、recurringMaxOrders / recurringWithinDays（复购限制）、holdAboveCents、withdrawalFeeBps / withdrawalFeeFixedCents。
- 申请当推广员：包支持，ProxySplit 没开（application 固定 off，客户端没入口）。
- 其他后台页也接了分销（v1.9.93）：概览分销摘要；「用户与会员」推荐 / 分销列、筛选、菜单跳分销页、档案分销栏；「订单」佣金（拆单显示整单佣金）、退款弹窗提示。

## 坑
- 事务里不要另借连接：getPolicy(db) 收到的是当前 tx。
- 推广人看到的下级 / 买家用户名服务端打码（maskName）。
- 真库场景：`apps/api/scripts/fenxiao-scenario.mts`（14 项，只对空测试库跑；本机用 PGlite + pglite-socket 起临时库，要加载 pgcrypto 扩展，迁移才跑得过）。
- 客户端（frontend）还没显示「审核中」和手续费（admin-ui 已于 2026-10-27 升到 9.6.1，可以直接做）。
- 手动确认订单网关单号原来写死 'MANUAL'，撞 orders_provider_order_uq；v1.9.93 改成 'MANUAL-<单号>'。
