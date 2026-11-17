-- 会员收款改走公司统一支付中心 zhifu-service（PAY_MODE=center，公司包 zhifu 6.17.1 的 zhifu/site）。
-- 中心按站点路由通道（目前只有微信），本站不选通道、不拆单：一笔订单 = 中心一笔订单。
-- 老的中转站网关 zhongzhuan-prod 保留（历史订单查单 / 退款 / 迟到回调照旧），只是不再是当前通道。

-- 中心订单簿（SDK 的 SiteOrderBook）：中心站点单号 → 本地订单号 / 用户 / 金额。
-- 回调到达时 SDK 先按这里核对用户与金额，再交给 fulfillPaidOrder 落地。
CREATE TABLE IF NOT EXISTS pay_center_orders(
  site_order_no text PRIMARY KEY,
  order_no text NOT NULL REFERENCES orders(order_no),
  user_id uuid NOT NULL REFERENCES users(id),
  amount_cents int NOT NULL CHECK (amount_cents > 0),
  meta jsonb NOT NULL DEFAULT '{}',
  discarded text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pay_center_orders_order_no ON pay_center_orders(order_no);

-- 中心回调去重（notify_id 唯一；SDK DedupeStore.claim / release）。真正防重复发放的仍是 payment_events。
CREATE TABLE IF NOT EXISTS pay_center_notifies(
  notify_id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO payment_providers(code,display_name,adapter,endpoint,credential_ref,enabled,config)
VALUES('zhifu-center','统一支付中心','center','https://zfzx.zygskins.cn','PAY_CENTER',true,'{"orderTimeoutMinutes":10}')
ON CONFLICT(code) DO NOTHING;

UPDATE system_settings SET value='"zhifu-center"'::jsonb,updated_at=now() WHERE key='active_payment_provider';
