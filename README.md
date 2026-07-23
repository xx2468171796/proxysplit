<div align="center">

# ProxySplit — 应用级分流代理

**v2rayN 的完整节点能力 ＋ Proxifier 的应用级分流，合成一个傻瓜化的 Windows 客户端。**

只让你**指定的程序**（VS Code、Claude Code、Codex、下载器……）走代理，其余程序一律直连——
**不用开全局、不用开 TUN、不动系统代理**，装好加节点点启动即可。

[![下载](https://img.shields.io/badge/⬇_下载_v1.8.3-2563eb?style=for-the-badge)](https://proxysplit.zygskins.cn/download/proxysplit-v1.8.3.exe)
&nbsp;
![平台](https://img.shields.io/badge/Windows_10/11-x64-334155?style=for-the-badge)
![内核](https://img.shields.io/badge/core-sing--box-16a34a?style=for-the-badge)

</div>

---

## ✨ 特性

| | |
|---|---|
| 🎯 **应用级分流** | WinDivert 进程级抓包，精确到 `.exe`：同一台机器，A 程序走节点、B 程序直连、C 程序另一个节点，互不影响。 |
| 🧩 **多应用 → 不同节点** | 每条应用规则可单独指定走哪条线路 / 哪个节点，或直连 / 拦截。 |
| 🚀 **傻瓜化开箱即用** | 内置默认配置：加应用 → 加节点 → 启动，三步跑通，全程有引导。 |
| 🔗 **v2rayN 级节点能力** | vless(reality/ws/grpc)、vmess、trojan、shadowsocks、WireGuard、AnyTLS；订阅、多节点切换、二维码分享、延迟测速。 |
| 🌐 **一键模式切换** | 规则 / 全局 / 直连（Clash 模式），系统代理开关，局域网共享（可指定端口 + 认证 + SOCKS5/HTTP/混合）。 |
| 📊 **实时状态** | 精准实时上下行速度（自适应 B/s·KB/s·MB/s）、连接数、运行时长、线路健康检测。 |
| 📋 **分流规则页** | 内置 GitHub 最新国内外分流规则集（geosite/geoip），可视化查看、一键更新、**支持自定义规则**。 |
| 💾 **配置永不丢** | 原子写入 + 自动备份 + 损坏自恢复；节点、应用规则重启 / 关机后依然在。 |
| 🔒 **单文件自包含** | sing-box 内核 + WinDivert 驱动全部 `go:embed` 进 exe，发布就是一个 `.exe`，双击自动 UAC 提权。 |

---

## ⬇ 下载

前往 **[ProxySplit 官网](https://proxysplit.zygskins.cn)** 下载最新的 `proxysplit-v1.8.3.exe`（单文件、自包含）。正式版会自动检查经过 Ed25519 签名与 SHA256 校验的新版本，确认后自动替换并重启，用户节点和规则不会被覆盖。

> 首次运行需**管理员权限**（WinDivert 要加载内核驱动），双击会自动弹出 UAC 请求，允许即可。
> Windows Defender / 杀软可能因“未知发布者 + 网络驱动”提示，属正常，选择“仍要运行 / 允许”。

---

## 🚀 快速上手（三步）

1. **加应用** — 「应用分流」页 →「添加应用」，从运行进程里选，或直接浏览到 `.exe` 文件。
2. **加节点** — 「节点」页 → 粘贴分享链接（`vless://…` / `vmess://…` / 订阅地址），或手动填写。
3. **点启动** — 顶部「启动」。被选中的应用即刻走代理出网，其它程序毫不受影响。

> 想验证是否生效？在「应用分流」页对某个应用点“连通性测试”，或看该应用的实时连接状态与出口 IP。

---

## 🛠 工作原理

```
┌──────────────────────────────────────────────────────────────┐
│  proxysplit.exe（管理员权限）                                    │
│                                                                │
│  UI(Svelte)  ──►  service  ──►  core.Manager  ──►  sing-box.exe │
│                        │              (生成配置/起停)            │
│                        └──►  engine(WinDivert)                  │
│                                                                │
│  被选中的程序发起 TCP ──► WinDivert 抓包 ──► 反查 PID/exe        │
│      命中规则? ──是──► 改写目的地为本地 redirector(127.0.0.1)    │
│                         redirector 通过 SOCKS5 交给 sing-box ──►│
│                                              你的节点服务器 ──► 目标
│      命中规则? ──否──► 原样放回，直连，毫不影响                    │
└──────────────────────────────────────────────────────────────┘
```

分流判定完全在 WinDivert 层完成：内核只负责“进来的都发给节点”，所以 sing-box 配置很简单（多入站，每条应用规则一个入站 → 对应出站节点）。

**重定向（NAT）关键手法** — 匹配到的连接在网络层做地址翻译，把它“掰”回本机 redirector：

- **去程**：`应用:LP → 远端:RP` 改写成 `127.0.0.1:LP → 127.0.0.1:REDIR`（loopback 重注入），redirector 收下后按 SOCKS5 让 sing-box 连回真正的 `远端:RP`。
- **回程**：redirector 的回包改写回 `远端:RP → 应用:LP`，并用去程 SYN 记录的真实网卡 IfIdx 作为入站注入，让应用 socket 正常收到。

conntrack 以“应用本地端口 LP”为键记录 `{原始本地 IP、原始目的 IP:端口、网卡 IfIdx}`。

技术栈：**Go + Wails v2（Svelte 前端）+ sing-box 内核 + WinDivert 抓包**，全程**不用 cgo**（Wails 用纯 Go WebView2，WinDivert 用 `LoadLibrary` 动态加载）。

---

## 📁 目录结构

```
proxysplit/
├─ main.go                     Wails 入口（窗口 / 绑定 / go:embed 前端）
├─ app.go                      Wails 绑定方法（UI 调用的 API）+ 日志事件
├─ notice.go                   版权 / 反逆向声明（编译进二进制）
├─ internal/
│   ├─ nodes/     分享链接解析（vless/vmess/trojan/ss/…）
│   ├─ core/      sing-box 配置生成（多入站 / TUN / clash / 自定义规则）+ 进程管理
│   ├─ proc/      端口→PID→exe 反查；运行进程列表（Win32）
│   ├─ divert/    WinDivert 纯 Go 绑定 + IPv4/TCP 包读写
│   ├─ engine/    抓包 / 匹配 / 重定向主循环 + redirector + SOCKS 转发
│   └─ service/   编排 nodes+core+engine，配置持久化 / 规则集 / 健康检测
├─ scripts/build.ps1           生产构建（含反编译加固）
└─ frontend/                   Svelte 界面
```

配置保存在 `%APPDATA%\proxysplit\`（应用配置 `config.json`，内核配置 `sing-box.json`，各自独立、互不覆盖）。

---

## 🧑‍💻 从源码构建

前置：Go 1.23+、Wails v2、Node.js。**须以管理员运行**（WinDivert 加载驱动）。

```powershell
# 开发（热重载，管理员终端）
wails dev

# 生产构建 → output\proxysplit.exe
powershell -File scripts\build.ps1
```

构建脚本已启用**反编译加固**：`-trimpath -ldflags "-s -w"`（剥离符号表 + DWARF 调试信息 + 源码路径）。
运行期二进制（sing-box / WinDivert）通过 `go:embed` 内嵌，首次运行释放到 `%APPDATA%\proxysplit\bin`，**发布就是单个 exe**（带 `requireAdministrator` 清单，双击自动 UAC 提权）。

---

## ✅ 已验证

- 多协议（vless-reality / vless-ws / vmess / trojan / ss / WireGuard）生成配置均通过 `sing-box check`。
- 端口→PID→exe 反查正确。
- **真实节点端到端跑通**：`aria2c.exe` 命中规则 → 抓包 NAT 到 redirector → 从节点出口 IP 出网，未命中程序（本机直连 IP）不受影响。
- 配置持久化回归测试：内核启动不再覆盖应用配置，重启 / 关机后节点与应用规则均保留。
- 应用可打包、能启动、UI 正常渲染。

---

## ☕ 支持作者

如果这个软件帮到了你，欢迎微信扫码赞赏一杯咖啡 —— **您的支持是我持续开发的最大动力！**

<div align="center">
<img src="docs/donate.png" alt="微信赞赏码" width="300">
</div>

---

## ⚠️ 说明

- WinDivert 会捕获系统全部出站 TCP 再做判定（未命中原样放回），运行期对所有连接有一层极薄的用户态处理。
- 本工具用于让你指定的程序走**你自己的**代理节点，请在合法合规前提下使用。
- 本软件为私有软件，受版权保护；未经授权禁止反编译 / 逆向 / 破解 / 二次分发（详见 `notice.go`）。
