// 云端命名配置（会员专属）：另存多份、恢复密码、分享码 + 分享密码导入。
// 表 config_profiles / config_attempts（migrations/0019_free_sync_phone.sql）；合同 docs/plan-2026-10-29-free-sync-phone.md 补充合同 7–10。
import { randomBytes, randomUUID } from 'node:crypto'
import { verify } from 'argon2'
import { AppError } from '@proxysplit/shared'
import { hashPassword } from './auth.js'
import { profileAad, type SyncCipher } from './config-sync.js'
import type { Db } from './telemetry-store.js'

/** 分享码：8 位大写字母数字，去掉 I / O / 0 / 1。 */
export const SHARE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const genShareCode = () => { const b = randomBytes(8); let s = ''; for (let i = 0; i < 8; i++) s += SHARE_ALPHABET.charAt((b[i] ?? 0) % SHARE_ALPHABET.length); return s }
/**
 * 限流与失败锁：每用户 10 次 / 10 分钟导入；每 (码, IP) 10 次失败 / 小时；
 * 每码全局 100 次失败 / 小时（防一个人换 IP 也防别人恶意把码锁死）；每份恢复密码 10 次失败 / 10 分钟。
 */
export const LIMITS = {
  share_user: { max: 10, windowMs: 10 * 60_000, onlyFailures: false },
  share_code_ip: { max: 10, windowMs: 60 * 60_000, onlyFailures: true },
  share_code: { max: 100, windowMs: 60 * 60_000, onlyFailures: true },
  restore: { max: 10, windowMs: 10 * 60_000, onlyFailures: true },
} as const
type AttemptKind = keyof typeof LIMITS

