-- ProxySplit v1.9.1 正式套餐与当前支付方式。
-- 季卡按 3 个月原价 9 折，年卡按 12 个月原价 75 折。

UPDATE plans
SET active = false, public = false, updated_at = now()
WHERE code <> 'trial';

INSERT INTO plans(
  code,name,description,tier,billing_cycle,duration_days,lifetime,
  price_cents,original_price_cents,currency,max_devices,features,
  active,public,sort_order,badge,sale_starts_at,sale_ends_at,purchase_limit_per_user
) VALUES
  (
    'standard-month','普通会员月卡','适合个人使用，同时支持 3 台设备在线。',
    'standard','month',30,false,1590,NULL,'CNY',3,
    '["proxy","rules","http","https","socks"]',
    true,true,10,'月卡',NULL,NULL,NULL
  ),
  (
    'standard-quarter','普通会员季卡','普通会员 90 天，按月卡总价优惠 10%。',
    'standard','quarter',90,false,4293,4770,'CNY',3,
    '["proxy","rules","http","https","socks"]',
    true,true,20,'省 10%',NULL,NULL,NULL
  ),
  (
    'standard-year','普通会员年卡','普通会员 365 天，按月卡总价优惠 25%。',
    'standard','year',365,false,14310,19080,'CNY',3,
    '["proxy","rules","http","https","socks"]',
    true,true,30,'省 25%',NULL,NULL,NULL
  ),
  (
    'premium-month','超级会员月卡','全部主流协议与高级功能，同时支持 8 台设备在线。',
    'premium','month',30,false,2590,NULL,'CNY',8,
    '["proxy","rules","custom-lines","priority-support","all-protocols"]',
    true,true,40,'月卡',NULL,NULL,NULL
  ),
  (
    'premium-quarter','超级会员季卡','超级会员 90 天，按月卡总价优惠 10%。',
    'premium','quarter',90,false,6993,7770,'CNY',8,
    '["proxy","rules","custom-lines","priority-support","all-protocols"]',
    true,true,50,'省 10%',NULL,NULL,NULL
  ),
  (
    'premium-year','超级会员年卡','超级会员 365 天，按月卡总价优惠 25%。',
    'premium','year',365,false,23310,31080,'CNY',8,
    '["proxy","rules","custom-lines","priority-support","all-protocols"]',
    true,true,60,'省 25%',NULL,NULL,NULL
  )
ON CONFLICT(code) DO UPDATE SET
  name=excluded.name,
  description=excluded.description,
  tier=excluded.tier,
  billing_cycle=excluded.billing_cycle,
  duration_days=excluded.duration_days,
  lifetime=excluded.lifetime,
  price_cents=excluded.price_cents,
  original_price_cents=excluded.original_price_cents,
  currency=excluded.currency,
  max_devices=excluded.max_devices,
  features=excluded.features,
  active=excluded.active,
  public=excluded.public,
  sort_order=excluded.sort_order,
  badge=excluded.badge,
  sale_starts_at=excluded.sale_starts_at,
  sale_ends_at=excluded.sale_ends_at,
  purchase_limit_per_user=excluded.purchase_limit_per_user,
  updated_at=now();

INSERT INTO plans(
  code,name,description,tier,billing_cycle,duration_days,lifetime,
  price_cents,original_price_cents,currency,max_devices,features,
  active,public,sort_order,badge,sale_starts_at,sale_ends_at,purchase_limit_per_user
) VALUES (
  'activity-lifetime-buyout','限时买断版',
  '当前活动开放两个月；一次购买永久有效，享受超级会员权益并支持 8 台设备在线。',
  'premium','lifetime',NULL,true,29900,46620,'CNY',8,
  '["proxy","rules","custom-lines","priority-support","all-protocols"]',
  true,true,70,'两个月限时买断',now(),now()+interval '2 months',1
)
ON CONFLICT(code) DO UPDATE SET
  name=excluded.name,
  description=excluded.description,
  tier=excluded.tier,
  billing_cycle=excluded.billing_cycle,
  duration_days=excluded.duration_days,
  lifetime=excluded.lifetime,
  price_cents=excluded.price_cents,
  original_price_cents=excluded.original_price_cents,
  currency=excluded.currency,
  max_devices=excluded.max_devices,
  features=excluded.features,
  active=excluded.active,
  public=excluded.public,
  sort_order=excluded.sort_order,
  badge=excluded.badge,
  sale_starts_at=excluded.sale_starts_at,
  sale_ends_at=excluded.sale_ends_at,
  purchase_limit_per_user=excluded.purchase_limit_per_user,
  updated_at=now();

UPDATE plans
SET max_devices=3, duration_days=3, updated_at=now()
WHERE code='trial';

INSERT INTO system_settings(key,value,description)
VALUES ('payment_methods','["alipay"]','客户端当前允许展示和使用的支付方式')
ON CONFLICT(key) DO UPDATE SET value=excluded.value,description=excluded.description,updated_at=now();

UPDATE payment_providers
SET display_name='支付宝',
    config=coalesce(config,'{}'::jsonb)||'{"paymentMethods":["alipay"]}'::jsonb,
    updated_at=now()
WHERE code='zhongzhuan-prod';
