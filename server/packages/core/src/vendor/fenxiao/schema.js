/**
 * 建表 SQL(PostgreSQL ≥ 13)。整段幂等:新库直接建;从 tuiguang/fenxiao(1.8.x)的四张表升级也跑这一段(只加列 / 加表)。
 * 表名是默认名;改了 tables 选项的宿主把表名替换后再跑。
 *
 * 这几个约束一个不能少(少了不报错,只会发错钱):
 *   fx_members.user_id 主键          → 并发注册不会绑两个上级
 *   fx_members.code 唯一             → 两人同码,佣金发错人
 *   fx_commissions (source_kind, source_ref, beneficiary_user_id) 唯一 → 回调重放不会发两次
 *   fx_accounts.user_id 主键         → 余额只有一行,提现靠行锁防超提
 *   fx_applications 每人只有一条 pending(部分唯一索引)
 *   fx_sources 主键                 → 结算和退款按来源排队:退款先到也能拦住后到的结算,并发结算只成一次
 */
export const FENXIAO_SQL = `
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
ALTER TABLE fx_commissions ADD COLUMN IF NOT EXISTS product_key text;
ALTER TABLE fx_commissions ADD COLUMN IF NOT EXISTS hold_reason text;
ALTER TABLE fx_commissions ADD COLUMN IF NOT EXISTS note text;
CREATE INDEX IF NOT EXISTS fx_commissions_beneficiary_idx ON fx_commissions (beneficiary_user_id, id DESC);
CREATE INDEX IF NOT EXISTS fx_commissions_buyer_idx ON fx_commissions (buyer_user_id);
CREATE INDEX IF NOT EXISTS fx_commissions_due_idx ON fx_commissions (available_at) WHERE status = 'frozen';
CREATE INDEX IF NOT EXISTS fx_commissions_held_idx ON fx_commissions (id) WHERE status = 'held';
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
ALTER TABLE fx_accounts ADD COLUMN IF NOT EXISTS held bigint NOT NULL DEFAULT 0;

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
ALTER TABLE fx_withdrawals ADD COLUMN IF NOT EXISTS fee bigint NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS fx_withdrawals_user_idx ON fx_withdrawals (user_id, id DESC);
CREATE INDEX IF NOT EXISTS fx_withdrawals_pending_idx ON fx_withdrawals (id) WHERE status = 'pending';

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

CREATE TABLE IF NOT EXISTS fx_sources (
  source_kind  text NOT NULL,
  source_ref   text NOT NULL,
  state        text NOT NULL,
  reason       text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_kind, source_ref)
);

CREATE TABLE IF NOT EXISTS fx_audit (
  id              bigserial PRIMARY KEY,
  actor_id        text NOT NULL,
  action          text NOT NULL,
  target_user_id  text,
  detail          jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fx_audit_target_idx ON fx_audit (target_user_id, id DESC);
`;
