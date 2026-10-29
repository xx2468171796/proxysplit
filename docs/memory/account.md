# 账号：公司统一账号包 zhanghao（第 2 期，2026-10-29）

- 包：`server/packages/core/src/vendor/zhanghao`（zhanghao-v1.19.1，`node scripts/vendor-company.mjs <yanzheng> zhanghao`，跳过 react / drizzle store / zhctl）。装配在 core `account.ts`，路由在 api `account-routes.ts`。
- 表就是 `users`（迁移 0021 补 nickname / avatar_key / banned_until / banned_reason / register_meta、`lower(username)` 唯一）+ `zh_admin_actions`（uuid 列，request_id 幂等）。KV = Redis（keyPrefix `proxysplit` → 键 `proxysplit:zh:*`），没配 REDIS_URL 用内存。
- **只用账号面**：后台封禁（限时 / 永久 + 理由）、解封、重置密码、改昵称、强制下线、操作流水 `GET /v1/admin/users/:id/actions`；身份桥 `account.bridge` 留给第 3 期 huiyuan 的 lookupUser。
- **会话 / 设备 / 刷新仍是 auth.ts 自己的**（与设计稿不同，有意为之）：zhanghao 的刷新令牌重放即判泄露、全号下线，桌面端丢响应重试（v1.9.64 修过的 10 分钟容忍）会被成片踢掉，且它不认设备绑定。所以 `kick()` 在封禁 / 重置密码 / 强制下线后同步吊销本项目 `sessions`；access 15 分钟内靠 verifyAccess 实时查 status（封禁立刻 403）。
- 限时封禁到期后库里 status 仍是 `banned`（包惰性判断）：store 读用户时用 `userStatusSql()` 把到期的读成 active，**新写读用户的 SQL 必须用它**。
- 老后台的 `PATCH /users/:id/password` 也走 zhanghao（不传 requestId 时服务端现生成）；`PATCH /users/:id/status`（暂停 / 恢复）保留原实现。
- 坑：zhanghao 读 NULL 密码哈希会变成字符串 `'null'`，hasher 只认 `$argon2` 开头，POWER云 预建号一律验不过。
- 收尾（下一版或第 3 期）：`users` 锁定三列与 auth.ts 自写的登录锁定可换成 zhanghao LoginGuard；admin.search 的纯数字查询按 id 比较，uuid 主键下要确认（身份桥 lookupUser 用到）。
