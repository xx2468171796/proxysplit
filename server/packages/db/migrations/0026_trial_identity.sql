-- 试用按「核实过的身份」只发一次（2026-11-18 第二轮审计）。
-- 以前只按硬件摘要判（trial_claims 主键），而硬件摘要是客户端自报的：换一个摘要 + 新账号就能再领一次。
-- 现在另记一张「哪个身份领过」：短信验证过的手机号 / 合作方账号（user_identities）。规则在 core trial.ts（唯一归属）。
-- identity_hash = sha256('proxysplit-trial-identity-v1:<kind>:<value>')，不存手机号明文；
-- user_id 在账号删除后置空而不是连带删除（删号不能让同一个手机号再领一次）。
CREATE TABLE IF NOT EXISTS trial_identity_claims(
  identity_hash text PRIMARY KEY,
  kind text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  claimed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trial_identity_claims_user_idx ON trial_identity_claims(user_id);

-- 把已经领过试用的账号（users.trial_started_at 或 trial_claims 里有记录）记到它现有的身份上：
-- 已发出去的试用不动，只是这些手机号 / 合作方账号以后不再发第二次。没有任何核实身份的老账号无从归属，保持原样。
WITH claimed AS (
  SELECT u.id, u.phone, COALESCE(u.trial_started_at, (SELECT min(c.claimed_at) FROM trial_claims c WHERE c.user_id = u.id)) AS at
  FROM users u
  WHERE u.trial_started_at IS NOT NULL OR EXISTS (SELECT 1 FROM trial_claims c WHERE c.user_id = u.id)
)
INSERT INTO trial_identity_claims(identity_hash, kind, user_id, claimed_at)
SELECT encode(sha256(convert_to('proxysplit-trial-identity-v1:phone:' || phone, 'UTF8')), 'hex'), 'phone', id, at
FROM claimed WHERE phone IS NOT NULL
ON CONFLICT(identity_hash) DO NOTHING;

WITH claimed AS (
  SELECT u.id, COALESCE(u.trial_started_at, (SELECT min(c.claimed_at) FROM trial_claims c WHERE c.user_id = u.id)) AS at
  FROM users u
  WHERE u.trial_started_at IS NOT NULL OR EXISTS (SELECT 1 FROM trial_claims c WHERE c.user_id = u.id)
)
INSERT INTO trial_identity_claims(identity_hash, kind, user_id, claimed_at)
SELECT encode(sha256(convert_to('proxysplit-trial-identity-v1:' || i.provider || ':' || i.external_id, 'UTF8')), 'hex'), i.provider, c.id, c.at
FROM claimed c JOIN user_identities i ON i.user_id = c.id
ON CONFLICT(identity_hash) DO NOTHING;
