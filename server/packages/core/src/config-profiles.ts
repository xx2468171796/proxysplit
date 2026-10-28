// 云端命名配置（会员专属）：另存多份、恢复密码、分享码 + 分享密码导入。
// 表 config_profiles / config_attempts（migrations/0019_free_sync_phone.sql）；合同 docs/plan-2026-10-29-free-sync-phone.md 补充合同 7–10。
import { randomBytes } from 'node:crypto'
import { verify } from 'argon2'
import { AppError } from '@proxysplit/shared'
import { hashPassword } from './auth.js'
import type { SyncCipher } from './config-sync.js'
import type { Db } from './telemetry-store.js'

/** 分享码：8 位大写字母数字，去掉 I / O / 0 / 1。 */
export const SHARE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const genShareCode = () => { const b = randomBytes(8); let s = ''; for (let i = 0; i < 8; i++) s += SHARE_ALPHABET.charAt((b[i] ?? 0) % SHARE_ALPHABET.length); return s }
/** 限流与失败锁：每用户 10 次 / 10 分钟导入、每码 20 次失败 / 小时、每份恢复密码 10 次失败 / 10 分钟。 */
export const LIMITS = {
  shareUser: { max: 10, windowMs: 10 * 60_000 },
  shareCode: { max: 20, windowMs: 60 * 60_000 },
  restore: { max: 10, windowMs: 10 * 60_000 },
} as const
type AttemptKind = 'share_user' | 'share_code' | 'restore'

type Row = Record<string, unknown>
export type ProfileItem = { id: string; name: string; deviceName: string; size: number; updatedAt: Date; shared: boolean; shareCode?: string; locked: boolean }
const toItem = (r: Row): ProfileItem => ({
  id: String(r.id), name: String(r.name), deviceName: String(r.deviceName ?? ''), size: Number(r.size), updatedAt: new Date(r.updatedAt as string | Date),
  shared: !!r.shareCode, ...(r.shareCode ? { shareCode: String(r.shareCode) } : {}), locked: !!r.restoreHash,
})
const COLS = 'id,name,device_name AS "deviceName",size,updated_at AS "updatedAt",share_code AS "shareCode",restore_password_hash AS "restoreHash"'
const notFound = () => new AppError('NOT_FOUND', '配置不存在', 404)
const checkPassword = (hash: string, password: string) => verify(hash, password).catch(() => false)

export class ConfigProfilesStore {
  constructor(private db: Db, private cipher: SyncCipher) {}
  /** 失败（或全部尝试）次数是否已到上限。 */
  private async blocked(kind: AttemptKind, subject: string, onlyFailures: boolean) {
    const lim = LIMITS[kind === 'share_user' ? 'shareUser' : kind === 'share_code' ? 'shareCode' : 'restore']
    const r = await this.db.query(`SELECT count(*)::int AS n FROM config_attempts WHERE kind=$1 AND subject=$2 AND created_at>$3${onlyFailures ? ' AND ok=false' : ''}`,
      [kind, subject, new Date(Date.now() - lim.windowMs)])
    return Number(r.rows[0]?.n ?? 0) >= lim.max
  }
  private async record(kind: AttemptKind, subject: string, ok: boolean) {
    await this.db.query('INSERT INTO config_attempts(kind,subject,ok) VALUES($1,$2,$3)', [kind, subject, ok])
    if (Math.random() < 0.01) await this.db.query(`DELETE FROM config_attempts WHERE created_at<now()-interval '1 day'`).catch(() => {})
  }
  private async row(userId: string, id: string) {
    const r = await this.db.query(`SELECT ${COLS},ciphertext,iv,tag FROM config_profiles WHERE id=$1 AND user_id=$2`, [id, userId])
    const row = r.rows[0]; if (!row) throw notFound(); return row
  }
  private open(row: Row) { return this.cipher.open({ ciphertext: row.ciphertext as Buffer, iv: row.iv as Buffer, tag: row.tag as Buffer }) }
  /** 恢复密码校验：错一次记一次，10 分钟 10 次后锁住。 */
  private async checkRestore(id: string, hash: string, password: string | undefined) {
    if (await this.blocked('restore', id, true)) throw new AppError('RESTORE_LOCKED', '恢复密码错误次数过多，请 10 分钟后再试', 429)
    if (password && await checkPassword(hash, password)) return
    await this.record('restore', id, false)
    throw new AppError('RESTORE_PASSWORD_WRONG', '恢复密码不正确', 403)
  }

