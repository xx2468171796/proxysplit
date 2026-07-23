-- Keep the background payment reconciler fast as the order table grows.
CREATE INDEX IF NOT EXISTS orders_pending_reconcile_idx
  ON orders(updated_at)
  WHERE status='pending';
