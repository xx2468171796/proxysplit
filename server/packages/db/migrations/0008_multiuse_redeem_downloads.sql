-- Multi-use redeem codes + download / page-view analytics.

-- 1) Multi-use redeem codes.
-- A code may now be redeemed by up to max_uses DISTINCT users (NULL = unlimited,
-- bounded only by code_expires_at). Each (code,user) redemption is recorded once
-- so the same account can never redeem the same code twice and stack duration.
ALTER TABLE redeem_codes
  ADD COLUMN IF NOT EXISTS max_uses integer,               -- NULL = unlimited
  ADD COLUMN IF NOT EXISTS used_count integer NOT NULL DEFAULT 0;

-- Existing codes were single-use: keep them single-use and reflect prior use.
UPDATE redeem_codes SET max_uses=1 WHERE max_uses IS NULL;
UPDATE redeem_codes SET used_count=1 WHERE status='used' AND used_count=0;

DO $$ BEGIN
  ALTER TABLE redeem_codes ADD CONSTRAINT redeem_codes_max_uses_ck CHECK (max_uses IS NULL OR max_uses>=1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Per-(code,user) redemption ledger. UNIQUE enforces "one account, one redeem".
CREATE TABLE IF NOT EXISTS redeem_redemptions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id uuid NOT NULL REFERENCES redeem_codes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(code_id,user_id)
);
CREATE INDEX IF NOT EXISTS redeem_redemptions_code_idx ON redeem_redemptions(code_id);
CREATE INDEX IF NOT EXISTS redeem_redemptions_user_idx ON redeem_redemptions(user_id);

-- Backfill the ledger for legacy single-use codes so historical redemptions are
-- reflected in the per-code usage view.
INSERT INTO redeem_redemptions(code_id,user_id,redeemed_at)
  SELECT id,redeemed_by,COALESCE(redeemed_at,now()) FROM redeem_codes
  WHERE redeemed_by IS NOT NULL
  ON CONFLICT (code_id,user_id) DO NOTHING;

-- 2) Download / page-view analytics.
-- IP is stored ONLY as a salted hash so unique-IP counts are possible without
-- retaining raw addresses. visitor_id is a client cookie/localStorage UUID used
-- to de-dup unique visitors across dynamic IPs.
CREATE TABLE IF NOT EXISTS download_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,                        -- 'download' | 'view'
  file text NOT NULL DEFAULT '',             -- exe filename for downloads
  version text NOT NULL DEFAULT '',
  ip_hash text NOT NULL DEFAULT '',
  visitor_id text NOT NULL DEFAULT '',
  user_agent text NOT NULL DEFAULT '',
  referer text NOT NULL DEFAULT '',
  path text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS download_events_kind_time_idx ON download_events(kind,created_at DESC);
CREATE INDEX IF NOT EXISTS download_events_time_idx ON download_events(created_at DESC);
CREATE INDEX IF NOT EXISTS download_events_iphash_idx ON download_events(ip_hash);
CREATE INDEX IF NOT EXISTS download_events_visitor_idx ON download_events(visitor_id);
