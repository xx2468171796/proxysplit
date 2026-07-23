-- Per-account password failure protection. The nth five-failure batch locks
-- the account for n * 5 minutes (5, 10, 15, ...), consistently across API instances.
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count int NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lockout_level int NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_failed_login_count_nonnegative;
ALTER TABLE users ADD CONSTRAINT users_failed_login_count_nonnegative CHECK (failed_login_count >= 0);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_lockout_level_nonnegative;
ALTER TABLE users ADD CONSTRAINT users_lockout_level_nonnegative CHECK (lockout_level >= 0);