  async list(userId: string) {
    const r = await this.db.query(`SELECT ${COLS} FROM config_profiles WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 100`, [userId])
    return r.rows.map(toItem)
  }
  async create(userId: string, input: { name: string; payload: string }, deviceName: string, quota: number) {
    const s = this.cipher.seal(input.payload)
    const c = await this.db.connect()
    try {
      await c.query('BEGIN')
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['profiles:' + userId])
      const n = await c.query('SELECT count(*)::int AS n FROM config_profiles WHERE user_id=$1', [userId])
      if (Number(n.rows[0]?.n ?? 0) >= quota) throw new AppError('PROFILE_QUOTA', `当前会员最多保存 ${quota} 份配置`, 403)
      const r = await c.query(`INSERT INTO config_profiles(user_id,name,ciphertext,iv,tag,size,device_name) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${COLS}`,
        [userId, input.name, s.ciphertext, s.iv, s.tag, Buffer.byteLength(input.payload, 'utf8'), deviceName])
      await c.query('COMMIT')
      const row = r.rows[0]; if (!row) throw notFound(); return toItem(row)
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e } finally { c.release() }
  }
  async update(userId: string, id: string, input: { name?: string | undefined; payload?: string | undefined }, deviceName: string) {
    const s = input.payload !== undefined ? this.cipher.seal(input.payload) : null
    const r = await this.db.query(`UPDATE config_profiles SET name=coalesce($3,name),ciphertext=coalesce($4,ciphertext),iv=coalesce($5,iv),tag=coalesce($6,tag),
      size=coalesce($7,size),device_name=CASE WHEN $4::bytea IS NULL THEN device_name ELSE $8 END,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING ${COLS}`,
      [id, userId, input.name ?? null, s?.ciphertext ?? null, s?.iv ?? null, s?.tag ?? null, input.payload !== undefined ? Buffer.byteLength(input.payload, 'utf8') : null, deviceName])
    const row = r.rows[0]; if (!row) throw notFound(); return toItem(row)
  }
  /** GET /:id 与 POST /:id/restore：设了恢复密码必须给对。 */
  async restore(userId: string, id: string, password: string | undefined) {
    const row = await this.row(userId, id)
    if (row.restoreHash) await this.checkRestore(id, String(row.restoreHash), password)
    return { ...toItem(row), payload: this.open(row) }
  }
  async setRestorePassword(userId: string, id: string, input: { password: string | null; currentPassword?: string | undefined }) {
    const row = await this.row(userId, id)
    if (row.restoreHash) await this.checkRestore(id, String(row.restoreHash), input.currentPassword)
    const hash = input.password === null ? null : await hashPassword(input.password)
    await this.db.query('UPDATE config_profiles SET restore_password_hash=$3,updated_at=now() WHERE id=$1 AND user_id=$2', [id, userId, hash])
    return { ok: true, locked: hash !== null }
  }
  async remove(userId: string, id: string) {
    const r = await this.db.query('DELETE FROM config_profiles WHERE id=$1 AND user_id=$2', [id, userId])
    if (r.rowCount !== 1) throw notFound()
    return { ok: true }
  }
  async share(userId: string, id: string, password: string) {
    await this.row(userId, id)
    const hash = await hashPassword(password)
    for (let i = 0; i < 5; i++) {
      const code = genShareCode()
      try {
        const r = await this.db.query('UPDATE config_profiles SET share_code=$3,share_password_hash=$4,updated_at=now() WHERE id=$1 AND user_id=$2', [id, userId, code, hash])
        if (r.rowCount !== 1) throw notFound()
        return { shareCode: code }
      } catch (e) { if ((e as { code?: string }).code !== '23505') throw e }
    }
    throw new AppError('SHARE_CODE_EXHAUSTED', '生成分享码失败，请重试', 503)
  }
  async unshare(userId: string, id: string) {
    const r = await this.db.query('UPDATE config_profiles SET share_code=NULL,share_password_hash=NULL,updated_at=now() WHERE id=$1 AND user_id=$2', [id, userId])
    if (r.rowCount !== 1) throw notFound()
    return { ok: true }
  }
  /** 任何已登录用户凭分享码 + 密码导入；码不存在和密码错是同一个 404。 */
  async importShare(userId: string, shareCode: string, password: string) {
    if (await this.blocked('share_user', userId, false)) throw new AppError('RATE_LIMITED', '操作过于频繁，请 10 分钟后再试', 429)
    if (await this.blocked('share_code', shareCode, true)) throw new AppError('SHARE_LOCKED', '该分享码尝试次数过多，请 1 小时后再试', 429)
    const r = await this.db.query('SELECT name,ciphertext,iv,tag,share_password_hash AS "shareHash" FROM config_profiles WHERE share_code=$1', [shareCode])
    const row = r.rows[0]
    const ok = !!row?.shareHash && await checkPassword(String(row.shareHash), password)
    await this.record('share_user', userId, ok)
    if (!ok || !row) { await this.record('share_code', shareCode, false); throw new AppError('SHARE_INVALID', '分享码或密码不正确', 404) }
    return { name: String(row.name), payload: this.open(row) }
  }
}
