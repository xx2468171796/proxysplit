-- 分销换成公司分销包 fenxiao 0.1.0（yanzheng packages/fenxiao，取代 tuiguang/fenxiao）：只加列、加表，老数据不动。
-- 与包里 FENXIAO_SQL 的增量部分一致（来源登记、风控挂起、提现手续费、申请、审计）。

ALTER TABLE fx_commissions ADD COLUMN IF NOT EXISTS product_key text;
ALTER TABLE fx_commissions ADD COLUMN IF NOT EXISTS hold_reason text;
ALTER TABLE fx_commissions ADD COLUMN IF NOT EXISTS note text;
CREATE INDEX IF NOT EXISTS fx_commissions_held_idx ON fx_commissions (id) WHERE status = 'held';

ALTER TABLE fx_accounts ADD COLUMN IF NOT EXISTS held bigint NOT NULL DEFAULT 0;

ALTER TABLE fx_withdrawals ADD COLUMN IF NOT EXISTS fee bigint NOT NULL DEFAULT 0;

-- 结算和退款按来源排队：退款先到能拦住后到的结算，并发结算只成一次
CREATE TABLE IF NOT EXISTS fx_sources (
  source_kind  text NOT NULL,
  source_ref   text NOT NULL,
  state        text NOT NULL,
  reason       text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_kind, source_ref)
);

CREATE TABLE IF NOT EXISTS fx_applications (
  id           bigserial PRIMARY KEY,
  user_id      text NOT NULL,
  status       text NOT NULL DEFAULT 'pending',
  message      text,
  admin_note   text,
  reviewed_by  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS fx_applications_one_pending ON fx_applications (user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS fx_applications_status_idx ON fx_applications (status, id DESC);

CREATE TABLE IF NOT EXISTS fx_audit (
  id              bigserial PRIMARY KEY,
  actor_id        text NOT NULL,
  action          text NOT NULL,
  target_user_id  text,
  detail          jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fx_audit_target_idx ON fx_audit (target_user_id, id DESC);
