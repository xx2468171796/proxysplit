-- 0008 已在 v1.9.38 部署并按文件名记入 schema_migrations，之后对 0008 追加的
-- download_events(created_at DESC) 索引不会在现有生产库重跑。用独立迁移把它补上，
-- 保证下载/浏览量按天聚合查询在已存在的库上也有索引可用（IF NOT EXISTS 幂等，
-- 全新库里 0008 已建、此处为空操作）。
CREATE INDEX IF NOT EXISTS download_events_time_idx ON download_events(created_at DESC);
