-- POWER云（PowerVPN 面板）账号登录：外部身份 → ProxySplit 用户。
-- 用 POWER云 建的账号没有密码（password_hash 为 NULL），只能走 POWER云 登录，之后可在客户端自设密码。
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
CREATE TABLE IF NOT EXISTS user_identities(
  provider text NOT NULL,
  external_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,external_id)
);
CREATE INDEX IF NOT EXISTS user_identities_user_idx ON user_identities(user_id);
