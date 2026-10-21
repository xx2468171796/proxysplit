# ProxySplit 商业服务

模块化单体，遵循中犇 `vite-fastify-monorepo` 分层：

```text
apps/admin        React 运营后台
apps/api          Fastify HTTP 入口（不直连数据库）
packages/core     登录、设备、授权租约与领域服务
packages/db       PostgreSQL / Drizzle schema 与迁移
packages/contracts  Zod 请求契约
packages/shared   错误与纯工具
```

## 已具备

- 用户名密码登录，Argon2id（64 MiB、3 次迭代）。
- 15 分钟 access token、refresh token 单次轮换、重放后整族吊销。
- 设备指纹仅保存加盐用途隔离后的 SHA256 摘要；事务锁保证设备上限不被并发绕过。
- 有效授权、套餐功能和设备绑定检查。
- 24 小时 Ed25519 签名授权租约，客户端只需要公钥；服务端可控制到期、封禁和最低版本。
- 登录限流、管理员后端守卫、关键操作审计。
- 用户创建/暂停/恢复/续费、设备解绑、版本发布、审计查询后台。

## 本地启动

```powershell
cd server
Copy-Item .env.example .env
docker compose up -d
pnpm install
pnpm keys:generate
$env:LICENSE_PRIVATE_KEY_PEM = Get-Content -Raw .\secrets\license-private.pem
pnpm db:migrate
pnpm dev
```

根目录 `.env` 会由 `dotenv-cli` 同时注入 API、后台和迁移命令。首次启动通过 `BOOTSTRAP_ADMIN_USERNAME/PASSWORD` 创建管理员；上线后立即删除这两个环境变量。生产密钥必须由 Infisical 注入，禁止提交 `.env`、JWT 密钥和 Ed25519 私钥。

## 生产边界

- 必须配置固定 Ed25519 私钥/公钥，不能使用开发环境临时生成密钥。
- API 放在 TLS 反向代理后，Redis 用于多实例限流，PostgreSQL/Redis 开启备份与访问控制。
- 发布记录的 SHA256 与 signature 必须来自独立发布签名流程，后台不会替操作者伪造签名。
- 客户端节点、订阅和代理密码不上传到本服务。

## 深圳生产部署

生产编排位于 `docker-compose.prod.yml`，部署目录固定为
`/opt/proxysplit/current`，机密文件放在 `/opt/proxysplit/secrets`：

```text
/opt/proxysplit/secrets/runtime.env
/opt/proxysplit/secrets/license-private.pem
/opt/proxysplit/secrets/license-public.pem
```

`runtime.env` 至少包含 `NODE_ENV`、`DATABASE_URL`、`REDIS_URL`、
`POSTGRES_PASSWORD`、`REDIS_PASSWORD`、`ACCESS_TOKEN_SECRET` 与
`ADMIN_ORIGIN`。首次启动可临时加入 `BOOTSTRAP_ADMIN_USERNAME/PASSWORD`，
管理员创建成功后必须删除这两项并重建 API 容器。

```bash
cd /opt/proxysplit/current
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate
docker compose -f docker-compose.prod.yml up -d api
```

宿主机 Nginx 使用 `deploy/proxysplit.nginx.conf`，对外统一入口为
`https://proxysplit.zygskins.cn`；官网静态文件位于 `apps/site`（由仓库根的 `website/` 构建，发布时放入），管理台位于
`/admin/`，版本下载位于 `/download/`。管理台与 API 同源，`/v1/*` 和
`/health` 反向代理到仅监听 `127.0.0.1:18780` 的 API 容器。

桌面正式版的自动更新采用独立 Ed25519 发布密钥。`scripts/build.ps1`
通过 `ReleasePublicKeyFile` 把公钥编入客户端，通过
`ReleaseSigningPrivateKeyFile` 对“版本号 + SHA256 + 下载 URL”生成签名。
客户端同时验证发布签名、文件 SHA256 和固定 TLS SPKI 后才会执行原地升级。
