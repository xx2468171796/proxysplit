-- 免费档 / 配置云同步 / 云端配置 / 手机号注册（2026-10-29，docs/plan-2026-10-29-free-sync-phone.md）
-- 免费用户能用全部功能、只绑 1 台；会员设备数 = 这个免费名额 + 套餐 max_devices。
INSERT INTO system_settings(key,value,description) VALUES('default_device_limit','1','免费设备数（会员在此基础上叠加套餐设备数）')
ON CONFLICT(key) DO UPDATE SET value='1'::jsonb,description=excluded.description,updated_at=now()
  WHERE system_settings.value = '3'::jsonb; -- 只改仍是旧默认值的，管理员改过的保留

-- 手机号：存 11 位大陆号（去 +86）；老账号可为空，登录后补绑。
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text;
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_uq ON users(phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS sms_codes(
  id bigserial PRIMARY KEY,
  phone text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('register','reset','bind')),
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sms_codes_phone_idx ON sms_codes(phone, created_at DESC);

-- 每个手机号每个北京日只能成功找回一次密码。
CREATE TABLE IF NOT EXISTS password_reset_daily(
  phone text NOT NULL,
  day date NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(phone, day)
);

-- 自动云同步：每用户一份，AES-256-GCM（密钥 CONFIG_SYNC_KEY），version 做乐观锁。
CREATE TABLE IF NOT EXISTS config_sync(
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ciphertext bytea NOT NULL,
  iv bytea NOT NULL,
  tag bytea NOT NULL,
  version int NOT NULL,
  size int NOT NULL,
  device_name text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 云端命名配置：份数按会员档位（普通 1、超级 5）；可设恢复密码、可开分享码 + 分享密码。
CREATE TABLE IF NOT EXISTS config_profiles(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  ciphertext bytea NOT NULL,
  iv bytea NOT NULL,
  tag bytea NOT NULL,
  size int NOT NULL,
  device_name text NOT NULL DEFAULT '',
  share_code text UNIQUE,
  share_password_hash text,
  restore_password_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS config_profiles_user_idx ON config_profiles(user_id, updated_at DESC);

-- 分享导入 / 恢复密码的尝试记录（限流与失败锁）：kind = share_user | share_code | restore。
CREATE TABLE IF NOT EXISTS config_attempts(
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  subject text NOT NULL,
  ok boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS config_attempts_subject_idx ON config_attempts(kind, subject, created_at DESC);

-- 短信发送失败留痕（后台统计失败数）；失败的行不计冷却与次数。
ALTER TABLE sms_codes ADD COLUMN IF NOT EXISTS failed_at timestamptz;
