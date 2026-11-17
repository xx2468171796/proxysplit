-- 审计第二轮 2026-11-18：同事节点上报（docs/节点上报.md）本来只给公司员工用，实际是每个客户端都在报、匿名的也收。
-- users.staff = 公司员工账号：只有它的上报才入库。后台用户详情由超级管理员开关（审计 admin.user.staff）。
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff boolean NOT NULL DEFAULT false;

-- 现有管理员都是公司的人：默认算员工。普通账号一律不是，需要的由超管逐个打开。
UPDATE users SET staff=true WHERE role='admin' AND staff=false;

-- 已经收进来的非员工 / 匿名设备的清单这里不删（删了找不回来，等业主决定）；后台「同事节点」统计里能看到有多少。
