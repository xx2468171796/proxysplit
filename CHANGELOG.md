# 更新日志 / Changelog

版本号以发布构建为准（`scripts/build-commercial.ps1 -Version <x.y.z>`，注入 `main.appVersion`），
每个发布产物的 SHA256 见 `output/proxysplit-v<版本>.manifest.json`。

## v1.9.16

- 重新统一运行时版本、文件名版本、更新清单版本以及 Windows
  `FileVersion/ProductVersion`，解决安装包属性和客户端标题版本不对应的问题。
- 发布清单新增源码 Git 提交号与工作区状态，确保每个正式 EXE 可以准确追溯到对应代码。
- 包含 v1.9.15 的支付主动查单、客户端到账轮询及 sing-box 原生应用分流清理。

## v1.9.15

- 支付到账新增「主动查单兜底 + 客户端自动轮询」，不再仅依赖异步回调：
  - 服务端 `PaymentService.syncOrder()` 向网关 `POST /api/v1/pay/query`（签名与统一收款 5ff 网关一致），命中已支付即经幂等 `fulfillPaidOrder` 落地；
  - `GET /v1/me/orders` 读取待支付订单时顺带对账，老客户端手动刷新即可自愈；
  - 客户端展示付款二维码后每 3 秒自动查一次（后台标签暂停、回前台立即查、到账/过期即停）。

## v1.9.14

- 支付宝扫码二维码、会员权益对比、设置页设备解绑、顶部会员身份与剩余时长。
