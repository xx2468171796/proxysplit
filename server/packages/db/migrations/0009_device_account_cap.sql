-- Per-device registration cap: record the hardware the account was registered
-- from so registration can be limited per device (anti-abuse / trial farming).
ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_hardware_hash text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS users_reg_hardware_idx ON users(registration_hardware_hash);
