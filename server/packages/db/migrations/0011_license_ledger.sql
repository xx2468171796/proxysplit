-- Entitlement ledger: one row per grant (paid order, redeem code, admin grant)
-- recording exactly which stretch of the member's timeline it added. Licenses
-- stack several grants on one row per user and tier, so a refund cannot just
-- subtract the order's days (time already used, or a lapse in between, would
-- be charged twice); with start_at / end_at it removes only what is unused.
CREATE TABLE IF NOT EXISTS license_grants(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  license_id uuid REFERENCES licenses(id) ON DELETE SET NULL,
  tier text NOT NULL,
  source text NOT NULL,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  group_id uuid,
  start_at timestamptz NOT NULL,        -- where the added time begins
  end_at timestamptz,                   -- where it ends; NULL = made the license lifetime
  before_expires_at timestamptz,        -- the license before this grant (for lifetime refunds)
  before_lifetime boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoke_reason text
);
CREATE INDEX IF NOT EXISTS license_grants_order_idx ON license_grants(order_id);
CREATE INDEX IF NOT EXISTS license_grants_user_idx ON license_grants(user_id, tier);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_reason text;
