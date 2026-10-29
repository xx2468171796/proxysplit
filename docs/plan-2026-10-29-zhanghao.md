# 第 2 期：账号与会话接入公司包 zhanghao（设计，2026-10-29）

目标：账号与会话按公司统一做法由 zhanghao-v1.19.1 管；**老客户端不掉线、不改协议**；设备绑定 / 试用 / 离线租约 / POWER云 登录仍是本项目逻辑，叠在 zhanghao 之上。

## 现状（生产 56 个用户，2026-10-29 查）
- `users`：uuid 主键，`role` 枚举 user/admin，`status` 枚举 active/suspended/banned（只有 active 在用），`password_hash` 可空（6 个 POWER云 预建号），已有 `lower(email)` / `phone` 部分唯一，**缺 `lower(username)` 唯一**（无大小写重名）。
- 会话：自签 HS256 JWT（access 15 分钟，带 `did` 设备 id；refresh 轮换存 `sessions` 表，含「丢响应 10 分钟内重试」容忍）；锁定：5 次失败按 n×5 分钟锁（`users` 三列）。

## 做法
1. **迁移 0021（只加不改）**：`users` 加 `nickname` / `avatar_key` / `banned_until` / `banned_reason` / `register_meta jsonb`；建 `lower(username)` 唯一索引；建 `zh_admin_actions`（operator_id / target_user_id 为 uuid）。
2. **装配**（core `account/zhanghao.ts`）：vendor zhanghao（`scripts/vendor-company.mjs`，跳过 react 与 drizzle store）；`createSqlPgZhanghaoStore({ tableNames: { users: 'users', adminActions: 'zh_admin_actions' } })`；KV = Redis（keyPrefix `proxysplit`，Redis ACL 已放行 `proxysplit:*`）；hasher 用 @node-rs/argon2（`owns` 认 argon2id，不重哈希；空哈希一律验不过）；`LoginGuard` 端口用 Redis 实现，规则照旧（5 次失败、n×5 分钟）。
3. **会话改由 zhanghao 签**：登录 / 注册 / POWER云 / 激活设备 → 先做本项目的设备裁决，再 `zh.login` / `zh.issueSession(userId, { deviceId })`；`sid → deviceId` 记在 Redis（TTL = refresh 有效期），`verifyAccess` = `zh.verifyAccess` + 查 sid 得设备 + 查库得实时角色 / 状态 / 设备吊销。
4. **老客户端兼容（expand）**：
   - `/v1/auth/refresh` 收到老格式 refresh（老密钥能验）→ 走老 `sessions` 表校验一次 → 换发 zhanghao 会话（同设备），响应形状不变；之后客户端自然换成新 token。
   - 老 access token 在 15 分钟内照常认（只读 `did` 与用户状态），一个版本后删。
   - 设备满时的「待激活」短票仍是本项目签的（只能解绑 / 激活，不是会话）。
5. **账号操作一律走 `zh.*`**：注册（`afterCreate` 里领试用 / 绑推广人，与建号同事务）、改密 / 找回（吊销全部会话）、绑手机、后台封禁 / 解封 / 改名 / 重置密码 / 下线（带 requestId 幂等，记 `zh_admin_actions` + 本项目审计）。旧的手写实现删掉。
6. **兄弟包**：`createIdentityBridge(zh)` 给 huiyuan 的 `lookupUser` 用（第 3 期）。

## 收尾（下一版）
老 access 兼容、老 refresh 兑换、`sessions` 表、`users` 锁定三列：确认无人用后删（contract）。

## 验收
- 老客户端（1.11.x）不重新登录就能续用；新客户端登录 / 注册 / 改密 / 找回 / 设备满 / POWER云 全流程；后台封禁立刻踢下线。
- 迁移在生产库事务内试跑并回滚；Redis 键都在 `proxysplit:` 前缀下。
