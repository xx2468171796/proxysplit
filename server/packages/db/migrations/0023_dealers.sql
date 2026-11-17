-- 代理站（2026-11-17）：AI 中转站的代理商子站 <slug>.claude.zygskins.cn 下载的客户端带代理商标识。
-- users.dealer：客户归属的代理商（'' = 主站 / 普通用户）。只在为空时写一次，且只给 aigw 渠道用户写。
ALTER TABLE users ADD COLUMN IF NOT EXISTS dealer text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS users_dealer_idx ON users(dealer) WHERE dealer<>'';

-- 代理商资料：brand / contact / enabled 从 aigw 公开接口拉取（最多 10 分钟刷新一次，失败保留缓存）；
-- commission_bps 是 ProxySplit 本地的分成比例（万分比，后台设置），拉取永远不覆盖它。
CREATE TABLE IF NOT EXISTS dealers (
  slug            text        PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]{2,30}$'),
  brand           text        NOT NULL DEFAULT '',
  contact         text        NOT NULL DEFAULT '',
  commission_bps  integer     NOT NULL DEFAULT 0 CHECK (commission_bps BETWEEN 0 AND 10000),
  enabled         boolean     NOT NULL DEFAULT false,
  fetched_at      timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 分成流水：每笔已付订单（拆单按整组）一行；gross = 实付分，bps 下单时快照。线下结算。
CREATE TABLE IF NOT EXISTS dealer_commissions (
  id                bigserial   PRIMARY KEY,
  dealer_slug       text        NOT NULL REFERENCES dealers(slug),
  user_id           uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source            text        NOT NULL UNIQUE,
  gross_cents       integer     NOT NULL CHECK (gross_cents >= 0),
  bps               integer     NOT NULL CHECK (bps BETWEEN 0 AND 10000),
  commission_cents  integer     NOT NULL CHECK (commission_cents >= 0),
  status            text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','settled','void')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  settled_at        timestamptz,
  note              text        NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS dealer_commissions_dealer_idx ON dealer_commissions(dealer_slug,created_at DESC);
CREATE INDEX IF NOT EXISTS dealer_commissions_status_idx ON dealer_commissions(status,created_at DESC);

-- 业主 2026-11-17：代理商 wen 分成 30%。资料等首次拉取补齐。
INSERT INTO dealers(slug,commission_bps) VALUES('wen',3000) ON CONFLICT (slug) DO NOTHING;
