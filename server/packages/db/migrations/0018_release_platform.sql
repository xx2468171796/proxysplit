-- macOS 版（2026-10-28）：发版按平台分开。同一个版本号 Windows 一条（.exe）、macOS 一条（.zip），
-- 老数据都是 windows；/v1/releases/latest 不带 platform 时按 windows（老客户端不变）。
ALTER TABLE releases ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'windows';
ALTER TABLE releases DROP CONSTRAINT IF EXISTS releases_version_key;
CREATE UNIQUE INDEX IF NOT EXISTS releases_version_platform_uq ON releases(version, platform);
CREATE INDEX IF NOT EXISTS releases_platform_channel_idx ON releases(platform, channel);
