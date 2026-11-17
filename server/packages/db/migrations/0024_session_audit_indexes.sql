-- 审计 2026-11-18：几个按外键 / 归属查询的热路径没有索引，表一大就是全表扫。
-- 迁移脚本在事务里跑，不能用 CONCURRENTLY；建索引期间这几张表短暂挡写（当前数据量下是秒级）。

-- sessions：吊销某用户全部会话（封禁 / 改密 / 强制下线）、解绑设备时的级联删除、按用户 / 设备查会话。
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_device_idx ON sessions(device_id);
-- 会话保留期清理（API 进程定时跑，core session-retention.ts）：按已消费时间删旧行。
CREATE INDEX IF NOT EXISTS sessions_consumed_idx ON sessions(consumed_at) WHERE consumed_at IS NOT NULL;

-- audit_logs：后台按操作人筛选、用户详情里「这个人做过什么」。
CREATE INDEX IF NOT EXISTS audit_actor_created_idx ON audit_logs(actor_user_id, created_at DESC);

-- users：官网注册时「同一 IP 已注册几个号」的计数（每次注册都查）。
CREATE INDEX IF NOT EXISTS users_registration_ip_idx ON users(registration_ip_hash);
