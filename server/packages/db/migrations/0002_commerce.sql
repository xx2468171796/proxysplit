-- ProxySplit commerce, trial, device self-service and announcement model.
-- This migration is intentionally additive so existing production users and
-- licenses continue to work.

ALTER TABLE plans ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'standard';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS billing_cycle text NOT NULL DEFAULT 'custom';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS duration_days int;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS lifetime boolean NOT NULL DEFAULT false;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS price_cents int NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS original_price_cents int;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'CNY';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT false;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS public boolean NOT NULL DEFAULT false;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 100;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS badge text NOT NULL DEFAULT '';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS sale_starts_at timestamptz;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS sale_ends_at timestamptz;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS purchase_limit_per_user int;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE plans SET code=CASE
  WHEN name='Basic' THEN 'basic-legacy'
  WHEN name='Professional' THEN 'professional-legacy'
  ELSE 'legacy-'||substr(id::text,1,8)
END WHERE code IS NULL;
UPDATE plans SET features='["proxy","rules","http","https","socks"]' WHERE code='basic-legacy';
UPDATE plans SET features='["proxy","rules","custom-lines","priority-support","all-protocols"]' WHERE code='professional-legacy';
ALTER TABLE plans ALTER COLUMN code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS plans_code_uq ON plans(code);
DO $$ BEGIN
  ALTER TABLE plans ADD CONSTRAINT plans_tier_check CHECK(tier IN ('trial','standard','premium'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE plans ADD CONSTRAINT plans_billing_cycle_check CHECK(billing_cycle IN ('trial','month','quarter','year','lifetime','custom'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE plans ADD CONSTRAINT plans_price_check CHECK(price_cents>=0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE plans ADD CONSTRAINT plans_purchase_limit_check CHECK(purchase_limit_per_user IS NULL OR purchase_limit_per_user>0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO plans(code,name,description,tier,billing_cycle,duration_days,lifetime,price_cents,max_devices,features,active,public,sort_order,badge)
VALUES
('trial','免费试用','新注册用户免费试用，由后台统一调整试用天数。','trial','trial',3,false,0,1,'["proxy","rules","http","https","socks"]',true,false,0,'免费'),
('standard-month','普通会员月卡','适合个人长期稳定使用。','standard','month',30,false,1990,3,'["proxy","rules","http","https","socks"]',false,true,10,'月卡'),
('standard-quarter','普通会员季卡','连续 90 天普通会员权益。','standard','quarter',90,false,4990,3,'["proxy","rules","http","https","socks"]',false,true,20,'季卡'),
('standard-year','普通会员年卡','连续 365 天普通会员权益。','standard','year',365,false,15900,3,'["proxy","rules","http","https","socks"]',false,true,30,'年卡'),
('standard-lifetime','普通会员永久版','一次开通，永久有效。','standard','lifetime',NULL,true,39900,3,'["proxy","rules","http","https","socks"]',false,true,40,'永久'),
('premium-month','超级会员月卡','更多设备和全部主流协议能力。','premium','month',30,false,3990,5,'["proxy","rules","custom-lines","priority-support","all-protocols"]',false,true,50,'超级'),
('premium-quarter','超级会员季卡','连续 90 天超级会员权益。','premium','quarter',90,false,9990,5,'["proxy","rules","custom-lines","priority-support","all-protocols"]',false,true,60,'超级'),
('premium-year','超级会员年卡','连续 365 天超级会员权益。','premium','year',365,false,29900,5,'["proxy","rules","custom-lines","priority-support","all-protocols"]',false,true,70,'推荐'),
('premium-lifetime','超级会员永久版','永久拥有超级会员权益。','premium','lifetime',NULL,true,69900,5,'["proxy","rules","custom-lines","priority-support","all-protocols"]',false,true,80,'永久')
ON CONFLICT(code) DO NOTHING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_started_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_ip_hash text NOT NULL DEFAULT '';

ALTER TABLE licenses ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'admin';
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS order_id uuid;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS lifetime boolean NOT NULL DEFAULT false;

ALTER TABLE devices ADD COLUMN IF NOT EXISTS hardware_hash text NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS unbound_at timestamptz;
ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_user_id_fingerprint_hash_key;
CREATE UNIQUE INDEX IF NOT EXISTS devices_active_user_fingerprint_idx
  ON devices(user_id,fingerprint_hash) WHERE revoked=false;

CREATE TABLE IF NOT EXISTS system_settings(
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text NOT NULL DEFAULT '',
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO system_settings(key,value,description) VALUES
('registration_enabled','true','是否开放普通用户注册'),
('trial_days','3','新注册账号免费试用天数，0 表示关闭试用'),
('trial_plan_code','"trial"','试用期使用的套餐代码'),
('default_device_limit','3','没有套餐覆盖时的默认设备上限'),
('license_lease_minutes','60','在线授权租约有效分钟数'),
('offline_grace_hours','6','服务不可用时允许离线继续使用的小时数'),
('active_payment_provider','"zhongzhuan-prod"','当前使用的支付通道代码')
ON CONFLICT(key) DO NOTHING;

CREATE TABLE IF NOT EXISTS trial_claims(
  hardware_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ip_hash text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS payment_providers(
  code text PRIMARY KEY,
  display_name text NOT NULL,
  adapter text NOT NULL,
  endpoint text NOT NULL DEFAULT '',
  merchant_id text NOT NULL DEFAULT '',
  credential_ref text NOT NULL DEFAULT '',
  config jsonb NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO payment_providers(code,display_name,adapter,endpoint,credential_ref,enabled,config)
VALUES('zhongzhuan-prod','生产收款（收钱吧）','zhongzhuan','https://zf.zygskins.cn','PAYMENT_ZHONGZHUAN',false,'{"orderTimeoutMinutes":10}')
ON CONFLICT(code) DO NOTHING;

CREATE TABLE IF NOT EXISTS orders(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no text UNIQUE NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  plan_id uuid NOT NULL REFERENCES plans(id),
  plan_name text NOT NULL,
  tier text NOT NULL,
  billing_cycle text NOT NULL,
  duration_days int,
  lifetime boolean NOT NULL DEFAULT false,
  amount_cents int NOT NULL CHECK(amount_cents>=0),
  currency text NOT NULL DEFAULT 'CNY',
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','closed','refunded','failed')),
  provider_code text NOT NULL REFERENCES payment_providers(code),
  provider_order_no text,
  pay_url text,
  paid_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_user_created_idx ON orders(user_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS orders_provider_order_uq ON orders(provider_code,provider_order_no) WHERE provider_order_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code text NOT NULL,
  event_id text NOT NULL,
  order_no text NOT NULL,
  payload_hash text NOT NULL,
  verified boolean NOT NULL,
  result text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_code,event_id)
);

CREATE TABLE IF NOT EXISTS announcements(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL DEFAULT 'notice' CHECK(type IN ('notice','maintenance','release')),
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  content text NOT NULL,
  version text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  pinned boolean NOT NULL DEFAULT false,
  published_at timestamptz NOT NULL DEFAULT now(),
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS announcements_public_idx ON announcements(active,published_at DESC);

ALTER TABLE releases ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';
ALTER TABLE releases ADD COLUMN IF NOT EXISTS summary text NOT NULL DEFAULT '';
ALTER TABLE releases ADD COLUMN IF NOT EXISTS changelog text NOT NULL DEFAULT '';
ALTER TABLE releases ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'stable';
