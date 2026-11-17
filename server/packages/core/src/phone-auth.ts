// 手机号：短信验证码、注册验码、找回密码（每号每北京日 1 次）、补绑手机号。
// 两种模式（没有第三种）：配了 LCV_* = 走公司雷池验证中心（sms-center.ts，本文件只管业务闸门）；没配 = 本地模式（云片直发 + sms_codes 表，开发 / 测试 / 回退用）。
// 表结构 migrations/0019_free_sync_phone.sql；合同 docs/plan-2026-10-29-free-sync-phone.md「手机号」。
import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import { AppError, maskPhone } from '@proxysplit/shared'
import type { SmsPurpose } from '@proxysplit/contracts'
import type { Db } from './telemetry-store.js'

export const SMS_TTL_MS = 5 * 60_000
export const SMS_MAX_ATTEMPTS = 5
export const SMS_COOLDOWN_MS = 60_000
export const SMS_HOURLY_MAX = 5
export const SMS_DAILY_MAX = 10

/** 北京日（UTC+8）的日期串 YYYY-MM-DD。 */
export const beijingDay = (now: Date) => new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10)
export const beijingDayStart = (now: Date) => new Date(Date.parse(beijingDay(now) + 'T00:00:00+08:00'))
export const hashSmsCode = (phone: string, purpose: SmsPurpose, code: string) =>
  createHash('sha256').update(`proxysplit-sms-v1:${phone}:${purpose}:${code}`).digest('hex')
/** 常量时间比较两个哈希串。 */
export const sameHash = (a: string, b: string) => {
  const x = Buffer.from(a, 'utf8'), y = Buffer.from(b, 'utf8')
  return x.length === y.length && timingSafeEqual(x, y)
}

/** 同号 60 秒 1 条、每小时 5 条、每北京日 10 条。 */
export function smsSendDecision(recent: { lastAt: Date | null; hourCount?: number; todayCount: number }, now: Date): 'ok' | 'cooldown' | 'hourly' | 'daily' {
  if (recent.lastAt && now.getTime() - recent.lastAt.getTime() < SMS_COOLDOWN_MS) return 'cooldown'
  if ((recent.hourCount ?? 0) >= SMS_HOURLY_MAX) return 'hourly'
  if (recent.todayCount >= SMS_DAILY_MAX) return 'daily'
  return 'ok'
}

export type SmsCodeRow = { id: string; codeHash: string; expiresAt: Date; attempts: number }
/** 纯判定（测试 / 文档用）；verify() 在库里用一条原子 UPDATE 做同样的判断。 */
export function checkSmsCode(row: SmsCodeRow | null, codeHash: string, now: Date): 'ok' | 'missing' | 'expired' | 'exhausted' | 'mismatch' {
  if (!row) return 'missing'
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired'
  if (row.attempts >= SMS_MAX_ATTEMPTS) return 'exhausted'
  return sameHash(row.codeHash, codeHash) ? 'ok' : 'mismatch'
}
const CODE_GONE = '验证码已失效，请重新获取', CODE_WRONG = '验证码错误'
/** 开发环境日志：手机号打码；验证码只在 NODE_ENV 恰好是 development 时打出来。 */
export const devSmsLog = (purpose: SmsPurpose, phone: string, code: string, showCode: boolean) =>
  `[dev] sms code ${purpose} ${maskPhone(phone)}: ${showCode ? code : '******'}`

