# 架构与部署

> 详细结构见 docs/architecture.md、docs/需求文档.md。

## 技术栈
客户端 Go + Wails，前端已由 Svelte 改为 React（见 frontend.md），分流用 sing-box 原生 TUN + process_name，早期 WinDivert 已移除。
- 服务端 Fastify + PostgreSQL + Redis；会员真源在服务端，Ed25519 离线租约绑定账号 / 设备 / 硬件 / 期限。
- 工具链：Go 1.26.8（go.mod 最低版本），Wails 2.16.0，内核 sing-box 1.14.x（relayops 自编，见 core-update.md）。

## 生产环境（深圳 sz）
2026-09-25 起生产不再自带 PG/Redis 容器：用深圳共享 PG（库 proxysplit，堡垒机数据源 **sz-pg-proxysplit**）和共享 Redis db9（ACL 用户 proxysplit，只能碰 proxysplit:* 与 fastify-rate-limit-*）；api 经 host.docker.internal 连宿主机（docker-compose.prod.yml extra_hosts）。
- 旧容器 proxysplit-postgres-1 / redis-1 已停，数据源 sz-proxysplit-pg 已标停用，发版登记要写新库。凭据在堡垒机资产，别往仓库写。
- 官网：https://proxysplit.zygskins.cn（仓库 website/，2026-10-23 起用 qiantai 站点配方重写（钉 qiantai-v0.8.0）：配方 src/recipe.ts，接口数据走插槽，门禁 `pnpm --dir website check`，评审单文件包 `pnpm --dir website review <目录>`，详见 website/docs/front-site.md；分支 website-qiantai，尚未部署）；服务器操作一律经堡垒机（机器别名 sz）。
- Nginx 站点配置 /www/conf.d/proxysplit.zygskins.cn.conf（OpenResty）；下载静态路径模板 server/deploy/proxysplit.nginx.conf。

## 产品规则
- 客户数据在 %APPDATA%/proxysplit，升级不清配置、节点、规则或 license.dat。
- 普通 / 超级会员功能完全相同，只按同时在线设备数区分：3 台 / 8 台。
- 自动更新必须通过 HTTPS、TLS SPKI、Ed25519 与 SHA256；发布渠道隔离。
- 新装默认 RuleMode=whitelist（只代理列出的程序）。

## 代码仓库
两个 remote：`gitea` = http://192.168.110.246:3001/admin/proxysplit（本机凭据），`origin` = GitHub xx2468171796/daili（HTTPS，令牌只临时放请求头，见 dev-machine-pitfalls.md）；发版后两边都推、打 tag。

## 节点分享（v1.9.90）
节点「⋯ → 分享节点」：先给分享链接（nodes.ToLink，原始导入链接原样返回）+ 复制，二维码按需展开（service.NodeShare / App.GetNodeShare，前端 node-share-dialog.tsx）。POWER云 官方线路（Node.Official）后端拒绝、前端不给入口——付费线路凭据不外流（1.9.89 前二维码入口未挡，已修）。
