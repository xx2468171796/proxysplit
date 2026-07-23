# ProxySplit 项目状态

- 当前桌面版本：`v1.8.1`。
- 已将确认稿 `output/ProxySplit-UI-Prototype-v2.html` 的布局真正迁移到正式 Wails 界面：统一 218px 侧栏、72px 顶栏、页面标题区、概览 KPI/分流链路/快捷操作/节点健康，以及节点、应用分流、分流规则、订阅、日志、设置等页面的卡片和双栏排版。
- 正式产物：`output/proxysplit-v1.8.1.exe`；快捷副本：`output/proxysplit.exe`。
- 发布清单：`output/proxysplit-v1.8.1.manifest.json`；SHA256：`3c903f3e0782c98634442f9be9126baef4c9b1fd18f8ac9eb84d6d4ac21df9aa`。
- UI 原型 `output/ProxySplit-UI-Prototype-v2.html` 和用户示例数据 `output/proxysplit-data.json` 保留，不参与正式程序的数据加载。
- 数据仍持久化到 `%APPDATA%/proxysplit/config.json`，并保留 `.bak` 与 exe 同目录 `proxysplit-data.json` 兼容迁移；本轮 v1.8.1 启停回归后节点 3 条、应用规则 3 条均未丢失。
- 校验结果：`npm run check` 为 0 errors / 0 warnings / 0 hints；`go test ./...` 全通过；普通 Wails 构建及 v1.8.1 Garble 混淆发布构建成功。
- 商业化服务端位于 `server/`：Fastify API、React 管理台、PostgreSQL、Redis、Argon2id、短期 access token、refresh 轮换、Ed25519 离线授权与 TLS SPKI 固定能力均已具备。
- 后续待办：如需正式商业发布，补生产 HTTPS API 地址、Ed25519 私钥/公钥、TLS SPKI 指纹与 Windows Authenticode 证书。
