# 发版 / 回滚 / 私钥 / 构建坑

> 逐版事实（commit、SHA256、releases id、incoming 目录）见 docs/decisions.md；完整流程见 docs/RELEASE-PROCESS.md。

## 只发客户端的标准流程
只发客户端时不走 release-all.ps1，而是：本机构建 → transfer_link 传 sz `/opt/proxysplit/incoming/client-v<版本>-<commit>` → 该目录 `publish-client.py prepare` →（登记 releases）→ `promote`。
- 登记 releases：经堡垒机 db_query 在 sz-pg-proxysplit 插 releases + audit_logs（audit_logs.ip 不能为空），字段照上一版抄。
- 先装版本化文件再原子替换 latest；旧 latest 存该目录 `previous/`。
- 验收：公网 latest API = 新版本且签名与 manifest 一致；用国内机（飞牛）下载版本化 / latest / ai-latest 三个地址整包 sha 一致（tw-bbr3 ↔ 深圳大文件会中途截断，重下即可）；internal/updater 以上一版身份 Check→下载→验签通过；服务端有改动时再查 /health 200。

## 回滚
回滚客户端 = 在该版本的 incoming 目录跑 `python3 publish-client.py rollback`，并手动删 releases 表里该版本那行（脚本不删表）。
- 服务端回滚：`cd 上一个 release && docker compose up -d api`（迁移都是加法）。
- 已部署 SQL 迁移按文件名记录，修改旧迁移不会重跑，必须新迁移；现有两个 0008 不可重命名。

## 发布全站与私钥
全站发布按 docs/RELEASE-PROCESS.md：`scripts/release-all.ps1` 只做检查 + 签名构建 + 打包到 output/release-<id>/（2026-10-22 起去掉了 ssh/scp，不碰生产），上传、`remote-deploy.sh`、登记都经堡垒机。
- 全站发布步骤见 docs/RELEASE-PROCESS.md（2026-10-22 v1.9.76 按它实测；remote-deploy.sh 会直接替换 downloads 的 latest，所以全站发布不用 publish-client.py）。
- 发布签名私钥在堡垒机资产 id 116：打包前写回 `server/secrets/shenzhen-release-private.pem`（LF 换行，SHA256 与 build/release-kit/profile.json 对得上），打完立刻删；该文件被 Git 忽略，禁止打印或提交。
- minimumVersion 会进授权租约 minVersion，别随手调高，否则老客户端被拒（当前一直是 1.9.51）。
- 换签名密钥必须先发带新公钥的客户端。
- Authenticode（v1.10.8 起）：构建时设环境变量 `EVSIGN_KEY`（堡垒机资产 251 的许可证，只放环境变量）即由 `scripts/evsign.ps1` 交 EV Sign 共享证书签名，在算 SHA256 / Ed25519 签名之前做；`proxysplit.exe` 已在 EV Sign 审核名单里。签名者是共享证书的公司（会换），**禁止把签名文件提交 360 白名单**（会拉黑证书）；火绒 / 腾讯可以提交。

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
