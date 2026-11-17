// 短信验证码走雷池验证中心：假中心（替掉 SDK 的 HTTP 客户端）+ 假 Redis + 假库。
import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { smsSendSchema } from '@proxysplit/contracts'
import { normalizePhone } from '@proxysplit/shared'
import { AuthService } from './auth.js'
import { PhoneAuth } from './phone-auth.js'
import { LCV_KEY_PREFIX, RESET_SENT_MESSAGE, SMS_UPGRADE_MESSAGE, SmsCenter, createSmsCenterFromEnv, type SmsCenterRedis } from './sms-center.js'
import { PgStore } from './store.js'
import type { Db, QueryResult } from './telemetry-store.js'
import { DEFAULT_OTP_MESSAGES, type CallResult, type OtpSendBody, type SecurityClient } from './vendor/yanzheng/verify-client/index.js'
import { isValidPhone, normalizePhone as sdkNormalizePhone } from './vendor/yanzheng/sms/phone.js'

const PHONE = '13800138000', CODE = '123456', SECRET = 's'.repeat(40), TICKET = 'ticket-abc'
const ctx = (captchaTicket: string | undefined = TICKET) => ({ captchaTicket, clientIp: '203.0.113.9', deviceFp: 'fp-1' })

function fakeRedis() {
  const data = new Map<string, string>()
  const redis: SmsCenterRedis = {
    get: async k => data.get(k) ?? null,
    set: async (k, v) => { data.set(k, v) },
    del: async k => { data.delete(k) },
    incr: async k => { const n = Number(data.get(k) ?? 0) + 1; data.set(k, String(n)); return n },
    expire: async () => 1,
  }
  return { redis, data }
}

type Call = { op: string; body: Record<string, unknown> }
/** 假中心：一个号一条码；核对即作废；结果票据在线核销只成功一次。 */
function fakeCenter() {
  const calls: Call[] = []
  const s = {
    send: (): CallResult<OtpSendBody> => ({ status: 'ok', body: { ok: true, verificationId: 'vid-1', expiresIn: 300, resendAfter: 60 } }),
    code: CODE, codeUsed: false, attemptsLeft: 5, redeemed: false, captchaOk: true, down: false,
  }
  const rejected = (error: string, body: Record<string, unknown> = {}, httpStatus = 429) => { s.send = () => ({ status: 'rejected', httpStatus, error, body }) }
  const client = {
    otp: {
      send: async (body: Record<string, unknown>) => { calls.push({ op: 'otp.send', body }); return s.down ? { status: 'unavailable', reason: 'timeout' } : s.send() },
      check: async (body: { code: string }) => {
        calls.push({ op: 'otp.check', body })
        if (s.down) return { status: 'unavailable', reason: 'timeout' }
        if (body.code === s.code && !s.codeUsed) { s.codeUsed = true; return { status: 'ok', body: { ok: true, attemptsLeft: s.attemptsLeft, resultToken: 'rt-1' } } }
        s.attemptsLeft -= 1
        return { status: 'ok', body: { ok: false, attemptsLeft: s.attemptsLeft, error: s.attemptsLeft <= 0 ? 'TOO_MANY_ATTEMPTS' : 'WRONG_CODE' } }
      },
    },
    captcha: { verify: async (body: Record<string, unknown>) => { calls.push({ op: 'captcha.verify', body }); return s.down ? { status: 'unavailable', reason: 'timeout' } : { status: 'ok', body: { success: s.captchaOk } } } },
    ticket: {
      verify: async (token: string, expect: { online?: boolean }) => {
        const online = expect.online !== false
        calls.push({ op: online ? 'ticket.redeem' : 'ticket.offline', body: { token } })
        const payload = { iss: 'leichiwaf-verify', aud: 'proxysplit', typ: 'otp', iat: 0, exp: Date.now() / 1000 + 600, jti: 'j' }
        if (!online) return { ok: true, payload }
        if (s.down) return { ok: false, reason: 'unavailable' }
        if (s.redeemed) return { ok: false, reason: 'used' }
        s.redeemed = true
        return { ok: true, payload }
      },
    },
  }
  return { client: client as unknown as SecurityClient, calls, s, rejected, ops: () => calls.map(c => c.op) }
}

