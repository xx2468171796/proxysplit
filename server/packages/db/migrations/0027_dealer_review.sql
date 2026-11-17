-- 代理商分成防自刷（2026-11-18 第二轮审计）。
-- 1) 分成流水多一个状态 review（待复核）：买家与代理商本人账号、或与该代理商的多个付费客户同设备 / 同注册来源时，
--    先记成 review，不进应付；后台复核通过 → pending，作废 → void。规则在 core dealer.ts recordDealerCommissionInTx。
--    已有的流水状态不变。
ALTER TABLE dealer_commissions DROP CONSTRAINT IF EXISTS dealer_commissions_status_check;
ALTER TABLE dealer_commissions ADD CONSTRAINT dealer_commissions_status_check CHECK (status IN ('pending','review','settled','void'));

-- 2) 代理商本人的账号（后台填用户名，存账号 id）：用来判断「买家是不是代理商自己」。默认空 = 只按客户之间的重合判。
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS owner_user_ids uuid[] NOT NULL DEFAULT '{}';

-- 3) 按硬件摘要找「同一台设备上的其它账号」要用到的索引。
CREATE INDEX IF NOT EXISTS devices_hardware_idx ON devices(hardware_hash) WHERE hardware_hash<>'';
