-- 客户端日志全量上报（docs/memory/telemetry.md，事件目录 docs/telemetry-events.md）。
-- device_id = sha256('proxysplit-device-v1:'||指纹) 十六进制，等于 devices.fingerprint_hash，可直接关联账号设备。
-- 保留期由 API 进程定时清理（TELEMETRY_RETENTION_DAYS，默认 15 天，按 received_at 分批删）。

CREATE TABLE IF NOT EXISTS client_devices (
  device_id        text PRIMARY KEY,
  first_seen       timestamptz NOT NULL DEFAULT now(),
  last_seen        timestamptz NOT NULL DEFAULT now(),
  app_version      text NOT NULL DEFAULT '',
  core_version     text NOT NULL DEFAULT '',
  os               text NOT NULL DEFAULT '',
  arch             text NOT NULL DEFAULT '',
  account_id       uuid,                 -- 令牌核实过的账号（users.id）
  account_hint     text NOT NULL DEFAULT '', -- 客户端自报用户名（未核实，仅参考）
  last_ip          text NOT NULL DEFAULT '',
  last_status      text NOT NULL DEFAULT 'info', -- 最近一次 proxy.start 结果 ok|fail（没有则 info）
  last_error_code  text,
  last_start_at    timestamptz,
  events_count     bigint NOT NULL DEFAULT 0,
  log_bytes        bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS client_devices_last_seen_idx ON client_devices (last_seen DESC);
CREATE INDEX IF NOT EXISTS client_devices_version_idx ON client_devices (app_version, last_seen DESC);
CREATE INDEX IF NOT EXISTS client_devices_account_idx ON client_devices (account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_devices_fail_idx ON client_devices (last_seen DESC) WHERE last_status = 'fail';

CREATE TABLE IF NOT EXISTS client_events (
  id              bigserial PRIMARY KEY,
  event_id        uuid NOT NULL UNIQUE,  -- 客户端生成，重传去重
  device_id       text NOT NULL,
  account_id      uuid,
  session_id      text NOT NULL,
  seq             bigint NOT NULL DEFAULT 0,
  ts              timestamptz NOT NULL,  -- 客户端时间（超前 10 分钟以上按收到时间记）
  received_at     timestamptz NOT NULL DEFAULT now(),
  type            text NOT NULL,
  status          text NOT NULL,
  duration_ms     integer,
  error_code      text,
  error_text      text,
  app_version     text NOT NULL DEFAULT '',
  os              text NOT NULL DEFAULT '',
  schema_version  smallint NOT NULL DEFAULT 1,
  payload         jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS client_events_device_ts_idx ON client_events (device_id, ts DESC);
CREATE INDEX IF NOT EXISTS client_events_type_ts_idx ON client_events (type, ts DESC);
CREATE INDEX IF NOT EXISTS client_events_fail_idx ON client_events (ts DESC, type, error_code) WHERE status = 'fail';
CREATE INDEX IF NOT EXISTS client_events_received_idx ON client_events (received_at);
CREATE INDEX IF NOT EXISTS client_events_account_idx ON client_events (account_id, ts DESC) WHERE account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS client_log_chunks (
  id           bigserial PRIMARY KEY,
  chunk_id     uuid NOT NULL UNIQUE,     -- 由段文件名派生，重传去重
  device_id    text NOT NULL,
  session_id   text NOT NULL,
  started_at   timestamptz NOT NULL,
  ended_at     timestamptz NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  line_count   integer NOT NULL DEFAULT 0,
  bytes        integer NOT NULL DEFAULT 0,
  text         text NOT NULL             -- 已脱敏；PG TOAST 自动压缩
);
CREATE INDEX IF NOT EXISTS client_log_chunks_device_idx ON client_log_chunks (device_id, started_at DESC);
CREATE INDEX IF NOT EXISTS client_log_chunks_received_idx ON client_log_chunks (received_at);