function setup() {
  const center = fakeCenter(), kv = fakeRedis(), logs: string[] = []
  const sms = new SmsCenter({ siteId: 'proxysplit', host: 'proxysplit.zygskins.cn', secret: SECRET, redis: kv.redis, client: center.client, log: m => logs.push(m), resetSendMinMs: 0 })
  return { center, kv, logs, sms }
}

type Handler = (sql: string, params: unknown[]) => QueryResult | undefined
function fakeDb(handler: Handler = () => undefined) {
  const calls: string[] = []
  const query = async (sql: string, params: unknown[] = []) => { calls.push(sql); return handler(sql, params) ?? { rows: [], rowCount: 1 } }
  const db: Db = { query, connect: async () => ({ query, release: () => {} }) }
  return { db, calls }
}

describe('center mode: send', () => {
  it('asks a released client that sends no captchaTicket to upgrade, without calling the center', async () => {
    const { sms, center } = setup()
    await expect(sms.send(PHONE, 'register', { clientIp: '203.0.113.9' })).rejects.toMatchObject({ code: 'CLIENT_UPGRADE_REQUIRED', message: SMS_UPGRADE_MESSAGE, status: 400 })
    await expect(sms.sendReset(PHONE, { clientIp: '203.0.113.9' }, async () => true)).rejects.toMatchObject({ code: 'CLIENT_UPGRADE_REQUIRED' })
    expect(SMS_UPGRADE_MESSAGE).toBe('请升级到最新版本后再获取验证码')
    expect(center.calls).toEqual([])
  })
  it('requires a ticket: an empty one is CAPTCHA_REQUIRED with the SDK wording and nothing is sent', async () => {
    const { sms, center } = setup()
    await expect(sms.send(PHONE, 'register', ctx(''))).rejects.toMatchObject({ code: 'CAPTCHA_REQUIRED', status: 403, message: DEFAULT_OTP_MESSAGES.captcha })
    expect(center.calls).toEqual([])
  })
  it('forwards ticket, real client IP and device id, stores the verification id under proxysplit:lcvotp:', async () => {
    const { sms, center, kv } = setup()
    center.s.send = () => ({ status: 'ok', body: { ok: true, verificationId: 'vid-9', expiresIn: 300, resendAfter: 45 } })
    await expect(sms.send(PHONE, 'register', ctx())).resolves.toEqual({ ok: true, cooldownSeconds: 45, message: DEFAULT_OTP_MESSAGES.sent })
    expect(center.calls).toEqual([{ op: 'otp.send', body: { purpose: 'register', channel: 'sms', to: PHONE, clientIp: '203.0.113.9', deviceFp: 'fp-1', captchaTicket: TICKET } }])
    expect([...kv.data.keys()]).toEqual([`${LCV_KEY_PREFIX}vid:sms:register:${PHONE}`])
    expect(kv.data.get(`${LCV_KEY_PREFIX}vid:sms:register:${PHONE}`)).toBe('vid-9')
  })
  it('maps every center error code to the SDK message and a stable error code', async () => {
    const cases: [string, Record<string, unknown>, number, { code: string; status: number; message: string }][] = [
      ['COOLDOWN', { resendAfter: 42 }, 429, { code: 'SMS_COOLDOWN', status: 429, message: '发送太频繁，请 42 秒后再试' }],
      ['QUOTA_EXCEEDED', { bucket: 'subject_day' }, 429, { code: 'SMS_DAILY_LIMIT', status: 429, message: '今日验证码发送次数已达上限，请明天再试' }],
      ['BLOCKED_PREFIX', {}, 400, { code: 'SMS_BLOCKED_PREFIX', status: 400, message: '暂不支持该号段，请换一个手机号' }],
      ['BAD_RECIPIENT', {}, 400, { code: 'SMS_BAD_RECIPIENT', status: 400, message: '手机号格式不正确' }],
      ['CAPTCHA_REQUIRED', {}, 403, { code: 'CAPTCHA_REQUIRED', status: 403, message: DEFAULT_OTP_MESSAGES.captcha }],
      ['CAPTCHA_INVALID', {}, 403, { code: 'CAPTCHA_REQUIRED', status: 403, message: DEFAULT_OTP_MESSAGES.captcha }],
      ['SEND_FAILED', {}, 502, { code: 'SMS_SEND_FAILED', status: 502, message: '短信发送失败，请稍后再试' }],
      ['CHANNEL_NOT_CONFIGURED', {}, 503, { code: 'SMS_UNAVAILABLE', status: 503, message: '短信发送失败，请稍后再试' }],
    ]
    for (const [error, body, http, want] of cases) {
      const { sms, center, logs } = setup()
      center.rejected(error, body, http)
      await expect(sms.send(PHONE, 'register', ctx()), error).rejects.toMatchObject(want)
      // 失败要有日志：结果 + 中心错误码 + 打码手机号；不出现完整手机号、凭证、密钥
      const line = logs.find(l => l.includes('send failed')) ?? ''
      expect(line, error).toContain(`center=${error}`)
      expect(line).toContain('phone=138****8000')
      for (const secret of [PHONE, TICKET, SECRET]) expect(logs.join('\n')).not.toContain(secret)
    }
    const { sms, center } = setup()
    center.rejected('COOLDOWN', { resendAfter: 42 })
    await expect(sms.send(PHONE, 'register', ctx())).rejects.toMatchObject({ extra: { cooldownSeconds: 42 } })
    center.rejected('QUOTA_EXCEEDED', { bucket: 'ip_day' })
    await expect(sms.send(PHONE, 'bind', ctx())).rejects.toMatchObject({ code: 'SMS_DAILY_LIMIT' })
  })
  it('fails closed when the center is unreachable', async () => {
    const { sms, center, logs } = setup()
    center.s.down = true
    await expect(sms.send(PHONE, 'register', ctx())).rejects.toMatchObject({ code: 'SMS_BUSY', status: 503, message: DEFAULT_OTP_MESSAGES.busy })
    expect(logs.some(l => l.includes('result=busy') && l.includes('reason=center-unavailable'))).toBe(true)
  })
  it('bind: a taken number is refused only after the ticket was redeemed, and no SMS goes out', async () => {
    const { sms, center } = setup()
    await expect(sms.send(PHONE, 'bind', ctx(), async () => '该手机号已被其他账号使用')).rejects.toMatchObject({ code: 'PHONE_TAKEN', status: 409 })
    expect(center.ops()).toEqual(['captcha.verify'])
    expect(center.calls[0]?.body).toMatchObject({ token: TICKET, action: 'sms', remoteIp: '203.0.113.9' })
  })
})

