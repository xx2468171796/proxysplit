// 手机号：短信验证码（云片）、注册验码、找回密码（每号每北京日 1 次）、补绑手机号。
// 表结构 migrations/0019_free_sync_phone.sql；合同 docs/plan-2026-10-29-free-sync-phone.md「手机号」。
import { createHash, randomInt } from 'node:crypto'
import { AppError } from '@proxysplit/shared'
import type { SmsPurpose } from '@proxysplit/contracts'
import type { Db } from './telemetry-store.js'

export const SMS_TTL_MS = 5 * 60_000
export const SMS_MAX_ATTEMPTS = 5
export const SMS_COOLDOWN_MS = 60_000
export const SMS_DAILY_MAX = 10

/** 北京日（UTC+8）的日期串 YYYY-MM-DD。 */
export const beijingDay = (now: Date) => new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10)
export const beijingDayStart = (now: Date) => new Date(Date.parse(beijingDay(now) + 'T00:00:00+08:00'))
export const hashSmsCode = (phone: string, purpose: SmsPurpose, code: string) =>
  createHash('sha256').update(`proxysplit-sms-v1:${phone}:${purpose}:${code}`).digest('hex')

/** 同号 60 秒 1 条、每号每北京日 10 条。 */
export function smsSendDecision(recent: { lastAt: Date | null; todayCount: number }, now: Date): 'ok' | 'cooldown' | 'daily' {
  if (recent.lastAt && now.getTime() - recent.lastAt.getTime() < SMS_COOLDOWN_MS) return 'cooldown'
  if (recent.todayCount >= SMS_DAILY_MAX) return 'daily'
  return 'ok'
}

export type SmsCodeRow = { id: string; codeHash: string; expiresAt: Date; attempts: number }
export function checkSmsCode(row: SmsCodeRow | null, codeHash: string, now: Date): 'ok' | 'missing' | 'expired' | 'exhausted' | 'mismatch' {
  if (!row) return 'missing'
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired'
  if (row.attempts >= SMS_MAX_ATTEMPTS) return 'exhausted'
  return row.codeHash === codeHash ? 'ok' : 'mismatch'
}
const CODE_MESSAGES = { missing: '验证码已过期，请重新获取', expired: '验证码已过期，请重新获取', exhausted: '验证码错误次数过多，请重新获取', mismatch: '验证码错误' } as const

