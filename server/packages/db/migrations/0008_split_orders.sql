-- Split payment: an order over the per-transaction cap is broken into a group
-- of sub-orders that are paid separately. The membership is granted once, when
-- every sub-order in the group is paid.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS group_id uuid;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS split_index integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS split_total integer;
CREATE INDEX IF NOT EXISTS orders_group_idx ON orders(group_id);
