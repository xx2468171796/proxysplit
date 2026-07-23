# ProxySplit 项目状态

- 当前正式桌面版本：`v1.9.0`。产物为 `output/proxysplit-v1.9.0.exe`，快捷副本为 `output/proxysplit.exe`；发布清单为 `output/proxysplit-v1.9.0.manifest.json`。
- v1.9.0 EXE 大小 `79,994,880` 字节，SHA256 为 `5e230c44365e14845db3340cd9a85e1b45725986e0f0ed8b8fcccf5fc19cfefb`；已用独立 Ed25519 发布密钥签名并通过 Garble 混淆构建，暂未做 Windows Authenticode 签名。
- 桌面端节点、订阅、应用规则继续持久化到 `%APPDATA%/proxysplit/config.json`，保留原子写入、`.bak` 和便携数据迁移；升级不会覆盖节点或规则。
- 应用分流使用 sing-box 原生 TUN + `process_name` 路由，不使用 WinDivert 抓包重定向。支持 HTTP、HTTPS、SOCKS5、VLESS、VMess、Trojan、Shadowsocks、Hysteria2、TUIC、AnyTLS 的常用分享链接和 sing-box 配置变体。
- v1.9.0 新增桌面注册/登录、三天试用、会员中心、套餐购买、订单状态、设备列表与解绑、公告、版本日志；未付费但已登录的用户可进入会员中心开通。
- 商业权益真源在服务端。普通会员/超级会员、月卡/季卡/年卡/永久套餐、价格、原价、活动时间、购买次数、设备上限和功能列表均由运营后台配置。
- 新账号默认免费试用 3 天，后台可调整；同一硬件只允许领取一次。硬件指纹组合 MachineGuid、主板/BIOS/系统 UUID 后哈希上传，不上传原始序列号。
- 授权租约采用 Ed25519 签名，当前默认 60 分钟，离线宽限 6 小时且不超过会员硬到期时间；租约绑定账号、设备 ID、硬件指纹、套餐、功能和到期时间。所有 `Service.Start` 路径统一经过权益守卫，运行中每 5 分钟复查，失效即停服。
- 支付适配器已按 5ff 生产链路接入 `https://zf.zygskins.cn`，当前收款仍进入同一“收钱吧”商户。生产凭据仅在深圳机 `/opt/proxysplit/secrets/payment-zhongzhuan.env`（0600）中保存，后台数据库只存 `PAYMENT_ZHONGZHUAN` 引用，可切换支付渠道。
- 支付创建金额只取服务端套餐快照；回调校验 HMAC-SHA256、AppID、时间窗、订单号、渠道、金额和事件幂等，会员发放与订单置为已支付在同一事务完成。没有执行真实扣款测试。
- 数据库迁移 `0002_commerce.sql` 已在生产应用，新增套餐、设置、支付渠道、订单、支付事件、试用硬件领取、公告和扩展版本日志。生产默认 `trial_days=3`、`default_device_limit=3`，`zhongzhuan-prod` 已启用。
- 预置了普通/超级会员的月卡、季卡、年卡、永久套餐模板，但付费套餐保持禁用且不公开，避免在未确认正式价格前产生真实订单；可在后台填写价格和活动时间后启用。
- 深圳生产站点：`https://proxysplit.zygskins.cn`；管理端：`/admin/`；健康检查：`/health`；v1.9.0 下载：`/download/proxysplit-v1.9.0.exe`。v1.9.0 发布日志与置顶公告已登记。
- 当前部署目录：`/opt/proxysplit/releases/20260723-151154-2e0e348`，`/opt/proxysplit/current` 已指向该目录。升级前数据库备份：`/opt/proxysplit/backups/proxysplit-pre-v1.9.0-20260723-151154.dump`。
- API、PostgreSQL、Redis 均为 healthy；公网 `/health`、官网、后台静态资源、v1.9.0 下载、最新版本接口、支付配置引用和非法回调拒绝均已验证。
- 验证结果：`go test ./...` 全通过；桌面 `npm run check` 为 0 errors / 0 warnings / 0 hints 且 `npm run build` 通过；服务端 `pnpm typecheck`、`pnpm test`（6 项测试）、`pnpm build` 全通过。
- 生产管理员为 `admin`，密码收据只保存在 `C:/Users/Administrator/.config/proxysplit/shenzhen-admin.txt`。SSH 别名为 `proxysplit-shenzhen`。
- 后续待办：由运营方确认各付费套餐正式价格后在后台启用；支付提供方后续可给 ProxySplit 单独创建 AppID 并映射到同一商户；补充 Windows Authenticode 证书。
