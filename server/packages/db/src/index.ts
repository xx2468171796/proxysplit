import { Pool } from 'pg'

// The store issues raw parameterized SQL against this pool; the SQL migrations
// under ./migrations are the single source of truth for the schema.
export function createDatabase(url: string) {
  const pool = new Pool({ connectionString: url, max: 20, idleTimeoutMillis: 30_000 })
  return { pool }
}
