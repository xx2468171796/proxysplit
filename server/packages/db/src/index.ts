import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.js'
export * from './schema.js'
export function createDatabase(url: string) {
  const pool = new Pool({ connectionString: url, max: 20, idleTimeoutMillis: 30_000 })
  return { db: drizzle(pool, { schema }), pool }
}
