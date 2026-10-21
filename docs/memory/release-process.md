# 发版 / 回滚 / 私钥 / 构建坑

> 逐版事实（commit、SHA256、releases id、incoming 目录）见 docs/decisions.md；完整流程见 docs/RELEASE-PROCESS.md。

## 只发客户端的标准流程
只发客户端时不走 release-all.ps1，而是：本机构建 → transfer_link 传 sz `/opt/proxysplit/incoming/client-v<版本>-<commit>` → 该目录 `publish-client.py prepare` →（登记 releases）→ `promote`。
- 登记 releases：用本机 `~/.config/proxysplit/shenzhen-admin.txt` 调 `/v1/admin/releases`（Node 脚本，用完删）；或经堡垒机 db_query 直接插入 sz-pg-proxysplit 并补 audit_logs（audit_logs.ip 不能为空）。管理员凭据在堡垒机资产 205。
- 先装版本化文件再原子替换 latest；旧 latest 存该目录 `previous/`。
- 验收：公网 latest API = 新版本且签名与 manifest 一致；用国内机（飞牛）下载版本化 / latest / ai-latest 三个地址整包 sha 一致（tw-bbr3 ↔ 深圳大文件会中途截断，重下即可）；internal/updater 以上一版身份 Check→下载→验签通过；服务端有改动时再查 /health 200。

## 回滚
回滚客户端 = 在该版本的 incoming 目录跑 `python3 publish-client.py rollback`，并手动删 releases 表里该版本那行（脚本不删表）。
- 服务端回滚：`cd 上一个 release && docker compose up -d api`（迁移都是加法）。
- 已部署 SQL 迁移按文件名记录，修改旧迁移不会重跑，必须新迁移；现有两个 0008 不可重命名。

## 发布全站与私钥
`scripts/release-all.ps1` 会同时部署服务端和官网，不要把只打包客户端误当成全站发布；它的上传/远程执行曾用直连 ssh/scp（违反「服务器只经堡垒机」），2026-09-28 起 `scripts/remote-deploy.sh` 已修好（pg_dump 改宿主机连共享 PG 并校验，OpenResty 配置不覆盖只 `openresty -t`）。
- 全站发布步骤（经堡垒机手工，2026-10-22 v1.9.76 实测）：build-commercial.ps1 → `server` 里 `pnpm build`、`website` 里 `pnpm build` → `git -c core.autocrlf=false archive HEAD:server` 解到临时目录，放入 apps/admin/dist 与 website/dist（去掉 .vite）到 apps/site → tar.gz → sz 建 incoming/<release-id> 并 transfer_link 传 tar、exe、manifest、remote-deploy.sh → run_command `sh remote-deploy.sh /opt/proxysplit <id> <tar> <exe> <manifest>`（约 5 分钟，它会直接替换 downloads 的 latest）→ db_query 插 releases + audit_logs → 验收。
- 发布签名私钥在堡垒机资产 id 116：打包前写回 `server/secrets/shenzhen-release-private.pem`（LF 换行，SHA256 与 build/release-kit/profile.json 对得上），打完立刻删；该文件被 Git 忽略，禁止打印或提交。
- minimumVersion 会进授权租约 minVersion，别随手调高，否则老客户端被拒（当前一直是 1.9.51）。
- 换签名密钥必须先发带新公钥的客户端。

## 构建坑
- 正式构建 `scripts/build-commercial.ps1 -Version <版本>`，要求干净工作区；商业构建默认不混淆、不加壳，保留 Ed25519 验签和授权。
- 在 PowerShell 里 `& build-commercial.ps1` 会因 wails 的 stderr 中断并留下私钥文件：在 Bash 用 `powershell.exe -File scripts/build-commercial.ps1 -Version x`，并 `trap 'rm -f server/secrets/shenzhen-release-private.pem' EXIT`。
- `bin/sing-box.exe` 与 `bin/core-release.json` 不一致时构建第一步就停，先跑 `scripts/fetch-core.ps1`；它的 GITEA_TOKEN 用堡垒机资产 197（旧 xuan 令牌已废）。EXE 不进 Git。
- 构建会重新生成 frontend/wailsjs 绑定，要随提交一起带上。
- Windows 上 `git archive HEAD:子目录` 不套用根 .gitattributes，会按 autocrlf 输出 CRLF，加 `-c core.autocrlf=false`。
- `scripts/verify-release.mjs` 独立核对产物大小 / SHA256 / Ed25519，正式构建末尾自动执行。
- 完整验证 = go test ./... + go vet ./... + 前端门禁（见 frontend.md），不能只跑修改模块；core 测试会用真实内核 check 验证协议配置。
- 生产机拉 npmjs 曾超时，既有 Dockerfile 使用 npmmirror，不随意改生产构建路径。

## 发布顺序
POWER云 相关改动的发布顺序是 面板 → 节点 → 本仓服务端 → 客户端（见 account-membership.md）。

## 迁移原文条目（来自旧 MEMORY.md，供核对）
- 正式构建：scripts/build-commercial.ps1 -Version <版本>，要求干净工作区。
- 发布资料：build/release-kit/profile.json；签名私钥为 Git 忽略的 server/secrets/shenzhen-release-private.pem，禁止打印或提交。
- 完整发布脚本 scripts/release-all.ps1 会同时部署服务端/官网，不要把只打包客户端误当成全站发布。
- 构建前 scripts/fetch-core.ps1 获取 bin/core-release.json 固定的官方内核；EXE 不进 Git。
- 已部署 SQL 迁移按文件名记录；修改旧迁移不会重跑，必须新迁移。现有两个 0008 不可重命名。
- 生产机拉 npmjs 曾超时，既有 Dockerfile 使用 npmmirror；不随意改生产构建路径。