describe('center mode: reset send is enumeration-safe', () => {
  it('answers registered and unregistered numbers identically; only the registered one gets an SMS', async () => {
    const a = setup(), b = setup()
    const known = await a.sms.sendReset(PHONE, ctx(), async () => true)
    const unknown = await b.sms.sendReset(PHONE, ctx(), async () => false)
    expect(known).toEqual(unknown)
    expect(known).toEqual({ ok: true, cooldownSeconds: 60, message: RESET_SENT_MESSAGE })
    expect(a.center.ops()).toEqual(['otp.send'])
    expect(b.center.ops()).toEqual(['captcha.verify'])
  })
  it('hides cooldown / quota / send failures of a registered number behind the same answer', async () => {
    for (const error of ['COOLDOWN', 'QUOTA_EXCEEDED', 'SEND_FAILED']) {
      const { sms, center, logs } = setup()
      center.rejected(error, { resendAfter: 30 })
      await expect(sms.sendReset(PHONE, ctx(), async () => true), error).resolves.toEqual({ ok: true, cooldownSeconds: 60, message: RESET_SENT_MESSAGE })
      expect(logs.some(l => l.includes('phone=138****8000')), error).toBe(true)
    }
  })
  it('reports a bad ticket the same way on both paths (one error code, no oracle)', async () => {
    const a = setup(), b = setup()
    a.center.rejected('CAPTCHA_INVALID', {}, 403)
    b.center.s.captchaOk = false
    const errA = await a.sms.sendReset(PHONE, ctx(), async () => true).catch(e => e)
    const errB = await b.sms.sendReset(PHONE, ctx(), async () => false).catch(e => e)
    expect({ code: errA.code, status: errA.status, message: errA.message }).toEqual({ code: 'CAPTCHA_REQUIRED', status: 403, message: DEFAULT_OTP_MESSAGES.captcha })
    expect({ code: errB.code, status: errB.status, message: errB.message }).toEqual({ code: errA.code, status: errA.status, message: errA.message })
  })
  it('takes at least the configured minimum time on both paths', async () => {
    const center = fakeCenter(), kv = fakeRedis()
    const sms = new SmsCenter({ siteId: 'proxysplit', host: 'h.example', secret: SECRET, redis: kv.redis, client: center.client, resetSendMinMs: 120 })
    for (const exists of [true, false]) {
      const t = Date.now()
      await sms.sendReset(PHONE, ctx(), async () => exists)
      expect(Date.now() - t).toBeGreaterThanOrEqual(110)
    }
  })
})

