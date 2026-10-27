# ProxySplit 架构

## 规模与技术栈

- **规模：small（小工具）**。Windows 单机桌面客户端，单用户，没有多租户 / 权限分级；Go 后端（Wails 2）+ 内嵌网页界面 + sing-box 内核。商业后台（`server/`）是另一套系统，不在本文范围。
- 后端：Go 1.26 + Wails 2.16，sing-box TUN + `process_name` 分流（详见 `docs/线路设计.md`）。
- 界面（2026-10-22 起）：React 19.3 + Vite 8.3 + TypeScript 7 + 公司组件库 `@ankotti/admin-ui`（钉 tag，见 `frontend/package.json`），pnpm 安装。替换了原来的 Svelte 3 单文件界面（3735 行 `App.svelte`）。

## 界面模块与数据归属

```
frontend/src/
  api/        backend.ts  唯一调用 Go（Wails 绑定）的地方：null → 空数组、写操作返回错误文本（空串 = 成功）
              types.ts    界面领域类型（与 Go JSON 一一对应）
  state/      外部 store（shared/store.ts，useSyncExternalStore），每块数据只有一个主人：
              data.ts       节点 / 应用规则 / 线路 / 订阅 / 设置 / 分流模式 / 代理策略（持久化数据）
              runtime.ts    运行状态、速率、分流健康、实时连接、日志（每秒轮询，不落盘）
              account.ts    登录状态、套餐 / 设备 / 订单 / 公告；account-sso.ts 管会动订阅的登录 / 退出
              payment.ts    下单、二维码、3 秒查单、拆单顺序支付
              app-rules.ts  应用规则增删改、进程列表、程序图标、逐应用测连通、规则导入导出
              routing.ts    规则库、自定义规则、自定义线路
              nodes.ts subs.ts system.ts update.ts  节点测速 / 订阅 / 系统项与 Claude 加速 / 软件更新
  app/        app.tsx（Provider + 闸门：强制升级 → 登录 / 会员 → 主界面）、外壳 main-shell.tsx（qiantai/desktop 的 DesktopShell）、theme.ts（主色 / 明暗 / 外观默认）、生命周期（首屏快照、事件、定时器）
  features/   一个页面一个目录：overview nodes apps rules subs logs settings account；页面只读 store、调动作
  shared/     纯函数（format.ts，有单测）、store
  dev/        浏览器预览用的假后端 + 预览参数（`vite dev` 或 `VITE_MOCK=1` 评审包才装，正式包不含）
```

依赖方向：`features → state → api → wailsjs`；`shared` 被所有层用、不依赖别人。页面之间不互相 import。

## 关键规则（不变量）

- 节点和应用规则是不可替代的用户数据：重载时两者都读成功才替换屏幕；其余数据单项失败保留旧值（`state/data.ts reloadData`）。
- Go 的 nil 切片是 `null`：只在 `api/backend.ts` 兜成空数组，界面层不再判空。
- 首屏只用一个 RPC（`GetBootstrapState`，Go 端等服务就绪）；Go 的 OnDomReady 还会把同一快照写进 `window.__PROXYSPLIT_BOOTSTRAP__` 并发 `proxysplit:bootstrap` 事件。
- 运行状态每秒一轮询；Claude 加速 3 秒；付款查单 3 秒（后台标签页暂停）；套餐 1 分钟；更新检查 6 小时。
- 强制升级覆盖一切界面（含登录 / 会员闸门），不可关闭。
- 中转站渠道（`license.channel === "aigw"`）的客户不显示作者联系方式、赞赏码、官网 / GitHub。
- 金额以「分」存，展示时只做一次除法。

## Xray 双内核（internal/xray）

- sing-box 仍负责 TUN、逐应用分流、规则、DNS；只有 sing-box 跑不了的节点（`Node.NeedsXray()`：XHTTP/splithttp、mKCP、VLESS encryption≠none）交给 Xray 旁路内核。
- 一个 sing-box 实例配一个 Xray 进程（主内核 / 每个端口代理 / 每次测速探针各一个），每个这类节点一个 127.0.0.1 SOCKS 入站（免认证、开 UDP），按 inboundTag 路由到它的出站；sing-box 里该节点的出站变成同 tag 的 `socks → 127.0.0.1:<端口>`（`core/xray.go viaSidecar`）。其它节点生成的配置逐字节不变。
- 顺序：先起 Xray（等全部入站端口监听）再起 sing-box，先停 sing-box 再停 Xray；启动时按配置路径清残留。TUN 配置里 xray.exe 的 `process_path` 直连，防止回环。
- 主节点需要 Xray 而起不来 → 中文报错「该节点需要 Xray 内核…」；分应用线路 / 额外节点起不来只让这条线路连不上（指向死端口），不影响其它节点。
- 内核分发见 docs/memory/core-update.md「Xray 双内核」。

## 页面与模板（admin-ui PAGE-TEMPLATES）

