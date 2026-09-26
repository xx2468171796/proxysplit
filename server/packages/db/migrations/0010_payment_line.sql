-- Gateway 收款线路 selection and per-order payment details.
--
-- The zhongzhuan gateway fronts several 收款主体 and picks one per order unless
-- the request names a line. checkout_url is the desktop cashier page (the QR
-- link only shows "open on your phone" in a PC browser); merchant_name records
-- which account actually took the order, so "paid but not credited" reports
-- can be traced to the right merchant back office.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS checkout_url text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS merchant_name text;

-- 2026-09-26: collect through line 4 = 支付宝直连 (收款主体 宣时龙; supports split
-- orders and any amount) instead of letting the gateway choose. Editable later
-- via the provider's config.line in the admin panel.
UPDATE payment_providers SET config = config || '{"line":4}'::jsonb, updated_at = now()
WHERE code = 'zhongzhuan-prod' AND NOT (config ? 'line');
