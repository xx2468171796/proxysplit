<div align="center">

# ProxySplit — Windows 应用流量管理

**基于 sing-box TUN 与 `process_name` 规则的可视化应用分流客户端。**

为不同应用设置规则、直连、拦截或指定线路；所有匹配与路由由 sing-box
在本机完成，节点、订阅和应用规则优先保存在本机。

[![下载](https://img.shields.io/badge/⬇_下载_v1.8.3-2563eb?style=for-the-badge)](https://proxysplit.zygskins.cn/download/proxysplit-v1.8.3.exe)
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
`proxysplit-v1.8.3.exe`。这是便携式单文件版本：

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
- 商业授权票据：使用 Windows DPAPI 加密后保存在本机
- 节点、订阅、应用路径与规则默认不上传商业服务
- 更新服务只发布 HTTPS 地址、版本号、SHA256 与独立 Ed25519 签名

---

## 从源码构建

前置依赖：Go、Wails v2、Node.js、Garble。

```powershell
# 开发
wails dev

# 普通便携版
.\scripts\build.ps1 -Version 1.8.3

# 商业版示例
.\scripts\build.ps1 -Version 1.8.3 -Commercial `
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
frontend/               Svelte 桌面界面
internal/core/          sing-box 配置生成与进程管理
internal/service/       节点、线路、规则、持久化与健康检查
internal/updater/       签名更新检查、下载验证与 Windows 原地升级
internal/license/       商业登录、设备绑定、离线租约与 DPAPI
server/apps/api/        商业 API
server/apps/admin/      商业运营后台
server/apps/site/       官方网站
scripts/build.ps1       版本化商业构建与发布签名
```

---

## 支持作者

<div align="center">
<img src="docs/donate.png" alt="微信赞赏码" width="300">
</div>

本软件为私有软件，受版权保护；未经授权禁止反编译、破解或二次分发。
