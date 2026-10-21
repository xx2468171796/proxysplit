# 架构与部署

> 详细结构见 docs/architecture.md、docs/需求文档.md。

## 技术栈
客户端 Go + Wails，前端已由 Svelte 改为 React（见 frontend.md），分流用 sing-box 原生 TUN + process_name，早期 WinDivert 已移除。
- 服务端 Fastify + PostgreSQL + Redis；会员真源在服务端，Ed25519 离线租约绑定账号 / 设备 / 硬件 / 期限。
- 工具链：Go 1.26.8（go.mod 最低版本），Wails 2.16.0，内核 sing-box 1.14.x（relayops 自编，见 core-update.md）。

## 生产环境（深圳 sz）
2026-09-25 起生产不再自带 PG/Redis 容器：用深圳共享 PG（库 proxysplit，堡垒机数据源 **sz-pg-proxysplit**）和共享 Redis db9（ACL 用户 proxysplit，只能碰 proxysplit:* 与 fastify-rate-limit-*）；api 经 host.docker.internal 连宿主机（docker-compose.prod.yml extra_hosts）。
- 旧容器 proxysplit-postgres-1 / redis-1 已停，数据源 sz-proxysplit-pg 已标停用，发版登记要写新库。凭据在堡垒机资产，别往仓库写。
- 官网：https://proxysplit.zygskins.cn；SSH 别名 proxysplit-shenzhen（实际操作一律经堡垒机）；管理员凭据仅本机私有配置，不入 Git。
- Nginx 站点配置 /www/conf.d/proxysplit.zygskins.cn.conf（OpenResty）；下载静态路径模板 server/deploy/proxysplit.nginx.conf。

## 产品规则
- 客户数据在 %APPDATA%/proxysplit，升级不清配置、节点、规则或 license.dat。
- 普通 / 超级会员功能完全相同，只按同时在线设备数区分：3 台 / 8 台。
- 自动更新必须通过 HTTPS、TLS SPKI、Ed25519 与 SHA256；发布渠道隔离。
- 新装默认 RuleMode=whitelist（只代理列出的程序）。

## 代码仓库
Git 只有一个 remote：origin = Gitea xuan/proxysplit（http://s3.alonelife.top:32109），直接 push origin main（另有 GitHub xx2468171796/daili，推送见 dev-machine-pitfalls.md）。

## 迁移原文条目（来自旧 MEMORY.md，供核对）
- 服务端：Fastify + PostgreSQL + Redis；会员真源在服务端，Ed25519 离线租约绑定账号/设备/硬件/期限。
- 2026-09-25 起生产不再自带 PG/Redis 容器：用深圳共享 PG（库 proxysplit，堡垒机数据源 sz-pg-proxysplit）和共享 Redis db9（ACL 用户 proxysplit，只能碰 proxysplit:* 与 fastify-rate-limit-*）；api 经 host.docker.internal 连宿主机（docker-compose.prod.yml extra_hosts）。凭据在堡垒机资产，别往仓库写。
- 官网：https://proxysplit.zygskins.cn；SSH 别名 proxysplit-shenzhen；管理员凭据仅本机私有配置，不入 Git。
- Git 只有一个 remote：origin = Gitea xuan/proxysplit（http://s3.alonelife.top:32109），直接 push origin main。本机 PowerShell 没有 git/go 的 PATH：git 用 Bash 工具，go 在 C:\tools\go\bin，wails 在 ~/go/bin。
- 正式构建：scripts/build-commercial.ps1 -Version <版本>，要求干净工作区。
- 发布资料：build/release-kit/profile.json；签名私钥为 Git 忽略的 server/secrets/shenzhen-release-private.pem，禁止打印或提交。
- 完整发布脚本 scripts/release-all.ps1 会同时部署服务端/官网，不要把只打包客户端误当成全站发布。
- 客户数据：%APPDATA%/proxysplit；升级不清配置、节点、规则或 license.dat。
- 普通/超级会员功能完全相同，只按同时在线设备数区分：3 台 / 8 台。
