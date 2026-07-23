import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Pool } from 'pg'
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')
const migrationsDir=join(dirname(fileURLToPath(import.meta.url)), '../migrations')
const files=(await readdir(migrationsDir)).filter(x=>/^\d+_.+\.sql$/.test(x)).sort()
const pool = new Pool({connectionString:url})
try {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
  for(const name of files){
    const exists=await pool.query('SELECT 1 FROM schema_migrations WHERE name=$1',[name])
    if(exists.rowCount)continue
    const sql=await readFile(join(migrationsDir,name),'utf8')
    const client=await pool.connect()
    try{
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations(name) VALUES($1)',[name])
      await client.query('COMMIT')
      console.log(`migration applied: ${name}`)
    }catch(error){
      await client.query('ROLLBACK')
      throw error
    }finally{client.release()}
  }
} finally { await pool.end() }
