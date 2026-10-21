# ProxySplit 发布流程

客户端、API、运营后台和官网都按这里发布。服务器只经堡垒机（baolei MCP）操作，不直连 ssh / scp。
每次发版都是强制更新（`mandatory=true`，`minimum_version` 保持 1.9.51），官网跟客户端一起发。

- **全站发布**：服务端、后台或官网有改动时用，下面第 1–5 步。
- **只发客户端**：服务端不动时，按 [docs/memory/release-process.md](memory/release-process.md)「只发客户端的标准流程」（incoming + `publish-client.py`）。

## 1. 定版

CHANGELOG 写好新版本一节并提交到 `main`，工作区保持干净。

## 2. 本机检查、构建、打包

签名私钥（堡垒机资产 116）写到 `server/secrets/shenzhen-release-private.pem`（LF 换行，SHA256 与 `build/release-kit/profile.json` 一致），用完立刻删。在 Bash 里：

```bash
trap 'rm -f server/secrets/shenzhen-release-private.pem' EXIT
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/release-all.ps1 -Version x.y.z
```

脚本依次做：干净 `main` 检查 → 版本必须比线上新 → Go test/vet、前端 `check`、服务端 typecheck/test/build、官网 `check`（含首屏体积门禁）→ 签名构建 exe → 用 `git archive HEAD:server` 加后台 dist 和官网 dist 组装服务端包。产物在 `output/release-<release-id>/`：服务端 tar.gz、exe、manifest、`remote-deploy.sh`。只检查不构建用 `-PreflightOnly`。

构建会重新生成 `frontend/wailsjs` 绑定，有变化就随后提交。

## 3. 上传并部署（堡垒机）

1. `run_command sz`：`mkdir -p /opt/proxysplit/incoming/<release-id>`。
2. 四个文件各用 `transfer_link`（upload）拿一次性链接，本机 `curl -fT` 上传；服务器上 `sha256sum` 核对。
3. `run_command sz`：`sh /opt/proxysplit/incoming/<id>/remote-deploy.sh /opt/proxysplit <id> <tar> <exe> <manifest>`（约 5 分钟）。

`remote-deploy.sh` 会：`pg_dump` 备份到 `backups/postgres-<id>.sql.gz` → 构建 API 镜像并迁移 → 健康检查 → 放版本化安装包并原子替换 `proxysplit-latest.exe`（`proxysplit-ai-latest.exe` 软链跟着走）→ 切换 `current` 软链 → `openresty -t`。OpenResty 站点配置在服务器上统一管理，脚本不覆盖。

## 4. 登记版本（堡垒机 db_query，数据源 sz-pg-proxysplit）

在一个事务里插 `releases`（version、minimum_version='1.9.51'、url、sha256、signature 取自 manifest，mandatory=true，title / summary / changelog，channel='stable'）和 `audit_logs`（action `admin.release.create`，ip 不能为空）。字段照上一版那行抄。

## 5. 验收与收尾

- 用国内机（飞牛）：`/v1/releases/latest?channel=stable` 是新版本且 mandatory；`/health` 200；官网和 `/admin/` 200；版本化 / latest / ai-latest 三个下载地址整包 SHA256 与 manifest 一致。
- 浏览器打开官网，确认无报错、套餐能加载、页脚版本正确。
- 写回 sz 机器笔记（`update_machine_knowledge`，页面 proxysplit）、`.ankotti/MEMORY.md` 与 `docs/decisions.md`；推送 `gitea` 和 `origin`（GitHub 令牌只临时放请求头），打 tag；`report`。

## 回滚

- 服务端：`cd` 上一版 `releases/<id>` 目录，`docker compose -f docker-compose.prod.yml up -d api`，并把 `current` 软链切回去（迁移都是加法，不跑降级 SQL）。
- 客户端：把 `downloads/proxysplit-latest.exe` 和 `proxysplit-latest.manifest.json` 换回上一版的版本化文件，再删 `releases` 表里新版本那行。
- 需要恢复数据时先停 API，由负责人确认备份时间点后再恢复。
