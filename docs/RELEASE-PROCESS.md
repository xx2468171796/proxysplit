# ProxySplit 通用发布流程

这份流程是客户端、API、运营后台和官网的唯一正式发布入口。

> **只发客户端**（服务端不动）不跑 `release-all.ps1`，按 [docs/memory/release-process.md](memory/release-process.md)「只发客户端的标准流程」：
> 正式构建 → 传深圳 incoming → `publish-client.py prepare` → 登记 releases → `promote` → 验收。后续 Codex、Claude Code
或人工接手时，不要再手工复制单个文件、手改官网版本号或直接覆盖线上目录。

## 一条命令

先把准备发布的代码提交到 `main`，确保工作区干净，然后执行：

```powershell
.\scripts\release-all.ps1 `
  -Version 1.9.35 `
  -Title "节点列表体验优化" `
  -Summary "节点表头和内容严格对齐" `
  -Changelog "统一表格列轨道；修复窄窗口布局。"
```

只做环境、测试和构建链检查，不修改生产：

```powershell
.\scripts\release-all.ps1 -Version 1.9.35 -PreflightOnly
```

可选参数：

- `-MinimumVersion 1.9.20`：允许升级的最低客户端版本，默认等于新版本。
- `-Channel beta`：测试通道，默认 `stable`。
- `-Mandatory`：强制升级。
- `-SkipTests`：只在紧急且测试已由 CI 完整执行时使用；类型检查和构建仍不会跳过。

## 自动完成的事情

1. 要求 `main`、干净 Git 工作区，并记录精确 commit。
2. 校验工具、正式公钥、TLS Pin、发布私钥和管理员凭据。
3. 执行 Go test/vet、前端门禁（`pnpm --dir frontend check`）、服务端 typecheck/test/build。
4. Garble 构建 Windows EXE，写入 FileVersion/ProductVersion，生成 SHA256 和 Ed25519 更新签名。
5. 从 Git commit 组装服务端源码，并加入刚构建的后台 `dist`。
6. 上传到唯一 release 目录；迁移前自动 `pg_dump`；构建并健康检查 API。
7. 原子切换 `/opt/proxysplit/current`，更新 Nginx、官网和后台。
8. 原子发布版本化安装包及 `proxysplit-latest.exe`。
9. 调用后台 API 登记版本，最后验证 health、latest API 和两个下载地址。

## 文件与职责

| 文件 | 用途 |
|---|---|
| `scripts/release-all.ps1` | 本机总编排，后续 AI 只调用它 |
| `scripts/build-commercial.ps1` | 客户端正式签名构建 |
| `scripts/remote-deploy.sh` | 服务端迁移、备份、容器、原子切换 |
| `build/release-kit/profile.json` | 可提交的生产地址、SSH 和公钥配置 |
| `server/secrets/shenzhen-release-private.pem` | 本机更新签名私钥，禁止提交 |
| `~/.config/proxysplit/shenzhen-admin.txt` | 本机后台账号，禁止提交 |

管理员凭据文件格式：

```text
URL=https://proxysplit.zygskins.cn
USERNAME=...
PASSWORD=...
SSH=proxysplit-shenzhen
```

## 版本和缓存约定

- 官网源码不再写死 `v1.9.x`，默认链接固定为
  `/download/proxysplit-latest.exe`，页面加载后以 latest API 更新显示。
- 每个正式包仍保留不可变地址 `/download/proxysplit-vX.Y.Z.exe`。
- 官网普通 HTML 使用 `no-cache`；带指纹的静态 assets 才允许长期缓存。
- 客户端版本只来自发布命令参数，构建脚本会同步 Go、Wails、Windows 资源并在结束后恢复源码。

## 失败、重跑与回滚

- 本地检查或构建失败：生产完全不变，修复后重新运行同一命令。
- 迁移前会生成 `/opt/proxysplit/backups/postgres-<release-id>.sql.gz`。
- 新 API 未健康：不会切换官网/后台软链接，脚本报错并保留日志。
- Nginx 验证失败：脚本自动把 `current` 软链接切回前一版。
- 数据库迁移是前向兼容设计，**不要自动执行降级 SQL**。需要数据恢复时先停 API，
  由负责人确认备份时间点后恢复。
- 若服务器已部署但“登记自动更新版本”失败，可修复后台凭据/网络后重跑；由于版本记录唯一，
  重跑前先确认 `/v1/releases` 是否已经存在该版本。

生产检查：

```powershell
Invoke-RestMethod https://proxysplit.zygskins.cn/health
Invoke-RestMethod "https://proxysplit.zygskins.cn/v1/releases/latest?channel=stable"
ssh proxysplit-shenzhen "readlink -f /opt/proxysplit/current; docker ps --filter name=proxysplit"
```

## 发布后的固定收尾

1. 把版本、commit、SHA256、release 目录和验证结果写入 `.ankotti/MEMORY.md`。
2. `git push origin main` 和 `git push gitea main`。
3. 调用 ecosystem `report` 汇报版本、结果和阻塞。
