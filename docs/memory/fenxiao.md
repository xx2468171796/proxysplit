# 多级分销（推广赚钱）

> 公司 SDK tuiguang/fenxiao（yanzheng 仓 packages/tuiguang，1.8.1 起），接入手册 INTEGRATION §10。服务端 vendor 在 `server/packages/core/src/vendor/fenxiao/`，升级改 `server/scripts/vendor-fenxiao.mjs` 的 UPSTREAM_TAG 重跑。

## 模型
- 用户带邀请码注册（客户端注册表单「邀请码」、官网 `?ref=` 记 30 天并预填）→ 建号事务里绑上级（一生一次，后台可改挂，整支下级跟着改）。
- 付款发货（grantWithinTx source=order，回调 / 手动确认 / 拆单付齐都走这里）同事务按上级链分佣：来源 = 拆单组 id 或订单 id，基数 = 实付分；放在保存点里，分佣出错只记日志不挡发货。
- 佣金先冻结 freezeDays → API 每 5 分钟 releaseDue 转可提现；退款（refundOrder）同事务冲回，已提现的变欠款（可提现为负）。
- 提现：客户端申请 → 后台「分销 → 提现审核」人工转账后点「已打款」，驳回退回余额。系统不自动打款。

## 规则
- 存 system_settings.fenxiao_policy（zod fenxiaoPolicySchema；读坏 / 缺省 = 关）。后台「分销 → 分佣规则」改。
- 身份（tiers）：分销商 / 经销商…每档逐级比例；算法 level（逐级）或 differential（级差）；totalCapBps 一笔合计上限；openToAll 人人可推广。
- 后台「分销商与团队」按用户名设身份 / 单独比例 / 自定义码 / 停用 / 改上级。

## 坑
- 事务里不要另借连接：fenxiao 的 getPolicy(db) 收到的是当前 tx（1.8.0 用池子读，PGlite 场景测出互等，1.8.1 修）。
- 推广人看到的下级 / 买家用户名服务端打码（maskName）。
- 真库场景：`apps/api/scripts/fenxiao-scenario.mts`（9 项，只对空测试库跑；本机可用 PGlite socket 起临时库）。
