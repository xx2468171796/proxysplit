-- 公司统一账号 zhanghao（zhanghao-v1.19.1）接管账号资料与后台账号操作（2026-10-29）。只加不改：
-- users 补 zhanghao store 要的列（列名与包的 sql/schema.sql 一致）；会话 / 设备仍是本项目的 sessions / devices。
ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_key text;
-- 限时封禁到期时间；status='banned' 且为 null = 永久封
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_until timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_reason text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS register_meta jsonb;

-- zhanghao 按 lower(username) 查与判重（生产 2026-10-29 无大小写重名）
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_uq ON users(lower(username));
CREATE INDEX IF NOT EXISTS users_nickname_lower_idx ON users(lower(nickname));

-- 后台账号操作流水；request_id 唯一 = 幂等锚（同一请求重放不二次生效）。operator_id / target_user_id 用本项目的 uuid。
CREATE TABLE IF NOT EXISTS zh_admin_actions (
  id              bigserial    PRIMARY KEY,
  request_id      text         NOT NULL UNIQUE,
  operator_id     uuid         NOT NULL,
  target_user_id  uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action          text         NOT NULL CHECK (action IN (
                    'ban','unban','nickname','username','phone','email',
                    'password_reset','revoke_sessions','login_lock_reset')),
  detail          text         NOT NULL,
  created_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zh_admin_actions_target_idx ON zh_admin_actions(target_user_id, id DESC);
