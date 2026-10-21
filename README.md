<div align="center">

# ProxySplit — Windows 应用流量管理

**基于 sing-box TUN 与 `process_name` 规则的可视化应用分流客户端。**

为不同应用设置规则、直连、拦截或指定线路；所有匹配与路由由 sing-box
在本机完成，节点、订阅和应用规则优先保存在本机。

[![下载](https://img.shields.io/badge/⬇_下载_v1.9.52-2563eb?style=for-the-badge)](https://proxysplit.zygskins.cn/download/proxysplit-v1.9.52.exe)
&nbsp;
![平台](https://img.shields.io/badge/Windows_10/11-x64-334155?style=for-the-badge)
![内核](https://img.shields.io/badge/core-sing--box-16a34a?style=for-the-badge)

**[官方网站](https://proxysplit.zygskins.cn)** ·
**[商业管理端](https://proxysplit.zygskins.cn/admin/)**

</div>

---

## 重要声明

ProxySplit **不提供任何翻墙、VPN、代理节点、订阅或网络线路服务**。

本软件仅供网络技术学习、应用流量管理与合法的软件调试使用。用户必须
严格遵守中华人民共和国法律法规，不得将本软件用于任何违法违规活动。

---

## 核心功能

| 功能 | 说明 |
|---|---|
| 应用级分流 | sing-box TUN 捕获系统流量，通过 `process_name` 为每个 EXE 匹配规则。 |
| 多应用多线路 | 每条应用规则可使用活动节点、指定节点、自定义线路、直连或拦截。 |
| 规则 / 全局 / 直连 | 通过 sing-box Clash API 实时切换，不需要重启整个客户端。 |
| 规则库 | 支持 geosite/geoip、自定义域名/IP 规则、启停和更新。 |
| 订阅与节点 | 支持 VLESS、VMess、Trojan、Shadowsocks、SOCKS、HTTP、Hysteria2、TUIC、AnyTLS 等。 |
| 状态与诊断 | 展示核心状态、应用链路、活动连接、节点延迟、运行日志和线路健康。 |
| 本地持久化 | 原子写入、自动备份、损坏恢复；升级不会覆盖用户节点和规则。 |
| 安全自动更新 | 自动检查版本，只有 Ed25519 发布签名、SHA256 与 TLS SPKI 全部验证通过才允许升级。 |
| 商业授权 | 短期访问令牌、refresh 轮换、Ed25519 离线授权租约和设备数量控制。 |

---

## 下载与使用

前往 **[ProxySplit 官网](https://proxysplit.zygskins.cn)** 下载
`proxysplit-v1.9.52.exe`。这是便携式单文件版本：

1. 在「节点」页添加你有权使用的合法网络配置。
2. 在「应用分流」页选择应用并分配规则或线路。
3. 点击顶部「启动」，在概览页检查分流链路和运行状态。

Windows 上的 TUN 网卡和系统路由需要管理员权限，因此首次启动会出现
UAC 请求。正式版启动后会自动检查签名更新，用户确认后自动替换并重启。

---

## 当前工作原理

```text
应用流量
   │
   ▼
sing-box TUN 入站（Windows 虚拟网卡）
   │
   ├─ process_name 命中应用规则
   │    ├─ 规则线路：地区规则 / 自定义域名与 IP 规则
   │    ├─ 全局线路：指定节点
   │    ├─ 直连：direct outbound
   │    └─ 拦截：reject action
   │
   └─ 未列出的应用：按白名单 / 黑名单模式进入 direct 或默认节点
```

应用分流当前由 **sing-box 原生 TUN + `process_name` 路由规则**完成，
不再使用 WinDivert 抓包重定向。不同应用指定不同节点时，配置会生成多个
sing-box outbound，并按进程名分别路由。

---

## 数据与安全边界

- 用户配置：`%APPDATA%\proxysplit\config.json`
- 自动备份：`config.json.bak` 与 exe 同目录 `proxysplit-data.json`
- 内核运行文件：`%APPDATA%\proxysplit\bin`
- 内核自动跟随：启动 30 秒后、之后每小时、以及 POWER云 登录后，向面板查一次标准内核（`GET /api/client/core`，签名 + SHA256 校验）；有更新版本就下载替换，代理正在运行时自动重启内核生效（约 1 秒），新内核起不来自动换回旧内核并恢复运行（该版本 24 小时内不再自动装）。设置页「自动更新内核」可关；手动「更新内核」按钮走同一流程。实现见 `internal/service/corefollow.go`、`internal/coreupdate/backup.go`
- 内核多源下载：面板在 `GET /api/client/core` 的 `urls` 里给镜像（镜像在前、源站最后；`url` 仍是源站）。下载时先并发探测每个镜像（`Range: bytes=0-262143`，6 秒超时）按速度排序，再向同一个临时文件续传（`Range: bytes=<已下载>-`，换镜像续传；返回 200 就重头来），低于 30 KB/s 持续 20 秒换下一个，每个来源下完都校验 SHA256（不符删临时文件换下一个）；源站永远最后（先直连、再走当前节点）。`urls` 为空或面板不给时与原来完全一样。实现见 `internal/coreupdate/mirror.go`，设计见 powervpn 仓 `docs/platform/下载镜像加速.md`
- 商业授权票据：使用 Windows DPAPI 加密后保存在本机
- 节点、订阅、应用路径与规则默认不上传商业服务
- 更新服务只发布 HTTPS 地址、版本号、SHA256 与独立 Ed25519 签名

## 会员、试用与支付

- 普通用户注册后按后台配置领取一次硬件绑定试用，当前默认 3 天。
- 普通会员月卡 ¥15.90，最多 3 台设备；超级会员月卡 ¥25.90，最多
  8 台设备。季卡按月卡总价优惠 10%，年卡优惠 25%。
- 当前另有两个月限时永久买断活动；客户端当前只展示支付宝支付。
- 普通会员、超级会员及月卡、季卡、年卡、永久套餐都由服务端配置；价格、
  活动时间、购买次数、设备数和功能权限不会由客户端自行决定。
- 客户端启动服务前必须取得服务端签发的 Ed25519 短租约。租约绑定账号、
  设备、硬件指纹、套餐能力与会员到期时间，运行中也会周期复查。
- 同一账号的设备上限按套餐控制；用户和管理员都可解绑，解绑会撤销该设备会话。
- 支付订单金额始终取服务端套餐快照，支付回调必须通过 HMAC、时间窗、金额、
  渠道和幂等校验后，才会在同一数据库事务中发放或续期会员。
- 支付密钥只通过生产环境 secret 注入，后台仅保存凭据引用；运营人员可切换
  支付渠道而不重新发布桌面客户端。

> 客户端完全运行在用户电脑上，理论上无法做到“绝对不可修改”。ProxySplit
> 通过服务端订单与权益真源、签名短租约、设备绑定、启动守卫和运行中停服提高
> 绕过成本；若未来节点或稀缺资源由服务端托管，还应在资源入口再次校验权益。

---

## 从源码构建

前置依赖：Go 1.26.8+、Wails v2.16.0、Node.js。正式版默认不加壳、不混淆。

```powershell
# 获取固定版本官方内核（SHA256 校验）
.\scripts\fetch-core.ps1

# 开发
wails dev

# 普通便携版
.\scripts\build.ps1 -Version 1.9.17

# 商业版示例
.\scripts\build.ps1 -Version 1.9.17 -Commercial `
  -CommercialAPIURL https://proxysplit.example.com `
  -LicensePublicKeyFile .\server\secrets\license-public.pem `
  -ReleasePublicKeyFile .\server\secrets\release-public.pem `
  -ReleaseSigningPrivateKeyFile .\server\secrets\release-private.pem `
  -DownloadBaseURL https://proxysplit.example.com/download `
  -TLSSPKISHA256 '<SPKI-SHA256>'
```

生产输出位于 `output/`，包括带版本号的 EXE、快捷副本
`proxysplit.exe` 和发布清单。

---

## 项目结构

```text
frontend/               桌面界面（React 19 + @ankotti/admin-ui，结构见 docs/architecture.md）
internal/core/          sing-box 配置生成与进程管理
internal/service/       节点、线路、规则、持久化与健康检查
internal/updater/       签名更新检查、下载验证与 Windows 原地升级
internal/license/       商业登录、设备绑定、离线租约与 DPAPI
server/apps/api/        商业 API
server/apps/admin/      商业运营后台
server/apps/site/       官方网站
scripts/                构建、正式签名构建与发布脚本（流程见 docs/RELEASE-PROCESS.md）
```

---

## 支持作者

<div align="center">
<img src="docs/donate.png" alt="微信赞赏码" width="300">
</div>

本软件为私有软件，受版权保护；未经授权禁止反编译、破解或二次分发。

## POWER云 接入（开发者）

与 PowerVPN 面板、平台自编 sing-box 联动的规则（自家节点识别、按设备计数、POWER云 登录、签名公钥、内置内核、三仓联动变更清单与发布顺序）以 PowerVPN 仓 `docs/platform/PowerVPN-客户端接入标准.md` 为准；改 `internal/powervpn`、`internal/coreupdate`、`bin/core-release.json` 或服务端 `/v1/auth/powervpn` 前先读它。面板发布新的标准内核后，已安装的客户端每小时自动跟上（见上文「内核自动跟随」），不必等客户端发版；内嵌内核（`bin/core-release.json`）只决定新装 / 升级客户端时的起点版本。
