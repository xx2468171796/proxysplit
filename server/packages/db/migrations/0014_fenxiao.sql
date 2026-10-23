-- 多级分销 / 经销商返佣（公司 SDK tuiguang/fenxiao 1.8.x 的参考建表 sql/fenxiao.sql，原样照抄，列名不可改）。
-- 用户 id 列是 text（存 users.id::text），删除用户不级联：佣金与提现是账，留史。
-- 规则存 system_settings 的 fenxiao_policy（缺省 = 关），后台「分销」页改。

CREATE TABLE IF NOT EXISTS fx_members (
  user_id         text PRIMARY KEY,
  parent_user_id  text,
  ancestors       text[] NOT NULL DEFAULT '{}',
  code            text UNIQUE,
  tier_code       text,
  enabled         boolean NOT NULL DEFAULT true,
  rate_override   jsonb,
  note            text,
  bound_at        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fx_members_parent_idx ON fx_members (parent_user_id);
CREATE INDEX IF NOT EXISTS fx_members_ancestors_gin ON fx_members USING gin (ancestors);
CREATE INDEX IF NOT EXISTS fx_members_tier_idx ON fx_members (tier_code) WHERE tier_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS fx_commissions (
  id                   bigserial PRIMARY KEY,
  source_kind          text NOT NULL,
  source_ref           text NOT NULL,
  buyer_user_id        text NOT NULL,
  beneficiary_user_id  text NOT NULL,
  level                int NOT NULL,
  base_amount          bigint NOT NULL,
  rate_bps             int NOT NULL,
  amount               bigint NOT NULL,
  status               text NOT NULL,
  available_at         timestamptz NOT NULL,
  reversed_at          timestamptz,
  reverse_reason       text,
  policy_snapshot      jsonb NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_kind, source_ref, beneficiary_user_id)
);
CREATE INDEX IF NOT EXISTS fx_commissions_beneficiary_idx ON fx_commissions (beneficiary_user_id, id DESC);
CREATE INDEX IF NOT EXISTS fx_commissions_buyer_idx ON fx_commissions (buyer_user_id);
CREATE INDEX IF NOT EXISTS fx_commissions_due_idx ON fx_commissions (available_at) WHERE status = 'frozen';
CREATE INDEX IF NOT EXISTS fx_commissions_created_idx ON fx_commissions (created_at);

CREATE TABLE IF NOT EXISTS fx_accounts (
  user_id      text PRIMARY KEY,
  frozen       bigint NOT NULL DEFAULT 0,
  available    bigint NOT NULL DEFAULT 0,
  withdrawing  bigint NOT NULL DEFAULT 0,
  withdrawn    bigint NOT NULL DEFAULT 0,
  earned       bigint NOT NULL DEFAULT 0,
  reversed     bigint NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fx_withdrawals (
  id           bigserial PRIMARY KEY,
  user_id      text NOT NULL,
  amount       bigint NOT NULL CHECK (amount > 0),
  status       text NOT NULL DEFAULT 'pending',
  payee        jsonb NOT NULL,
  admin_note   text,
  reviewed_by  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS fx_withdrawals_user_idx ON fx_withdrawals (user_id, id DESC);
CREATE INDEX IF NOT EXISTS fx_withdrawals_pending_idx ON fx_withdrawals (id) WHERE status = 'pending';
