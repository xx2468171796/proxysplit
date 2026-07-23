import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Pool } from 'pg'
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')
const sql = await readFile(join(dirname(fileURLToPath(import.meta.url)), '../migrations/0001_init.sql'),'utf8')
const pool = new Pool({connectionString:url})
try { await pool.query(sql); console.log('migration applied') } finally { await pool.end() }