describe('center mode: check', () => {
  it('read-only check keeps the code usable; consume redeems it exactly once', async () => {
    const { sms, center } = setup()
    await sms.send(PHONE, 'register', ctx())
    await sms.check(PHONE, 'register', CODE, false)
    await sms.check(PHONE, 'register', CODE, false)
    expect(center.ops()).toEqual(['otp.send', 'otp.check', 'ticket.offline'])
    await sms.check(PHONE, 'register', CODE, true)
    expect(center.ops().at(-1)).toBe('ticket.redeem')
    await expect(sms.check(PHONE, 'register', CODE, true)).rejects.toMatchObject({ code: 'SMS_CODE_INVALID', status: 400, message: DEFAULT_OTP_MESSAGES.noCode })
  })
  it('maps wrong / exhausted / missing codes and an unreachable center', async () => {
    const { sms, center } = setup()
    await expect(sms.check(PHONE, 'register', CODE, false)).rejects.toMatchObject({ code: 'SMS_CODE_INVALID', message: DEFAULT_OTP_MESSAGES.noCode })
    await expect(sms.check(PHONE, 'register', '12ab', false)).rejects.toMatchObject({ code: 'SMS_CODE_INVALID', message: DEFAULT_OTP_MESSAGES.format })
    await sms.send(PHONE, 'register', ctx())
    await expect(sms.check(PHONE, 'register', '000000', false)).rejects.toMatchObject({ code: 'SMS_CODE_INVALID', message: '验证码错误，还可以试 4 次' })
    center.s.attemptsLeft = 1
    await expect(sms.check(PHONE, 'register', '000000', false)).rejects.toMatchObject({ code: 'SMS_CODE_INVALID', message: DEFAULT_OTP_MESSAGES.expired })
    const down = setup()
    await down.sms.send(PHONE, 'register', ctx())
    down.center.s.down = true
    await expect(down.sms.check(PHONE, 'register', CODE, false)).rejects.toMatchObject({ code: 'SMS_BUSY', status: 503 })
    expect(down.logs.join('\n')).not.toContain(CODE)
  })
})

const ACCESS = 'test-secret-must-be-at-least-32-bytes-long'
/** AuthService + 假 store：registerWebUser 照真 store 的顺序（闸门 → beforeInsert → 插入）。 */
async function authFixture(over: { gate?: string; takenPhone?: boolean; usernameTaken?: boolean } = {}) {
  const t = setup(), events: string[] = []
  const { db, calls } = fakeDb((sql) => {
    if (sql.startsWith('SELECT 1 FROM users WHERE (phone=$1 OR username=$1)')) return { rows: over.takenPhone ? [{}] : [], rowCount: over.takenPhone ? 1 : 0 }
    if (sql.startsWith('SELECT id FROM users WHERE phone')) return { rows: [], rowCount: 0 }
    return undefined
  })
  const store = {
    pool: db,
    findUser: async () => (over.usernameTaken ? { id: 'u0' } : null),
    audit: async () => {},
    registerWebUser: async (input: { beforeInsert?: () => Promise<void>; username: string }) => {
      if (over.gate) throw new Error(over.gate)
      await input.beforeInsert?.()
      events.push('insert')
      return { id: 'u1', username: input.username }
    },
  }
  const auth = await AuthService.create(store as unknown as PgStore, { accessSecret: ACCESS, refreshDays: 30 })
  auth.setSmsCenter(t.sms, { resetMinMs: 0 })
  return { ...t, auth, events, dbCalls: calls }
}
const webInput = { username: 'alice', phone: PHONE, code: CODE, password: 'password123' }

