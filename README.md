# ProxySplit — 应用分流代理

一个 Windows 客户端，把 **v2rayN 的节点管理** 和 **Proxifier 的应用级分流** 合成一个软件：

- 自带代理内核（打包 **sing-box**），能加节点 / 贴分享链接，不依赖外部 V2RayN。
- 用 **WinDivert** 做**进程级分流**：只让你指定的程序（如 VS Code、Codex、Claude Code）走代理，其它程序一律直连。
- **不需要开全局 / TUN 模式**，所以不影响系统里其它服务。

技术栈：**Go + Wails（Svelte 前端）+ sing-box 内核 + WinDivert 抓包**。全程 **不用 cgo**（Wails Windows 用纯 Go WebView2，WinDivert 用 `LoadLibrary` 动态加载）。

---

## 工作原理

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

分流的判定完全在 WinDivert 层：内核只负责「进来的都发给节点」，所以 sing-box 配置很简单（`route.final = proxy`）。

### 重定向（NAT）的关键手法

匹配到的连接，在网络层做地址翻译，把它「掰」回本机的 redirector：

- **去程**：`应用:LP → 远端:RP` 改写成 `127.0.0.1:LP → 127.0.0.1:REDIR`（作为 loopback 重新注入），redirector 收下后按 SOCKS5 让 sing-box 连回真正的 `远端:RP`。
- **回程**：redirector 的回包 `127.0.0.1:REDIR → 127.0.0.1:LP` 改写回 `远端:RP → 应用:LP`，并用**去程 SYN 记录下来的真实网卡 IfIdx** 作为入站注入，让应用的 socket 正常收到。

conntrack 以「应用本地端口 LP」为键记录 `{原始本地 IP、原始目的 IP:端口、网卡 IfIdx}`。

---

## 目录结构

```
proxysplit/
├─ main.go                     Wails 入口（窗口/绑定）
├─ app.go                      Wails 绑定方法（UI 调用的 API）+ 日志事件
├─ bin/                        运行期二进制（开发时用）
│   ├─ sing-box.exe            内核
│   ├─ WinDivert.dll           抓包库
│   └─ WinDivert64.sys         抓包驱动
├─ internal/
│   ├─ nodes/     分享链接解析（vless/vmess/trojan/ss）
│   ├─ core/      sing-box 配置生成 + 进程管理
│   ├─ proc/      端口→PID→exe 反查；运行进程列表（Win32）
│   ├─ divert/    WinDivert 纯 Go 绑定 + IPv4/TCP 包读写
│   ├─ engine/    抓包/匹配/重定向主循环 + redirector + SOCKS 转发
│   └─ service/   编排 nodes+core+engine，配置持久化
├─ cmd/divtest/   WinDivert 重定向的独立验证程序（开发用）
└─ frontend/      Svelte 界面
```

配置与生成的内核配置保存在 `%APPDATA%\proxysplit\`。

---

## 开发与构建

前置：Go 1.23+、Wails v2、Node.js（本机均已装好）。**必须以管理员运行**（WinDivert 要加载驱动）。

```powershell
# 开发（热重载，从管理员终端运行，用根目录的 bin/）
wails dev

# 生产构建 → 输出散文件到 output\
powershell -File scripts\build.ps1
# 产物：output\proxysplit.exe（单文件，54MB）+ output\README.txt
```

`sing-box.exe / WinDivert.dll / WinDivert64.sys` 通过 `go:embed` 内嵌进 exe（见 [app.go](../app.go) 的 `ensurePayload`），首次运行自动释放到 `%APPDATA%\proxysplit\bin`，所以**发布就是单个 exe**。它带 `requireAdministrator` 清单，双击会自动请求 UAC 提权。

---

## 已验证 / 待办

**已经过实测**
- 五种协议（vless-reality / vless-ws / vmess / trojan / ss）生成的配置都能通过 `sing-box check`。
- 端口→PID→exe 反查正确。
- **WinDivert 重定向端到端跑通**：`curl.exe` 被规则命中 → 连接被抓取 NAT 到 redirector → 拿到预期响应，未命中程序不受影响（见 `cmd/divtest`）。
- 应用可打包、能启动、UI 正常渲染、配置目录正确生成。

**待办（阶段 2/3）**
- 用**真实节点**跑一次全链路（贴分享链接 → 启动 → 让某程序走代理出网）。
- 订阅、多节点切换、延迟测速。
- **远程 DNS**（目前应用本地解析后再走代理，可能污染/泄漏）与 **fake-ip**。
- 私网 IP 直连（命中的应用访问局域网时不走代理）。
- **QUIC/UDP**：目前只处理 TCP；建议先挡 QUIC 迫使回落 TCP，再做 SOCKS5 UDP。
- 系统托盘、开机自启、流量统计图。

---

## 说明
- WinDivert 会捕获系统全部出站 TCP 再做判定（未命中的原样放回），运行期对所有连接有一层极薄的用户态处理；后续可用 SOCKET 层预筛来收窄范围。
- 本工具用于让指定程序走你自己的代理节点，请在合法合规前提下使用。
