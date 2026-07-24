-- 普通会员与超级会员只按同时在线设备数区分。
-- 协议、分流规则、自定义线路等产品能力对所有有效套餐一致开放。
UPDATE plans
SET features = '["proxy","rules","custom-lines","all-protocols"]'::jsonb,
    description = CASE
      WHEN code = 'standard-month' THEN '完整功能与全部支持协议，同时支持 3 台设备在线。'
      WHEN code = 'standard-quarter' THEN '完整功能与全部支持协议，3 台设备，连续使用 90 天。'
      WHEN code = 'standard-year' THEN '完整功能与全部支持协议，3 台设备，连续使用 365 天。'
      WHEN code = 'premium-month' THEN '功能与普通会员一致，同时支持 8 台设备在线。'
      WHEN code = 'premium-quarter' THEN '功能与普通会员一致，8 台设备，连续使用 90 天。'
      WHEN code = 'premium-year' THEN '功能与普通会员一致，8 台设备，连续使用 365 天。'
      WHEN code = 'activity-lifetime-buyout' THEN '一次购买永久有效，完整功能与全部支持协议，同时支持 8 台设备在线。'
      ELSE description
    END,
    updated_at = now()
WHERE code IN (
  'trial',
  'standard-month','standard-quarter','standard-year',
  'premium-month','premium-quarter','premium-year',
  'activity-lifetime-buyout'
);