describe('center mode: register follows check → gates → consume → insert', () => {
  it('creates the account and consumes the code last', async () => {
    const f = await authFixture()
    expect(f.auth.smsMode).toBe('center')
    await f.auth.sendSmsCode({ phone: PHONE, purpose: 'register' }, null, ctx())
    await expect(f.auth.registerWeb(webInput, '203.0.113.9')).resolves.toEqual({ ok: true, username: 'alice' })
    expect(f.center.ops()).toEqual(['otp.send', 'otp.check', 'ticket.offline', 'ticket.redeem'])
    expect(f.events).toEqual(['insert'])
    // 本地模式的 sms_codes 表在中心模式下不读不写
    expect(f.dbCalls.some(sql => sql.includes('sms_codes'))).toBe(false)
  })
  it('does not consume the code when a gate fails, so the same code still works afterwards', async () => {
    for (const [over, want] of [
      [{ takenPhone: true }, 'PHONE_TAKEN'], [{ usernameTaken: true }, 'IDENTITY_TAKEN'],
      [{ gate: 'REGISTRATION_DISABLED' }, 'REGISTRATION_DISABLED'], [{ gate: 'IP_ACCOUNT_LIMIT' }, 'IP_ACCOUNT_LIMIT'],
    ] as const) {
      const f = await authFixture(over)
      await f.auth.sendSmsCode({ phone: PHONE, purpose: 'register' }, null, ctx())
      await expect(f.auth.registerWeb(webInput), want).rejects.toMatchObject({ code: want })
      expect(f.center.ops(), want).not.toContain('ticket.redeem')
      expect(f.events).toEqual([])
      await expect(f.sms.check(PHONE, 'register', CODE, true), want).resolves.toBeUndefined()
    }
  })
  it('says "already registered" only after the code was proven, and rejects a wrong code first', async () => {
    const f = await authFixture({ takenPhone: true })
    // 发码对已注册的号照常发（不泄露是否注册）
    await expect(f.auth.sendSmsCode({ phone: PHONE, purpose: 'register' }, null, ctx())).resolves.toMatchObject({ ok: true })
    expect(f.center.ops()).toEqual(['otp.send'])
    await expect(f.auth.registerWeb({ ...webInput, code: '000000' })).rejects.toMatchObject({ code: 'SMS_CODE_INVALID' })
    await expect(f.auth.registerWeb(webInput)).rejects.toMatchObject({ code: 'PHONE_TAKEN' })
  })
  it('the real store calls beforeInsert after its gates and before inserting the user', async () => {
    const run = async (maxPerIp: number, existing: number) => {
      const order: string[] = []
      const { db } = fakeDb((sql) => {
        if (sql.includes('FROM system_settings')) return { rows: [{ key: 'max_accounts_per_ip', value: maxPerIp }], rowCount: 1 }
        if (sql.includes('count(*)')) return { rows: [{ n: existing }], rowCount: 1 }
        if (sql.includes('INSERT INTO users')) { order.push('insert'); return { rows: [{ id: 'u1', username: 'alice' }], rowCount: 1 } }
        if (sql === 'ROLLBACK' || sql === 'COMMIT') order.push(sql)
        return undefined
      })
      const store = Object.assign(Object.create(PgStore.prototype) as PgStore, { pool: db })
      const done = store.registerWebUser({ username: 'alice', email: null, phone: PHONE, passwordHash: 'h', ip: '203.0.113.9', beforeInsert: async () => { order.push('consume') } })
      return { order, done }
    }
    const ok = await run(3, 0)
    await ok.done
    expect(ok.order).toEqual(['consume', 'insert', 'COMMIT'])
    const limited = await run(3, 3)
    await expect(limited.done).rejects.toThrow('IP_ACCOUNT_LIMIT')
    expect(limited.order).toEqual(['ROLLBACK'])
  })
})

