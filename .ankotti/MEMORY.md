# ProxySplit 项目状态

- 当前桌面版本：`v1.8.2`。
- 已将确认稿 `output/ProxySplit-UI-Prototype-v2.html` 的布局真正迁移到正式 Wails 界面：统一 218px 侧栏、72px 顶栏、页面标题区、概览 KPI/分流链路/快捷操作/节点健康，以及节点、应用分流、分流规则、订阅、日志、设置等页面的卡片和双栏排版。
- 概览“应用流量”表已固定四列宽度并统一左对齐，应用图标、名称、路径保持紧凑对齐；真实 EXE 图标通过 Win32 提取显示，路径因升级失效时会按同名运行进程回退查找新路径。
- 正式产物：`output/proxysplit-v1.8.2.exe`；快捷副本：`output/proxysplit.exe`。
- 发布清单：`output/proxysplit-v1.8.2.manifest.json`；SHA256：`075d2eeadc26f12b9ece877f092fc4c99af88c0ff357ecb97ee7f529c66ed587`。
- UI 原型 `output/ProxySplit-UI-Prototype-v2.html` 和用户示例数据 `output/proxysplit-data.json` 保留，不参与正式程序的数据加载。
- 数据仍持久化到 `%APPDATA%/proxysplit/config.json`，并保留 `.bak` 与 exe 同目录 `proxysplit-data.json` 兼容迁移；本轮 v1.8.2 启停回归后节点 3 条、应用规则 3 条均未丢失。
- 校验结果：`npm run check` 为 0 errors / 0 warnings / 0 hints；`go test ./...` 全通过；普通 Wails 构建及 v1.8.2 Garble 混淆发布构建成功；Edge 与 esbuild 的真实 EXE 图标提取回归通过。
- 商业化服务端位于 `server/`：Fastify API、React 管理台、PostgreSQL、Redis、Argon2id、短期 access token、refresh 轮换、Ed25519 离线授权与 TLS SPKI 固定能力均已具备。
- 深圳生产环境已部署到 `https://proxysplit.zygskins.cn`，健康检查为 `https://proxysplit.zygskins.cn/health`；Nginx 终止 HTTPS，API 仅监听远端回环地址 `127.0.0.1:18780`，PostgreSQL 与 Redis 仅在 Docker 内网开放。
- 远端部署目录为 `/opt/proxysplit/current`（当前版本目录 `/opt/proxysplit/releases/20260723-120753-daf562e`），运行栈为 `server/docker-compose.prod.yml`，API、PostgreSQL、Redis 均已设置 `unless-stopped` 并通过健康检查；主机 Nginx 已启用且配置位于 `/www/conf.d/proxysplit.zygskins.cn.conf`。
- 深圳机 SSH 别名为 `proxysplit-shenzhen`，本机私钥为 `C:/Users/Administrator/.ssh/proxysplit_shenzhen_ed25519`，公钥指纹为 `SHA256:YEzRm+Ia4ICmcbsjlGeu+W8AaNlJxEyystCVMwiMLG4`；服务器主机指纹为 `SHA256:V4iuR3HqJufZBCtAyCYyDy1UkP+x5AL1QGuCBKKk1+s`，已启用严格主机校验。
- 生产管理员为 `admin`，随机密码收据仅保存在 `C:/Users/Administrator/.config/proxysplit/shenzhen-admin.txt`；初始化凭据已从远端运行环境删除，并在容器重建后重新登录验证数据库持久化成功。
- 生产授权公钥副本与 TLS SPKI 分别保存在已忽略的 `server/secrets/shenzhen-license-public.pem`、`server/secrets/shenzhen-tls-spki.txt`；当前 TLS SPKI 为 `uk6CLDgMOcToZW0EsOM869fNi64NssJlno0sQJhs15U=`。
- 服务端生产化校验：`pnpm typecheck`、`pnpm test`、`pnpm build` 全通过；公网 HTTPS、健康检查、管理员登录、仪表盘、授权公钥接口及容器重启后持久化均已验证。
- 后续待办：正式 Windows 商业发布时，把生产 API 地址、授权公钥、TLS SPKI 写入桌面端构建配置，并补 Windows Authenticode 证书。