export type SmsSender = (phone: string, code: string) => Promise<void>
/** 云片单条模板短信；apikey 只放请求体，不写日志。 */
export function yunpianSender(cfg: { apiKey: string; tplId: string; fetch?: typeof fetch }): SmsSender {
  const doFetch = cfg.fetch ?? fetch
  return async (phone, code) => {
    const body = new URLSearchParams({ apikey: cfg.apiKey, mobile: phone, tpl_id: cfg.tplId, tpl_value: `${encodeURIComponent('#code#')}=${encodeURIComponent(code)}` })
    let res: Response
    try { res = await doFetch('https://sms.yunpian.com/v2/sms/tpl_single_send.json', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8', accept: 'application/json' }, body, signal: AbortSignal.timeout(8000) }) }
    catch { throw new AppError('SMS_SEND_FAILED', '短信发送失败，请稍后再试', 502) }
    const json = await res.json().catch(() => null) as { code?: number } | null
    if (!res.ok || json?.code !== 0) throw new AppError('SMS_SEND_FAILED', '短信发送失败，请稍后再试', 502)
  }
}

export type PhoneAuthOptions = { sender: SmsSender | null; production: boolean; log?: (msg: string) => void }
type Tx = Awaited<ReturnType<Db['connect']>>

export class PhoneAuth {
  constructor(private db: Db, private opts: PhoneAuthOptions) {}
  private async tx<T>(fn: (c: Tx) => Promise<T>): Promise<T> {
    const c = await this.db.connect()
    try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r }
    catch (e) { await c.query('ROLLBACK'); throw e } finally { c.release() }
  }
  async phoneOwner(phone: string): Promise<string | null> {
    const r = await this.db.query('SELECT id FROM users WHERE phone=$1', [phone])
    return (r.rows[0]?.id as string | undefined) ?? null
  }
  async resetUsedToday(phone: string, now = new Date()) {
    const r = await this.db.query('SELECT 1 FROM password_reset_daily WHERE phone=$1 AND day=$2', [phone, beijingDay(now)])
    return (r.rowCount ?? 0) > 0
  }
  async send(phone: string, purpose: SmsPurpose, userId: string | null) {
    if (purpose === 'bind' && !userId) throw new AppError('ACCESS_INVALID', 'Authentication required', 401)
    const owner = await this.phoneOwner(phone)
    if ((purpose === 'register' || purpose === 'bind') && owner) throw new AppError('PHONE_TAKEN', '该手机号已被其他账号使用', 409)
    if (purpose === 'reset') {
      if (await this.resetUsedToday(phone)) throw new AppError('RESET_DAILY_LIMIT', '该手机号今天已经找回过密码，请明天再试', 429)
      // 没注册的号也回成功（不泄露是否注册），但不发。
      if (!owner) return { ok: true, cooldownSeconds: SMS_COOLDOWN_MS / 1000 }
    }
    if (!this.opts.sender && this.opts.production) throw new AppError('SMS_UNAVAILABLE', '短信服务暂不可用', 503)
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0'), now = new Date()
    const id = await this.tx(async c => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['sms:' + phone])
      const dayStart = beijingDayStart(now), since = new Date(Math.min(dayStart.getTime(), now.getTime() - SMS_COOLDOWN_MS))
      const r = await c.query(`SELECT max(created_at) AS "lastAt",count(*) FILTER (WHERE created_at>=$2)::int AS today
        FROM sms_codes WHERE phone=$1 AND created_at>=$3`, [phone, dayStart, since])
      const row = r.rows[0] ?? {}
      const verdict = smsSendDecision({ lastAt: row.lastAt ? new Date(row.lastAt as string | Date) : null, todayCount: Number(row.today ?? 0) }, now)
      if (verdict === 'cooldown') throw new AppError('SMS_COOLDOWN', '验证码发送太频繁，请 60 秒后再试', 429)
      if (verdict === 'daily') throw new AppError('SMS_DAILY_LIMIT', '该手机号今天获取验证码次数已达上限', 429)
      await c.query(`DELETE FROM sms_codes WHERE created_at<now()-interval '2 days'`)
      const ins = await c.query('INSERT INTO sms_codes(phone,purpose,code_hash,expires_at) VALUES($1,$2,$3,$4) RETURNING id',
        [phone, purpose, hashSmsCode(phone, purpose, code), new Date(now.getTime() + SMS_TTL_MS)])
      return String(ins.rows[0]?.id)
    })
    if (!this.opts.sender) { this.opts.log?.(`[dev] sms code ${purpose} ${phone}: ${code}`); return { ok: true, cooldownSeconds: SMS_COOLDOWN_MS / 1000 } }
    try { await this.opts.sender(phone, code) }
    catch (e) { await this.db.query('DELETE FROM sms_codes WHERE id=$1', [id]).catch(() => {}); throw e }
    return { ok: true, cooldownSeconds: SMS_COOLDOWN_MS / 1000 }
  }
  /** 验码（不消费）：错一次记一次，5 次作废。返回验证码行 id，业务成功后再 consume。 */
  async verify(phone: string, purpose: SmsPurpose, code: string): Promise<string> {
    const r = await this.db.query(`SELECT id,code_hash AS "codeHash",expires_at AS "expiresAt",attempts FROM sms_codes
      WHERE phone=$1 AND purpose=$2 AND consumed_at IS NULL ORDER BY id DESC LIMIT 1`, [phone, purpose])
    const raw = r.rows[0]
    const row: SmsCodeRow | null = raw ? { id: String(raw.id), codeHash: String(raw.codeHash), expiresAt: new Date(raw.expiresAt as string | Date), attempts: Number(raw.attempts) } : null
    const verdict = checkSmsCode(row, hashSmsCode(phone, purpose, code), new Date())
    if (verdict === 'mismatch' && row) await this.db.query('UPDATE sms_codes SET attempts=attempts+1 WHERE id=$1', [row.id])
    if (verdict !== 'ok' || !row) throw new AppError('SMS_CODE_INVALID', CODE_MESSAGES[verdict === 'ok' ? 'missing' : verdict], 400)
    return row.id
  }
  async consume(id: string, c: Pick<Db, 'query'> = this.db) {
    const r = await c.query('UPDATE sms_codes SET consumed_at=now() WHERE id=$1 AND consumed_at IS NULL', [id])
    return r.rowCount === 1
  }
  /** 找回密码：验码 → 记当天（冲突 = 今天已找回）→ 改密 + 吊销全部会话，同一事务。 */
  async resetPassword(phone: string, code: string, passwordHash: string) {
    const userId = await this.phoneOwner(phone)
    if (!userId) throw new AppError('SMS_CODE_INVALID', CODE_MESSAGES.missing, 400)
    const codeId = await this.verify(phone, 'reset', code)
    await this.tx(async c => {
      const day = await c.query('INSERT INTO password_reset_daily(phone,day,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [phone, beijingDay(new Date()), userId])
      if (day.rowCount !== 1) throw new AppError('RESET_DAILY_LIMIT', '该手机号今天已经找回过密码，请明天再试', 429)
      if (!await this.consume(codeId, c)) throw new AppError('SMS_CODE_INVALID', CODE_MESSAGES.missing, 400)
      await c.query('UPDATE users SET password_hash=$2,failed_login_count=0,locked_until=NULL,updated_at=now() WHERE id=$1', [userId, passwordHash])
      await c.query('UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1', [userId])
    })
    return { ok: true, userId }
  }
  /** 已登录用户补绑 / 换绑手机号。 */
  async bindPhone(userId: string, phone: string, code: string) {
    const codeId = await this.verify(phone, 'bind', code)
    try {
      await this.tx(async c => {
        if (!await this.consume(codeId, c)) throw new AppError('SMS_CODE_INVALID', CODE_MESSAGES.missing, 400)
        await c.query('UPDATE users SET phone=$2,updated_at=now() WHERE id=$1', [userId, phone])
      })
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new AppError('PHONE_TAKEN', '该手机号已被其他账号使用', 409)
      throw e
    }
    return { ok: true }
  }
}
