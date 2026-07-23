-- Keep the login identifier and contact email separate. Existing accounts and
-- operator-created users may have no email; every new public registration
-- supplies one through the API.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq
  ON users(lower(email)) WHERE email IS NOT NULL;