type Row = Record<string, unknown>
type Q = Pick<Db, 'query'>
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
  private async tx<T>(fn: (c: Q) => Promise<T>): Promise<T> {
    const c = await this.db.connect()
    try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r }
    catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e } finally { c.release() }
  }
  /** 在事务里锁住 (kind, subject) 再计数，计数和后续记账原子。 */
  private async lockSubject(c: Q, kind: AttemptKind, subject: string) {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [kind + '|' + subject])
  }
  /** 失败（或全部尝试）次数是否已到上限。 */
  private async blocked(c: Q, kind: AttemptKind, subject: string) {
    const lim = LIMITS[kind]
    const r = await c.query(`SELECT count(*)::int AS n FROM config_attempts WHERE kind=$1 AND subject=$2 AND created_at>$3${lim.onlyFailures ? ' AND ok=false' : ''}`,
      [kind, subject, new Date(Date.now() - lim.windowMs)])
    return Number(r.rows[0]?.n ?? 0) >= lim.max
  }
  private async record(c: Q, kind: AttemptKind, subject: string, ok: boolean) {
    await c.query('INSERT INTO config_attempts(kind,subject,ok) VALUES($1,$2,$3)', [kind, subject, ok])
  }
  private async prune() {
    if (Math.random() < 0.01) await this.db.query(`DELETE FROM config_attempts WHERE created_at<now()-interval '1 day'`).catch(() => {})
  }
  private async row(userId: string, id: string) {
    const r = await this.db.query(`SELECT ${COLS},ciphertext,iv,tag FROM config_profiles WHERE id=$1 AND user_id=$2`, [id, userId])
    const row = r.rows[0]; if (!row) throw notFound(); return row
  }
  private open(row: Row) { return this.cipher.open({ ciphertext: row.ciphertext as Buffer, iv: row.iv as Buffer, tag: row.tag as Buffer }, profileAad(String(row.id))) }
  /** 恢复密码校验：锁 + 计数 + 校验 + 记失败在同一事务；10 分钟错 10 次锁住。 */
  private async checkRestore(id: string, hash: string, password: string | undefined) {
    const ok = await this.tx(async c => {
      await this.lockSubject(c, 'restore', id)
      if (await this.blocked(c, 'restore', id)) throw new AppError('RESTORE_LOCKED', '恢复密码错误次数过多，请 10 分钟后再试', 429)
      const good = !!password && await checkPassword(hash, password)
      if (!good) await this.record(c, 'restore', id, false)
      return good
    })
    if (!ok) throw new AppError('RESTORE_PASSWORD_WRONG', '恢复密码不正确', 403)
  }
  /** 改 / 分享 / 取消分享 / 删除 / 改恢复密码：设了恢复密码的配置必须先给对。 */
  private async unlock(userId: string, id: string, password: string | undefined) {
    const row = await this.row(userId, id)
    if (row.restoreHash) await this.checkRestore(id, String(row.restoreHash), password)
    return row
  }

  async list(userId: string) {
    const r = await this.db.query(`SELECT ${COLS} FROM config_profiles WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 100`, [userId])
    return r.rows.map(toItem)
  }
  async create(userId: string, input: { name: string; payload: string }, deviceName: string, quota: number) {
    const id = randomUUID(), s = this.cipher.seal(input.payload, profileAad(id))
    const row = await this.tx(async c => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['profiles:' + userId])
      const n = await c.query('SELECT count(*)::int AS n FROM config_profiles WHERE user_id=$1', [userId])
      if (Number(n.rows[0]?.n ?? 0) >= quota) throw new AppError('PROFILE_QUOTA', `当前会员最多保存 ${quota} 份配置`, 403)
      const r = await c.query(`INSERT INTO config_profiles(id,user_id,name,ciphertext,iv,tag,size,device_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${COLS}`,
        [id, userId, input.name, s.ciphertext, s.iv, s.tag, Buffer.byteLength(input.payload, 'utf8'), deviceName])
      return r.rows[0]
    })
    if (!row) throw notFound()
    return toItem(row)
  }
  async update(userId: string, id: string, input: { name?: string | undefined; payload?: string | undefined; password?: string | undefined }, deviceName: string) {
    await this.unlock(userId, id, input.password)
    const s = input.payload !== undefined ? this.cipher.seal(input.payload, profileAad(id)) : null
    const r = await this.db.query(`UPDATE config_profiles SET name=coalesce($3,name),ciphertext=coalesce($4,ciphertext),iv=coalesce($5,iv),tag=coalesce($6,tag),
      size=coalesce($7,size),device_name=CASE WHEN $4::bytea IS NULL THEN device_name ELSE $8 END,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING ${COLS}`,
      [id, userId, input.name ?? null, s?.ciphertext ?? null, s?.iv ?? null, s?.tag ?? null, input.payload !== undefined ? Buffer.byteLength(input.payload, 'utf8') : null, deviceName])
    const row = r.rows[0]; if (!row) throw notFound(); return toItem(row)
  }
  /** GET /:id 与 POST /:id/restore：设了恢复密码必须给对。 */
  async restore(userId: string, id: string, password: string | undefined) {
    const row = await this.unlock(userId, id, password)
    return { ...toItem(row), payload: this.open(row) }
  }
  async setRestorePassword(userId: string, id: string, input: { password: string | null; currentPassword?: string | undefined }) {
    await this.unlock(userId, id, input.currentPassword)
    const hash = input.password === null ? null : await hashPassword(input.password)
    await this.db.query('UPDATE config_profiles SET restore_password_hash=$3,updated_at=now() WHERE id=$1 AND user_id=$2', [id, userId, hash])
    return { ok: true, locked: hash !== null }
  }
  async remove(userId: string, id: string, password?: string | undefined) {
    await this.unlock(userId, id, password)
    const r = await this.db.query('DELETE FROM config_profiles WHERE id=$1 AND user_id=$2', [id, userId])
    if (r.rowCount !== 1) throw notFound()
    return { ok: true }
  }
  async share(userId: string, id: string, password: string, restorePassword?: string | undefined) {
    await this.unlock(userId, id, restorePassword)
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
  async unshare(userId: string, id: string, restorePassword?: string | undefined) {
    await this.unlock(userId, id, restorePassword)
    const r = await this.db.query('UPDATE config_profiles SET share_code=NULL,share_password_hash=NULL,updated_at=now() WHERE id=$1 AND user_id=$2', [id, userId])
    if (r.rowCount !== 1) throw notFound()
    return { ok: true }
  }
  /**
   * 任何已登录用户凭分享码 + 密码导入；码不存在和密码错是同一个 404。
   * 在一个事务里按 用户 / (码, IP) / 码 三把咨询锁串行，计数和记账原子，并发请求不能多试。
   */
  async importShare(userId: string, shareCode: string, password: string, ip = '') {
    const codeIp = shareCode + '|' + ip
    const row = await this.tx(async c => {
      await this.lockSubject(c, 'share_user', userId)
      await this.lockSubject(c, 'share_code_ip', codeIp)
      await this.lockSubject(c, 'share_code', shareCode)
      if (await this.blocked(c, 'share_user', userId)) throw new AppError('RATE_LIMITED', '操作过于频繁，请 10 分钟后再试', 429)
      if (await this.blocked(c, 'share_code_ip', codeIp) || await this.blocked(c, 'share_code', shareCode)) throw new AppError('SHARE_LOCKED', '该分享码尝试次数过多，请 1 小时后再试', 429)
      const r = await c.query('SELECT id,name,ciphertext,iv,tag,share_password_hash AS "shareHash" FROM config_profiles WHERE share_code=$1', [shareCode])
      const found = r.rows[0]
      const ok = !!found?.shareHash && await checkPassword(String(found.shareHash), password)
      await this.record(c, 'share_user', userId, ok)
      if (!ok) { await this.record(c, 'share_code_ip', codeIp, false); await this.record(c, 'share_code', shareCode, false); return null }
      return found ?? null
    })
    await this.prune()
    if (!row) throw new AppError('SHARE_INVALID', '分享码或密码不正确', 404)
    return { name: String(row.name), payload: this.open(row) }
  }
}