describe('center mode: reset and bind', () => {
  const resetDb = (o: { owner?: boolean; usedToday?: boolean } = {}) => fakeDb((sql) => {
    if (sql.startsWith('SELECT id FROM users WHERE phone')) return { rows: o.owner === false ? [] : [{ id: 'u1' }], rowCount: 1 }
    if (sql.startsWith('SELECT 1 FROM password_reset_daily')) return { rows: o.usedToday ? [{}] : [], rowCount: 1 }
    if (sql.startsWith('SELECT 1 FROM users WHERE (phone=$1 OR username=$1)')) return { rows: [], rowCount: 0 }
    return undefined
  })
  it('reset: read-only check → daily limit → consume → change password and revoke sessions', async () => {
    const { sms, center } = setup(), { db, calls } = resetDb()
    await sms.sendReset(PHONE, ctx(), async () => true)
    await new PhoneAuth(db, { sender: null, production: true }).resetPasswordChecked(PHONE, 'hash', consume => sms.check(PHONE, 'reset', CODE, consume))
    expect(center.ops()).toEqual(['otp.send', 'otp.check', 'ticket.offline', 'ticket.redeem'])
    expect(calls.some(s => s.startsWith('UPDATE users SET password_hash'))).toBe(true)
    expect(calls.some(s => s.startsWith('UPDATE sessions SET revoked_at'))).toBe(true)
    expect(calls.some(s => s.includes('sms_codes'))).toBe(false)
  })
  it('reset: the daily limit does not burn the code', async () => {
    const { sms, center } = setup(), { db, calls } = resetDb({ usedToday: true })
    await sms.sendReset(PHONE, ctx(), async () => true)
    await expect(new PhoneAuth(db, { sender: null, production: true }).resetPasswordChecked(PHONE, 'hash', consume => sms.check(PHONE, 'reset', CODE, consume))).rejects.toMatchObject({ code: 'RESET_DAILY_LIMIT', status: 429 })
    expect(center.ops()).not.toContain('ticket.redeem')
    expect(calls.some(s => s.startsWith('UPDATE users SET password_hash'))).toBe(false)
  })
  it('reset: every code failure looks the same from outside (no code, wrong code, center down)', async () => {
    const seen = new Set<string>()
    for (const scenario of ['no-code', 'wrong', 'down'] as const) {
      const f = await authFixture()
      if (scenario !== 'no-code') await f.sms.sendReset(PHONE, ctx(), async () => true)
      if (scenario === 'down') f.center.s.down = true
      const err = await f.auth.resetPasswordByPhone({ phone: PHONE, code: scenario === 'wrong' ? '000000' : CODE, password: 'new-password-1' }).catch(e => e)
      seen.add(`${err.code}|${err.status}|${err.message}`)
    }
    expect([...seen]).toEqual(['SMS_CODE_INVALID|400|验证码错误'])
  })
  it('bind: a number taken by someone else is refused without consuming the code', async () => {
    const { sms, center } = setup()
    const { db } = fakeDb((sql) => sql.startsWith('SELECT 1 FROM users WHERE (phone=$1 OR username=$1)') ? { rows: [{}], rowCount: 1 } : undefined)
    await sms.send(PHONE, 'bind', ctx())
    await expect(new PhoneAuth(db, { sender: null, production: true }).bindPhone('u1', PHONE, CODE, consume => sms.check(PHONE, 'bind', CODE, consume))).rejects.toMatchObject({ code: 'PHONE_TAKEN' })
    expect(center.ops()).not.toContain('ticket.redeem')
  })
  it('bind: consumes then writes the phone', async () => {
    const { sms, center } = setup(), { db, calls } = resetDb()
    await sms.send(PHONE, 'bind', ctx())
    await expect(new PhoneAuth(db, { sender: null, production: true }).bindPhone('u1', PHONE, CODE, consume => sms.check(PHONE, 'bind', CODE, consume))).resolves.toEqual({ ok: true })
    expect(center.ops().at(-1)).toBe('ticket.redeem')
    expect(calls.at(-1)).toContain('UPDATE users SET phone')
  })
})