export type SmsSender = (phone: string, code: string) => Promise<void>
/** 云片单条模板短信；apikey 只放请求体，不写日志。失败记一行：打码手机号 + HTTP 状态 + 云片错误码（不记验证码）。 */
export function yunpianSender(cfg: { apiKey: string; tplId: string; fetch?: typeof fetch; log?: ((msg: string) => void) | undefined }): SmsSender {
  const doFetch = cfg.fetch ?? fetch
  const failed = (phone: string, why: string) => cfg.log?.(`[warn] sms yunpian send failed phone=${maskPhone(phone)} ${why}`)
  return async (phone, code) => {
    const body = new URLSearchParams({ apikey: cfg.apiKey, mobile: phone, tpl_id: cfg.tplId, tpl_value: `${encodeURIComponent('#code#')}=${encodeURIComponent(code)}` })
    let res: Response
    try { res = await doFetch('https://sms.yunpian.com/v2/sms/tpl_single_send.json', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8', accept: 'application/json' }, body, signal: AbortSignal.timeout(8000) }) }
    catch (e) { failed(phone, `network=${(e as Error)?.name ?? 'error'}`); throw new AppError('SMS_SEND_FAILED', '短信发送失败，请稍后再试', 502) }
    const json = await res.json().catch(() => null) as { code?: number } | null
    if (!res.ok || json?.code !== 0) { failed(phone, `http=${res.status} code=${typeof json?.code === 'number' ? json.code : 'none'}`); throw new AppError('SMS_SEND_FAILED', '短信发送失败，请稍后再试', 502) }
  }
}

export type PhoneAuthOptions = { sender: SmsSender | null; production: boolean; showDevCode?: boolean; log?: (msg: string) => void; dailyGlobalCap?: number }
/** 全站每日（北京日）短信总量熔断，防刷短信费；超了全站暂停发送到次日。 */
export const SMS_DAILY_GLOBAL_CAP = 300
type Tx = Awaited<ReturnType<Db['connect']>>
/** 中心模式的核码函数：consume=false 只读，true 真正消费；不通过就抛 AppError（sms-center.ts SmsCenter.check）。 */
export type CodeCheck = (consume: boolean) => Promise<void>
const resetLimitError = () => new AppError('RESET_DAILY_LIMIT', '该手机号今天已经找回过密码，请明天再试', 429)
const SENT = { ok: true, cooldownSeconds: SMS_COOLDOWN_MS / 1000 } as const
const phoneTakenError = () => new AppError('PHONE_TAKEN', '该手机号已被其他账号使用', 409)

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
  /**
   * 号码被占用：别人绑了这个号，或别人的用户名就是这串号码（登录框会撞号）。
   * 用户名按登录框的归一化比（shared normalizePhone）：带 +86 / 0086 / 86 前缀、夹横线或括号的老用户名也算。
   */
  async phoneTaken(phone: string, exceptUserId: string | null = null): Promise<boolean> {
    const r = await this.db.query(`SELECT 1 FROM users WHERE (phone=$1 OR username=$1 OR regexp_replace(username,'[-()]','','g')=ANY($3::text[])) AND ($2::uuid IS NULL OR id<>$2::uuid) LIMIT 1`,
      [phone, exceptUserId, [phone, `+86${phone}`, `0086${phone}`, `86${phone}`]])
    return r.rows.length > 0
  }
  async emailTaken(email: string): Promise<boolean> {
    const r = await this.db.query('SELECT 1 FROM users WHERE lower(email)=$1 LIMIT 1', [email.toLowerCase()])
    return r.rows.length > 0
  }
  async resetUsedToday(phone: string, now = new Date()) {
    const r = await this.db.query('SELECT 1 FROM password_reset_daily WHERE phone=$1 AND day=$2', [phone, beijingDay(now)])
    return r.rows.length > 0
  }
  async send(phone: string, purpose: SmsPurpose, userId: string | null) {
    if (purpose === 'bind' && !userId) throw new AppError('ACCESS_INVALID', 'Authentication required', 401)
    if (purpose === 'bind' && await this.phoneTaken(phone, userId)) throw phoneTakenError()
    // 注册：号被占用也回同样的成功（不泄露是否注册）但不发，随后注册接口回 PHONE_TAKEN。
    let silent = purpose === 'register' && await this.phoneTaken(phone)
    if (purpose === 'reset') {
      if (await this.resetUsedToday(phone)) throw new AppError('RESET_DAILY_LIMIT', '该手机号今天已经找回过密码，请明天再试', 429)
      silent = !await this.phoneOwner(phone) // 没注册的号同样回成功、不发
    }
    if (!this.opts.sender && this.opts.production) throw new AppError('SMS_UNAVAILABLE', '短信服务暂不可用', 503)
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0'), now = new Date()
    const id = await this.tx(async c => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['sms:' + phone])
      const dayStart = beijingDayStart(now), hourStart = new Date(now.getTime() - 3600_000)
      const since = new Date(Math.min(dayStart.getTime(), hourStart.getTime()))
      const r = await c.query(`SELECT now() AS "dbNow",max(created_at) AS "lastAt",count(*) FILTER (WHERE created_at>=$2)::int AS today,count(*) FILTER (WHERE created_at>=$4)::int AS hour
        FROM sms_codes WHERE phone=$1 AND created_at>=$3 AND failed_at IS NULL`, [phone, dayStart, since, hourStart])
      const g = await c.query(`SELECT count(*)::int AS n FROM sms_codes WHERE created_at>=$1 AND failed_at IS NULL AND code_hash<>'silent'`, [dayStart])
      if (Number(g.rows[0]?.n ?? 0) >= (this.opts.dailyGlobalCap ?? SMS_DAILY_GLOBAL_CAP)) { this.opts.log?.('[warn] sms daily global cap reached'); throw new AppError('SMS_BUSY', '今天的验证码发送量已达上限，请明天再试', 503) }
      const row = r.rows[0] ?? {}
      const verdict = smsSendDecision({ lastAt: row.lastAt ? new Date(row.lastAt as string | Date) : null, hourCount: Number(row.hour ?? 0), todayCount: Number(row.today ?? 0) }, row.dbNow ? new Date(row.dbNow as string | Date) : now)
      if (verdict === 'cooldown') throw new AppError('SMS_COOLDOWN', '验证码发送太频繁，请 60 秒后再试', 429)
      if (verdict === 'hourly') throw new AppError('SMS_HOURLY_LIMIT', '该手机号获取验证码太频繁，请 1 小时后再试', 429)
      if (verdict === 'daily') throw new AppError('SMS_DAILY_LIMIT', '该手机号今天获取验证码次数已达上限', 429)
      await c.query(`DELETE FROM sms_codes WHERE created_at<now()-interval '2 days'`)
      // 静默分支也记一行（已消费、永远验不过），冷却与次数限制对它同样生效，响应无差别。
      const ins = await c.query('INSERT INTO sms_codes(phone,purpose,code_hash,expires_at,consumed_at) VALUES($1,$2,$3,$4,$5) RETURNING id',
        [phone, purpose, silent ? 'silent' : hashSmsCode(phone, purpose, code), new Date(now.getTime() + SMS_TTL_MS), silent ? now : null])
      return String(ins.rows[0]?.id)
    })
    if (silent) return SENT
    if (!this.opts.sender) { this.opts.log?.(devSmsLog(purpose, phone, code, this.opts.showDevCode === true)); return SENT }
    try { await this.opts.sender(phone, code) }
    catch (e) { await this.db.query('UPDATE sms_codes SET failed_at=now(),consumed_at=now() WHERE id=$1', [id]).catch(() => {}); throw e }
    return SENT
  }
  /**
   * 验码（不消费）：一条原子 UPDATE 给最新一条未消费、未过期、未用尽的验证码 attempts+1（对的也计一次），
   * 再常量时间比较哈希；对了返回行 id，业务成功后再 consume。并发猜码最多 5 次。
   */
  async verify(phone: string, purpose: SmsPurpose, code: string): Promise<string> {
    const r = await this.db.query(`UPDATE sms_codes SET attempts=attempts+1 WHERE id=(
        SELECT id FROM sms_codes WHERE phone=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at>now() ORDER BY id DESC LIMIT 1
      ) AND attempts<$3 RETURNING id,code_hash AS "codeHash"`, [phone, purpose, SMS_MAX_ATTEMPTS])
    const row = r.rows[0]
    if (!row) throw new AppError('SMS_CODE_INVALID', CODE_GONE, 400)
    if (!sameHash(String(row.codeHash), hashSmsCode(phone, purpose, code))) throw new AppError('SMS_CODE_INVALID', CODE_WRONG, 400)
    return String(row.id)
  }
  /** 原子消费：只有第一个调用者拿到 true。 */
  async consume(id: string, c: Pick<Db, 'query'> = this.db) {
    const r = await c.query('UPDATE sms_codes SET consumed_at=now() WHERE id=$1 AND consumed_at IS NULL RETURNING id', [id])
    return r.rows.length === 1
  }
  /** 找回密码：验码 → 记当天（冲突 = 今天已找回）→ 改密 + 吊销全部会话，同一事务。 */
  async resetPassword(phone: string, code: string, passwordHash: string) {
    const userId = await this.phoneOwner(phone)
    if (!userId) throw new AppError('SMS_CODE_INVALID', CODE_GONE, 400)
    const codeId = await this.verify(phone, 'reset', code)
    await this.tx(async c => {
      const day = await c.query('INSERT INTO password_reset_daily(phone,day,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [phone, beijingDay(new Date()), userId])
      if (day.rowCount !== 1) throw new AppError('RESET_DAILY_LIMIT', '该手机号今天已经找回过密码，请明天再试', 429)
      if (!await this.consume(codeId, c)) throw new AppError('SMS_CODE_INVALID', CODE_GONE, 400)
      await c.query('UPDATE users SET password_hash=$2,failed_login_count=0,locked_until=NULL,updated_at=now() WHERE id=$1', [userId, passwordHash])
      await c.query('UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1', [userId])
    })
    return { ok: true, userId }
  }
  /**
   * 中心模式找回密码（顺序同 V7）：只读核码 → 查号 → 当天配额 → 消费 → 事务里记当天 + 改密 + 吊销全部会话。
   * 被配额拒掉的人码不会被烧掉。核码失败的对外文案由调用方统一（防枚举）。
   */
  async resetPasswordChecked(phone: string, passwordHash: string, check: CodeCheck) {
    await check(false)
    const userId = await this.phoneOwner(phone)
    if (!userId) throw new AppError('SMS_CODE_INVALID', CODE_WRONG, 400)
    if (await this.resetUsedToday(phone)) throw resetLimitError()
    await check(true)
    await this.tx(async c => {
      const day = await c.query('INSERT INTO password_reset_daily(phone,day,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [phone, beijingDay(new Date()), userId])
      if (day.rowCount !== 1) throw resetLimitError()
      await c.query('UPDATE users SET password_hash=$2,failed_login_count=0,locked_until=NULL,updated_at=now() WHERE id=$1', [userId, passwordHash])
      await c.query('UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1', [userId])
    })
    return { ok: true, userId }
  }
  /**
   * 已登录用户补绑 / 换绑手机号（换绑要的当前密码在 AuthService.bindPhone 里校验）。
   * 给了 check = 中心模式：只读核码 → 查占用 → 消费 → 写库；不给 = 本地模式（sms_codes 表），行为不变。
   */
  async bindPhone(userId: string, phone: string, code: string, check?: CodeCheck) {
    if (check) {
      await check(false)
      if (await this.phoneTaken(phone, userId)) throw phoneTakenError()
      await check(true)
      try { await this.db.query('UPDATE users SET phone=$2,updated_at=now() WHERE id=$1', [userId, phone]) }
      catch (e) { if ((e as { code?: string }).code === '23505') throw phoneTakenError(); throw e }
      return { ok: true }
    }
    if (await this.phoneTaken(phone, userId)) throw phoneTakenError()
    const codeId = await this.verify(phone, 'bind', code)
    try {
      await this.tx(async c => {
        if (!await this.consume(codeId, c)) throw new AppError('SMS_CODE_INVALID', CODE_GONE, 400)
        await c.query('UPDATE users SET phone=$2,updated_at=now() WHERE id=$1', [userId, phone])
      })
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw phoneTakenError()
      throw e
    }
    return { ok: true }
  }
}
