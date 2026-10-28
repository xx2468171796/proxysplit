// 配置云同步（会员专属）：每用户一份，AES-256-GCM 加密存库，version 乐观锁。
// 表 config_sync（migrations/0019_free_sync_phone.sql）；合同 docs/plan-2026-10-29-free-sync-phone.md「配置同步」。
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { AppError } from '@proxysplit/shared'
import type { Db } from './telemetry-store.js'

export type Sealed = { ciphertext: Buffer; iv: Buffer; tag: Buffer }
/** 密钥 CONFIG_SYNC_KEY（32 字节 base64）；没配时同步 / 云端配置返回 503。 */
export class SyncCipher {
  private readonly key: Buffer | null
  constructor(keyBase64: string | undefined) {
    const key = keyBase64 ? Buffer.from(keyBase64, 'base64') : null
    if (key && key.length !== 32) throw new Error('CONFIG_SYNC_KEY must be 32 bytes (base64)')
    this.key = key
  }
  get enabled() { return this.key !== null }
  private need() { if (!this.key) throw new AppError('SYNC_UNAVAILABLE', '云同步暂不可用', 503); return this.key }
  seal(text: string): Sealed {
    const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', this.need(), iv)
    const ciphertext = Buffer.concat([c.update(text, 'utf8'), c.final()])
    return { ciphertext, iv, tag: c.getAuthTag() }
  }
  open(s: Sealed): string {
    const d = createDecipheriv('aes-256-gcm', this.need(), s.iv)
    d.setAuthTag(s.tag)
    return Buffer.concat([d.update(s.ciphertext), d.final()]).toString('utf8')
  }
}

/** 乐观锁：云端没有时 baseVersion 必须是 0；有时必须等于当前 version。 */
export function syncDecision(current: number | null, baseVersion: number): 'insert' | 'update' | 'conflict' {
  if (current === null) return baseVersion === 0 ? 'insert' : 'conflict'
  return baseVersion === current ? 'update' : 'conflict'
}

export type SyncMeta = { exists: boolean; version: number; updatedAt: Date | null; deviceName: string; size: number }
const EMPTY: SyncMeta = { exists: false, version: 0, updatedAt: null, deviceName: '', size: 0 }
type Row = Record<string, unknown>
const toMeta = (r: Row | undefined): SyncMeta => r ? { exists: true, version: Number(r.version), updatedAt: new Date(r.updatedAt as string | Date), deviceName: String(r.deviceName ?? ''), size: Number(r.size) } : EMPTY
const META = 'version,updated_at AS "updatedAt",device_name AS "deviceName",size'

export class ConfigSyncStore {
  constructor(private db: Db, private cipher: SyncCipher) {}
  async meta(userId: string): Promise<SyncMeta> {
    const r = await this.db.query(`SELECT ${META} FROM config_sync WHERE user_id=$1`, [userId])
    return toMeta(r.rows[0])
  }
  async get(userId: string): Promise<SyncMeta & { payload?: string }> {
    const r = await this.db.query(`SELECT ${META},ciphertext,iv,tag FROM config_sync WHERE user_id=$1`, [userId])
    const row = r.rows[0]
    if (!row) return EMPTY
    return { ...toMeta(row), payload: this.cipher.open({ ciphertext: row.ciphertext as Buffer, iv: row.iv as Buffer, tag: row.tag as Buffer }) }
  }
  /** 成功 version+1；版本对不上返回 conflict + 云端当前元数据。 */
  async put(userId: string, payload: string, baseVersion: number, deviceName: string): Promise<{ ok: true; meta: SyncMeta } | { ok: false; current: SyncMeta }> {
    const s = this.cipher.seal(payload), size = Buffer.byteLength(payload, 'utf8')
    const c = await this.db.connect()
    let row: Row | undefined
    try {
      await c.query('BEGIN')
      const cur = await c.query('SELECT version FROM config_sync WHERE user_id=$1 FOR UPDATE', [userId])
      const verdict = syncDecision(cur.rows[0] ? Number(cur.rows[0].version) : null, baseVersion)
      if (verdict === 'insert') {
        const r = await c.query(`INSERT INTO config_sync(user_id,ciphertext,iv,tag,version,size,device_name) VALUES($1,$2,$3,$4,1,$5,$6)
          ON CONFLICT(user_id) DO NOTHING RETURNING ${META}`, [userId, s.ciphertext, s.iv, s.tag, size, deviceName])
        row = r.rows[0]
      } else if (verdict === 'update') {
        const r = await c.query(`UPDATE config_sync SET ciphertext=$2,iv=$3,tag=$4,version=version+1,size=$5,device_name=$6,updated_at=now()
          WHERE user_id=$1 AND version=$7 RETURNING ${META}`, [userId, s.ciphertext, s.iv, s.tag, size, deviceName, baseVersion])
        row = r.rows[0]
      }
      await c.query(row ? 'COMMIT' : 'ROLLBACK')
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e } finally { c.release() }
    return row ? { ok: true, meta: toMeta(row) } : { ok: false, current: await this.meta(userId) }
  }
  async remove(userId: string) {
    await this.db.query('DELETE FROM config_sync WHERE user_id=$1', [userId])
    return { ok: true }
  }
}