describe('vendored SDK over real HTTP', () => {
  /** 本机起一个假中心端口：记下请求，按路径回固定响应。 */
  async function fakeCenterServer(reply: (path: string) => { status: number; body: unknown }) {
    const seen: { method: string; path: string; headers: IncomingHttpHeaders; body: Record<string, unknown> }[] = []
    const server = createServer((req, res) => {
      let raw = ''
      req.on('data', c => { raw += c })
      req.on('end', () => {
        const path = req.url ?? ''
        seen.push({ method: req.method ?? '', path, headers: req.headers, body: raw ? JSON.parse(raw) : {} })
        const r = reply(path)
        res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(r.body))
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    return { seen, url: `http://127.0.0.1:${port}`, close: () => new Promise<void>(resolve => server.close(() => resolve())) }
  }
  const env = (url: string) => ({ LCV_SITE_ID: 'proxysplit', LCV_HOST: 'proxysplit.zygskins.cn', LCV_SITE_SECRET: SECRET, LCV_URL: url })

  it('signs the request, sends the site Host header (not the bridge address) and maps the answer', async () => {
    const center = await fakeCenterServer(() => ({ status: 200, body: { ok: true, verificationId: 'vid-http', expiresIn: 300, resendAfter: 60 } }))
    const kv = fakeRedis()
    try {
      const sms = createSmsCenterFromEnv(env(center.url), kv.redis)
      await expect(sms?.send(PHONE, 'register', ctx())).resolves.toMatchObject({ ok: true, cooldownSeconds: 60 })
    } finally { await center.close() }
    const req = center.seen[0]
    expect(req).toMatchObject({ method: 'POST', path: '/v1/s/otp/send', body: { purpose: 'register', channel: 'sms', to: PHONE, captchaTicket: TICKET, clientIp: '203.0.113.9', deviceFp: 'fp-1' } })
    expect(req?.headers.host).toBe('proxysplit.zygskins.cn')
    expect(req?.headers['x-lcv-site']).toBe('proxysplit')
    expect(String(req?.headers['x-lcv-sign'])).toMatch(/^[0-9a-f]{64}$/)
    // 中心对带 X-Real-IP 的签名请求一律 404：SDK 自己不带，桥接的 nginx 也不许加
    expect(req?.headers['x-real-ip']).toBeUndefined()
    expect(JSON.stringify(req?.headers)).not.toContain(SECRET)
    expect(kv.data.get(`${LCV_KEY_PREFIX}vid:sms:register:${PHONE}`)).toBe('vid-http')
  })
  it('maps an HTTP 429 COOLDOWN and treats 5xx / a closed port as busy', async () => {
    let mode: 'cooldown' | 'broken' = 'cooldown'
    const center = await fakeCenterServer(() => mode === 'cooldown' ? { status: 429, body: { ok: false, error: 'COOLDOWN', resendAfter: 37 } } : { status: 502, body: {} })
    const sms = createSmsCenterFromEnv(env(center.url), fakeRedis().redis)
    try {
      await expect(sms?.send(PHONE, 'register', ctx())).rejects.toMatchObject({ code: 'SMS_COOLDOWN', extra: { cooldownSeconds: 37 } })
      mode = 'broken'
      await expect(sms?.send(PHONE, 'register', ctx())).rejects.toMatchObject({ code: 'SMS_BUSY', status: 503 })
    } finally { await center.close() }
    await expect(sms?.send(PHONE, 'register', ctx())).rejects.toMatchObject({ code: 'SMS_BUSY', status: 503 })
  })
})

describe('mode switch', () => {
  it('stays local unless all three LCV_* values are set, and needs Redis in center mode', () => {
    const { redis } = fakeRedis()
    expect(createSmsCenterFromEnv({}, redis)).toBeNull()
    expect(createSmsCenterFromEnv({ LCV_SITE_ID: 'proxysplit', LCV_HOST: 'proxysplit.zygskins.cn' }, redis)).toBeNull()
    const env = { LCV_SITE_ID: 'proxysplit', LCV_HOST: 'proxysplit.zygskins.cn', LCV_SITE_SECRET: SECRET, LCV_URL: 'http://172.20.0.1:18977' }
    expect(createSmsCenterFromEnv(env, redis)).toBeInstanceOf(SmsCenter)
    expect(() => createSmsCenterFromEnv(env, undefined)).toThrow(/REDIS_URL/)
  })
  it('local mode is untouched: the old sender path runs and the ticket is ignored', async () => {
    const sent: string[] = []
    const { db, calls } = fakeDb((sql) => {
      if (sql.includes('FROM sms_codes WHERE phone=$1')) return { rows: [{ dbNow: new Date(), lastAt: null, today: 0, hour: 0 }], rowCount: 1 }
      if (sql.includes('count(*)::int AS n FROM sms_codes')) return { rows: [{ n: 0 }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO sms_codes')) return { rows: [{ id: '7' }], rowCount: 1 }
      if (sql.startsWith('SELECT 1 FROM users')) return { rows: [], rowCount: 0 }
      return undefined
    })
    const auth = await AuthService.create({ pool: db } as unknown as PgStore, { accessSecret: ACCESS, refreshDays: 30, sms: { tplId: '1', production: false, log: m => sent.push(m) } })
    expect(auth.smsMode).toBe('local')
    // 老客户端（不带凭证）和新客户端（带凭证）在本地模式下结果一样
    await expect(auth.sendSmsCode({ phone: PHONE, purpose: 'register' }, null, { clientIp: '203.0.113.9' })).resolves.toEqual({ ok: true, cooldownSeconds: 60 })
    await expect(auth.sendSmsCode({ phone: PHONE, purpose: 'register' }, null, ctx())).resolves.toEqual({ ok: true, cooldownSeconds: 60 })
    expect(calls.filter(s => s.startsWith('INSERT INTO sms_codes')).length).toBe(2)
    expect(sent.length).toBe(2)
  })
  it('local mode logs a provider refusal with the masked phone and provider code only', async () => {
    const logs: string[] = []
    const { db } = fakeDb((sql) => {
      if (sql.includes('FROM sms_codes WHERE phone=$1')) return { rows: [{ dbNow: new Date(), lastAt: null, today: 0, hour: 0 }], rowCount: 1 }
      if (sql.includes('count(*)::int AS n FROM sms_codes')) return { rows: [{ n: 0 }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO sms_codes')) return { rows: [{ id: '7' }], rowCount: 1 }
      if (sql.startsWith('SELECT 1 FROM users')) return { rows: [], rowCount: 0 }
      return undefined
    })
    const refuse = (async () => new Response(JSON.stringify({ code: 22, msg: 'x' }), { status: 400 })) as unknown as typeof fetch
    const auth = await AuthService.create({ pool: db } as unknown as PgStore, { accessSecret: ACCESS, refreshDays: 30, sms: { apiKey: 'k-secret-value', tplId: '1', production: true, log: m => logs.push(m), fetch: refuse } })
    await expect(auth.sendSmsCode({ phone: PHONE, purpose: 'register' }, null, { clientIp: '' })).rejects.toMatchObject({ code: 'SMS_SEND_FAILED', status: 502 })
    expect(logs).toEqual(['[warn] sms yunpian send failed phone=138****8000 http=400 code=22'])
  })
})

describe('contract', () => {
  it('accepts requests with and without a ticket and caps its length', () => {
    expect(smsSendSchema.parse({ phone: PHONE, purpose: 'register' }).captchaTicket).toBeUndefined()
    expect(smsSendSchema.parse({ phone: PHONE, purpose: 'register', captchaTicket: '' }).captchaTicket).toBe('')
    expect(smsSendSchema.safeParse({ phone: PHONE, purpose: 'reset', captchaTicket: 'x'.repeat(2048) }).success).toBe(true)
    expect(smsSendSchema.safeParse({ phone: PHONE, purpose: 'reset', captchaTicket: 'x'.repeat(2049) }).success).toBe(false)
    expect(smsSendSchema.safeParse({ phone: PHONE, purpose: 'reset', deviceFp: 'x'.repeat(129) }).success).toBe(false)
  })
  it('normalizes phones the same way as the company SDK (the center keys limits by the normalized number)', () => {
    for (const raw of ['+86 138-0013-8000', '008613800138000', '8613800138000', '13800138000']) {
      expect(normalizePhone(raw)).toBe(sdkNormalizePhone(raw))
      expect(isValidPhone(sdkNormalizePhone(raw))).toBe(true)
    }
  })
})