| 页面 | 模板 | 说明 |
|---|---|---|
| 概览 | 用户向首页（2026-10-22 改） | 连接面板（大开关 / 节点 / 速率 / 分流方式白话）+ AI 环境检测 + 常用操作 + 节点健康 + 应用分流摘要 + 最新日志 |
| 节点 | T02 资源列表 | 导入（链接 / 手动）弹框，表格行内测 TCP / Google / 速度、设为活动、二维码、删除 |
| 应用分流 | T03 指标 + 列表 | 分流模式、未列出应用的去向、规则表（方式 / 节点 / 启用 / 测试 / 目标条件 / 删除） |
| 分流规则 | T05 分区合并 | 规则库 / 自定义规则 / 线路 三个分区 |
| 订阅 | T02 资源列表 | 添加 / 编辑弹框，行内更新、自动更新开关、删除 |
| 日志 | T05 分区合并 | 实时连接诊断 / 运行日志 |
| 设置 | T08 设置页 | 账户与设备、AI 控制、Claude 加速、内核与诊断、分流引擎、系统集成 |
| 登录 / 注册 | AuthLayout | POWER云 / AI 编程官网授权登录、免登录下载自动登录 |
| 会员中心 | 弹框 / 整页闸门 | 套餐、兑换码、设备解绑、支付宝扫码、拆单支付 |

## 安全基线（原 SECURITY-HARDENING.md）
- 信任边界：用户名、密码哈希、套餐、到期、设备数、封禁和版本下限只由服务端决定；客户端只存短期 access/refresh token 和 Ed25519 签名租约（DPAPI 加密），只嵌入授权验签公钥、API 地址和 TLS SPKI 摘要，不嵌数据库口令、JWT 密钥或签名私钥；节点、订阅、应用规则和代理密码只存本机。
- 已实施：Argon2id（64 MiB、3 轮）；15 分钟 access token，refresh 单次轮换、重放吊销整个 family；设备指纹 SHA256 + 事务 advisory lock 防超设备数；租约 24 小时在线、最多 72 小时离线宽限，带设备 / 套餐 / 功能 / 到期 / 最低版本；商业构建启动和启动代理前都验租约；生产 API 只走 HTTPS 并固定 SPKI；`-trimpath -s -w` + SHA256 清单 + Ed25519 更新签名（默认不混淆、不加壳）；管理 API 服务端校验角色并写审计日志。
- 现实边界：客户端无法做到不可反编译，到期、封禁、设备数和权益必须始终由服务端控制；签名私钥泄漏时立即轮换，并发布内置新公钥的强制升级版本。

## 验收（功能对照表）

旧界面的每个功能都要在新界面找得到、行为一致：

- 外壳：活动节点切换、代理策略（规则 / 全局 / 直连）、上下行速率、连接数与运行时长、启动 / 停止、账号入口、兑换码入口、内核状态、QQ 群 / 客服微信复制、官网 / GitHub（非 aigw 渠道）。
- 横幅：发现新版本 / 强制升级、分流异常（可忽略，内容变了再出现）、开代理后连不上网。
- 概览：重启核心、刷新状态、启停、四个指标、AI 环境检测卡（劫持模式开关、逐项检测与一键修复）、分流链路、应用流量前 4 条、快速操作、节点健康前 4 个。
- 节点：链接批量导入、手动 SOCKS5 / HTTP、搜索、测 TCP / Google / 速度、全部检测、测活动节点速度、设为活动（含双击）、二维码分享、删除。
- 应用分流：只代理列出的 / 默认全代理、未列出应用走哪条线路、整机全局与非「规则」策略的提示、从运行中进程添加、从文件夹选 exe、手动输入、每条规则的方式 / 节点（自定义线路自带出口）/ 启用 / 测试 / 目标条件（域名 / IP / 端口）/ 删除、运行中标记、程序原始图标、清空、导入（预检确认）/ 导出。
- 分流规则：规则库启停与更新（客户端从深圳镜像 /rules/ 自动同步，manifest sha256 校验，失败回退上游）、自定义规则编辑与写法说明、自定义线路新建 / 编辑 / 删除（删时回退用到它的应用和默认线路）。
- 订阅：添加（含自动更新）、编辑（保存并更新）、更新、全部刷新、自动更新开关、删除。
- 日志：实时连接（进程 / 目标 / 命中规则 / 出口 / 流量，过滤）、原始日志（级别着色、过滤、清空）。
- 设置：账户信息、改密码、设备列表与解绑、续费 / 刷新授权 / 退出；AI 控制地址 / Token 显隐与复制 / 一键复制提示词 / MCP 配置；Claude 加速模式、交回自动、自动切换、总开关、加速统计；软件版本与检查更新、自动更新软件、内核版本 / 自动更新内核 / 立即更新、本地端口、日志级别、配置导出 / 导入 / 重置；QUIC、远程 DNS、内网直连、排除自身；代理范围、局域网共享（端口 / 类型 / 账号）、开机自启、关闭到托盘、主题。
- 账号：登录、注册、POWER云 / AI 编程官网登录、自动登录、会员中心（套餐分组、永久套餐、兑换码、公告、设备上限时解绑）、支付（二维码、本机打开支付宝、我已支付、拆单逐笔）、赞赏码（启动弹出、3 秒后才能关，aigw 渠道和已付费会员不弹）。

检查方式：`pnpm typecheck && pnpm lint && pnpm test && pnpm audit:ui && pnpm check:size && pnpm build`；`pnpm dev` 浏览器里用假后端逐页截图（1400×880 浅色 / 深色 + 窄窗 1180）；最后 `wails build` 出 exe 实机点一遍。
