-- Admin manual fulfillment + redeem/activation codes.
-- Redeem codes are admin-issued and grant a plan (tier/devices/features) for an
-- optional duration override; redeeming reuses the same idempotent license grant
-- path as a paid order.

CREATE TABLE IF NOT EXISTS redeem_codes(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  plan_id uuid NOT NULL REFERENCES plans(id),
  duration_days integer,                       -- NULL when lifetime
  lifetime boolean NOT NULL DEFAULT false,
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',        -- active | disabled | used
  batch_id uuid,                                -- groups codes created together
  code_expires_at timestamptz,                  -- code validity window (NULL = never)
  redeemed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  redeemed_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT redeem_codes_term_ck CHECK (lifetime OR (duration_days IS NOT NULL AND duration_days >= 1))
);
CREATE INDEX IF NOT EXISTS redeem_codes_status_idx ON redeem_codes(status);
CREATE INDEX IF NOT EXISTS redeem_codes_batch_idx ON redeem_codes(batch_id);
