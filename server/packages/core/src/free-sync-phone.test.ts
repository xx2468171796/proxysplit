import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { configShareSchema, phoneSchema, registerSchema } from '@proxysplit/contracts'
import { looksLikePhone, maskPhone, normalizePhone } from '@proxysplit/shared'
import { effective, licenseView, profileQuota } from './entitlement.js'
import { beijingDay, checkSmsCode, devSmsLog, hashSmsCode, PhoneAuth, sameHash, SMS_HOURLY_MAX, SMS_MAX_ATTEMPTS, smsSendDecision } from './phone-auth.js'
import { ConfigSyncStore, profileAad, SYNC_KEY_VERSION, SyncCipher, syncAad, syncDecision } from './config-sync.js'
import { ConfigProfilesStore, genShareCode, SHARE_ALPHABET } from './config-profiles.js'
import type { Entitlement } from './store.js'
import type { Db, QueryResult } from './telemetry-store.js'

const ent = (over: Partial<Entitlement> = {}): Entitlement => ({ licenseId: 'l', planId: 'p', planCode: 'standard-month', planName: '普通会员', tier: 'standard', maxDevices: 3, features: [], expiresAt: new Date('2027-01-01'), lifetime: false, status: 'active', ...over })
type Handler = (sql: string, params: unknown[]) => QueryResult | undefined
function fakeDb(handler: Handler) {
  const calls: { sql: string; params: unknown[] }[] = []
  const query = async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return handler(sql, params) ?? { rows: [], rowCount: 1 } }
  const db: Db = { query, connect: async () => ({ query, release: () => {} }) }
  return { db, calls }
}

describe('effective entitlement', () => {
  it('gives free users one device and no sync', () => {
    const e = effective({ role: 'user' }, null, { defaultDeviceLimit: 1 })
    expect(e).toMatchObject({ member: false, freeDevices: 1, planDevices: 0, deviceLimit: 1 })
    expect(e.ent).toMatchObject({ licenseId: 'free', planCode: 'free', tier: 'free', maxDevices: 1, lifetime: true })
    expect(profileQuota(e)).toBe(0)
  })
  it('stacks the free slot on top of plan devices for members', () => {
    expect(effective({ role: 'user' }, ent({ maxDevices: 3 }), { defaultDeviceLimit: 1 })).toMatchObject({ member: true, deviceLimit: 4, planDevices: 3, ent: { maxDevices: 4 } })
    const premium = effective({ role: 'user' }, ent({ tier: 'premium', maxDevices: 8 }), { defaultDeviceLimit: 1 })
    expect(premium.deviceLimit).toBe(9)
    expect(profileQuota(premium)).toBe(5)
    expect(profileQuota(effective({ role: 'user' }, ent(), { defaultDeviceLimit: 1 }))).toBe(1)
    expect(licenseView(premium)).toMatchObject({ member: true, freeDevices: 1, planDevices: 8, maxDevices: 9, tier: 'premium' })
  })
  it('keeps admins unlimited', () => {
    const e = effective({ role: 'admin' }, null, { defaultDeviceLimit: 1 })
    expect(e.deviceLimit).toBe(Number.MAX_SAFE_INTEGER)
    expect(e.member).toBe(true)
  })
})

describe('phone helpers', () => {
  it('normalizes mainland numbers and rejects others', () => {
    expect(phoneSchema.parse('+86 138-0013-8000')).toBe('13800138000')
    expect(phoneSchema.parse('008613800138000')).toBe('13800138000')
    expect(phoneSchema.parse('8613800138000')).toBe('13800138000')
    for (const bad of ['12800138000', '1380013800', '138001380001', 'abc']) expect(phoneSchema.safeParse(bad).success).toBe(false)
    expect(maskPhone('13800138000')).toBe('138****8000')
    expect(maskPhone(null)).toBeNull()
    expect(looksLikePhone('13800138000')).toBe(true)
    expect(looksLikePhone('alice')).toBe(false)
  })
  it('register accepts legacy email-only and requires a code with a phone', () => {
    const device = { fingerprint: 'f'.repeat(32), name: 'pc', platform: 'windows', appVersion: '1.10.11' }
    expect(registerSchema.safeParse({ username: 'alice', email: 'a@b.cn', password: 'password1', device }).success).toBe(true)
    expect(registerSchema.safeParse({ username: 'alice', phone: '13800138000', password: 'password1', device }).success).toBe(false)
    expect(registerSchema.safeParse({ username: 'alice', phone: '13800138000', code: '123456', password: 'password1', device }).success).toBe(true)
    expect(registerSchema.safeParse({ username: 'alice', password: 'password1', device }).success).toBe(false)
  })
})

describe('sms codes', () => {
  const now = new Date('2026-10-29T10:00:00Z')
  const row = { id: '1', codeHash: hashSmsCode('13800138000', 'reset', '123456'), expiresAt: new Date(now.getTime() + 60_000), attempts: 0 }
  it('verifies, expires and caps attempts', () => {
    expect(checkSmsCode(row, hashSmsCode('13800138000', 'reset', '123456'), now)).toBe('ok')
    expect(checkSmsCode(row, hashSmsCode('13800138000', 'reset', '000000'), now)).toBe('mismatch')
    expect(checkSmsCode(row, hashSmsCode('13800138000', 'register', '123456'), now)).toBe('mismatch')
    expect(checkSmsCode({ ...row, attempts: SMS_MAX_ATTEMPTS }, row.codeHash, now)).toBe('exhausted')
    expect(checkSmsCode({ ...row, expiresAt: now }, row.codeHash, now)).toBe('expired')
    expect(checkSmsCode(null, row.codeHash, now)).toBe('missing')
  })
  it('enforces the 60s cooldown and daily cap', () => {
    expect(smsSendDecision({ lastAt: new Date(now.getTime() - 30_000), todayCount: 1 }, now)).toBe('cooldown')
    expect(smsSendDecision({ lastAt: new Date(now.getTime() - 61_000), todayCount: 10 }, now)).toBe('daily')
    expect(smsSendDecision({ lastAt: null, todayCount: 9 }, now)).toBe('ok')
  })
  it('uses the Beijing calendar day', () => {
    expect(beijingDay(new Date('2026-10-29T15:59:59Z'))).toBe('2026-10-29')
    expect(beijingDay(new Date('2026-10-29T16:00:00Z'))).toBe('2026-10-30')
  })
  it('rejects a second reset on the same day and does not change the password', async () => {
    const code = '654321', phone = '13800138000'
    const { db, calls } = fakeDb(sql => {
      if (sql.startsWith('SELECT id FROM users WHERE phone')) return { rows: [{ id: 'u1' }], rowCount: 1 }
      if (sql.includes('FROM sms_codes')) return { rows: [{ id: '9', codeHash: hashSmsCode(phone, 'reset', code), expiresAt: new Date(Date.now() + 60_000), attempts: 0 }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO password_reset_daily')) return { rows: [], rowCount: 0 }
      return undefined
    })
    await expect(new PhoneAuth(db, { sender: null, production: false }).resetPassword(phone, code, 'hash')).rejects.toMatchObject({ code: 'RESET_DAILY_LIMIT', status: 429 })
    expect(calls.some(c => c.sql.startsWith('UPDATE users SET password_hash'))).toBe(false)
    expect(calls.some(c => c.sql === 'ROLLBACK')).toBe(true)
  })
  it('counts a wrong code as an attempt', async () => {
    const { db, calls } = fakeDb(sql => sql.includes('FROM sms_codes') ? { rows: [{ id: '9', codeHash: 'x', expiresAt: new Date(Date.now() + 60_000), attempts: 2 }], rowCount: 1 } : undefined)
    await expect(new PhoneAuth(db, { sender: null, production: false }).verify('13800138000', 'bind', '111111')).rejects.toMatchObject({ code: 'SMS_CODE_INVALID' })
    expect(calls.some(c => c.sql.startsWith('UPDATE sms_codes SET attempts=attempts+1'))).toBe(true)
  })
  it('refuses to send in production without an SMS key', async () => {
    const { db } = fakeDb(() => ({ rows: [], rowCount: 0 }))
    await expect(new PhoneAuth(db, { sender: null, production: true }).send('13800138000', 'register', null)).rejects.toMatchObject({ code: 'SMS_UNAVAILABLE', status: 503 })
  })
})

describe('config sync', () => {
  const cipher = new SyncCipher(randomBytes(32).toString('base64'))
  it('decides optimistic-lock outcomes', () => {
    expect(syncDecision(null, 0)).toBe('insert')
    expect(syncDecision(null, 3)).toBe('conflict')
    expect(syncDecision(4, 4)).toBe('update')
    expect(syncDecision(4, 3)).toBe('conflict')
  })
  it('round-trips encryption and rejects a bad key', () => {
    const sealed = cipher.seal('{"a":1}', syncAad('u1'))
    expect(sealed.ciphertext[0]).toBe(SYNC_KEY_VERSION)
    expect(cipher.open(sealed, syncAad('u1'))).toBe('{"a":1}')
    // AAD 绑定归属：搬到别的用户 / 配置下解不开
    expect(() => cipher.open(sealed, syncAad('u2'))).toThrow()
    expect(() => cipher.open(sealed, profileAad('u1'))).toThrow()
    expect(() => cipher.open({ ...sealed, ciphertext: Buffer.concat([Buffer.from([9]), sealed.ciphertext.subarray(1)]) }, syncAad('u1'))).toThrow(/加密版本/)
    expect(() => new SyncCipher(randomBytes(16).toString('base64'))).toThrow()
    expect(() => new SyncCipher(undefined).seal('x', syncAad('u1'))).toThrow(/云同步/)
  })
  it('returns the current metadata on a version conflict', async () => {
    const { db, calls } = fakeDb(sql => sql.startsWith('SELECT version') || sql.startsWith('SELECT version,updated_at')
      ? { rows: [{ version: 5, updatedAt: new Date(), deviceName: 'home', size: 10 }], rowCount: 1 } : undefined)
    const r = await new ConfigSyncStore(db, cipher).put('u1', '{}', 4, 'office')
    expect(r).toMatchObject({ ok: false, current: { exists: true, version: 5, deviceName: 'home' } })
    expect(calls.some(c => c.sql.startsWith('UPDATE config_sync'))).toBe(false)
  })
})

describe('config profiles', () => {
  const cipher = new SyncCipher(randomBytes(32).toString('base64'))
  it('generates unambiguous 8-char share codes', () => {
    for (let i = 0; i < 50; i++) expect(genShareCode()).toMatch(new RegExp(`^[${SHARE_ALPHABET}]{8}$`))
    expect(SHARE_ALPHABET).not.toMatch(/[IO01]/)
  })
  it('enforces the per-tier quota', async () => {
    const { db } = fakeDb(sql => sql.startsWith('SELECT count(*)::int AS n FROM config_profiles') ? { rows: [{ n: 1 }], rowCount: 1 } : undefined)
    await expect(new ConfigProfilesStore(db, cipher).create('u1', { name: 'a', payload: '{}' }, 'pc', 1)).rejects.toMatchObject({ code: 'PROFILE_QUOTA', status: 403 })
  })
  it('answers an unknown share code with the uniform 404 and records the failure atomically', async () => {
    const { db, calls } = fakeDb(sql => sql.startsWith('SELECT count(*)') ? { rows: [{ n: 0 }], rowCount: 1 } : sql.startsWith('SELECT id,name') ? { rows: [], rowCount: 0 } : undefined)
    await expect(new ConfigProfilesStore(db, cipher).importShare('u1', 'ABCDEFGH', 'pw', '1.2.3.4')).rejects.toMatchObject({ code: 'SHARE_INVALID', status: 404 })
    expect(calls.filter(c => c.sql.startsWith('INSERT INTO config_attempts')).map(c => [c.params[0], c.params[1]]))
      .toEqual([['share_user', 'u1'], ['share_code_ip', 'ABCDEFGH|1.2.3.4'], ['share_code', 'ABCDEFGH']])
    const sqls = calls.map(c => c.sql)
    expect(sqls[0]).toBe('BEGIN')
    expect(calls.filter(c => c.sql.includes('pg_advisory_xact_lock')).map(c => c.params[0])).toEqual(['share_user|u1', 'share_code_ip|ABCDEFGH|1.2.3.4', 'share_code|ABCDEFGH'])
    const lastInsert = sqls.map(s => s.startsWith('INSERT INTO config_attempts')).lastIndexOf(true)
    expect(sqls.indexOf('COMMIT')).toBeGreaterThan(lastInsert)
  })
  it('locks a share code per IP after 10 failures but globally only after 100', async () => {
    const counts: Record<string, number> = { share_user: 0, share_code_ip: 10, share_code: 10 }
    const make = () => fakeDb((sql, p) => sql.startsWith('SELECT count(*)') ? { rows: [{ n: counts[String(p[0])] ?? 0 }], rowCount: 1 } : sql.startsWith('SELECT id,name') ? { rows: [], rowCount: 0 } : undefined)
    await expect(new ConfigProfilesStore(make().db, cipher).importShare('u1', 'ABCDEFGH', 'pw', 'ip1')).rejects.toMatchObject({ code: 'SHARE_LOCKED', status: 429 })
    counts.share_code_ip = 0
    await expect(new ConfigProfilesStore(make().db, cipher).importShare('u1', 'ABCDEFGH', 'pw', 'ip2')).rejects.toMatchObject({ code: 'SHARE_INVALID' })
    counts.share_code = 100
    await expect(new ConfigProfilesStore(make().db, cipher).importShare('u1', 'ABCDEFGH', 'pw', 'ip3')).rejects.toMatchObject({ code: 'SHARE_LOCKED' })
  })
  it('locks a user after 10 import attempts in 10 minutes', async () => {
    const { db } = fakeDb(sql => sql.startsWith('SELECT count(*)') ? { rows: [{ n: 10 }], rowCount: 1 } : undefined)
    await expect(new ConfigProfilesStore(db, cipher).importShare('u1', 'ABCDEFGH', 'pw')).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 })
  })
  it('requires the restore password for every change to a locked profile', async () => {
    const sealed = cipher.seal('{}', profileAad('p1'))
    const { db, calls } = fakeDb(sql => sql.startsWith('SELECT count(*)') ? { rows: [{ n: 0 }], rowCount: 1 }
      : sql.startsWith('SELECT id,name') ? { rows: [{ id: 'p1', name: 'a', size: 2, updatedAt: new Date(), restoreHash: '$argon2id$bad', ...sealed }], rowCount: 1 } : undefined)
    const s = new ConfigProfilesStore(db, cipher), wrong = { code: 'RESTORE_PASSWORD_WRONG', status: 403 }
    await expect(s.restore('u1', 'p1', undefined)).rejects.toMatchObject(wrong)
    await expect(s.update('u1', 'p1', { name: 'b' }, 'pc')).rejects.toMatchObject(wrong)
    await expect(s.update('u1', 'p1', { name: 'b', password: 'nope' }, 'pc')).rejects.toMatchObject(wrong)
    await expect(s.share('u1', 'p1', 'secret1')).rejects.toMatchObject(wrong)
    await expect(s.unshare('u1', 'p1')).rejects.toMatchObject(wrong)
    await expect(s.remove('u1', 'p1')).rejects.toMatchObject(wrong)
    await expect(s.setRestorePassword('u1', 'p1', { password: null })).rejects.toMatchObject(wrong)
    expect(calls.some(c => /^(UPDATE|DELETE) config_profiles/.test(c.sql))).toBe(false)
    expect(calls.filter(c => c.sql.startsWith('INSERT INTO config_attempts')).every(c => c.params[0] === 'restore')).toBe(true)
  })
  it('stops checking after the restore lockout', async () => {
    const sealed = cipher.seal('{}', profileAad('p1'))
    const { db } = fakeDb(sql => sql.startsWith('SELECT count(*)') ? { rows: [{ n: 10 }], rowCount: 1 }
      : sql.startsWith('SELECT id,name') ? { rows: [{ id: 'p1', name: 'a', size: 2, updatedAt: new Date(), restoreHash: '$argon2id$bad', ...sealed }], rowCount: 1 } : undefined)
    await expect(new ConfigProfilesStore(db, cipher).remove('u1', 'p1', 'x')).rejects.toMatchObject({ code: 'RESTORE_LOCKED', status: 429 })
  })
  it('requires a 6+ character share password', () => {
    expect(configShareSchema.safeParse({ password: '12345' }).success).toBe(false)
    expect(configShareSchema.safeParse({ password: '123456', restorePassword: 'r' }).success).toBe(true)
  })
})

describe('sms hardening', () => {
  const phone = '13800138000'
  it('verifies with one atomic UPDATE and a constant-time compare', async () => {
    const { db, calls } = fakeDb(sql => sql.startsWith('UPDATE sms_codes SET attempts') ? { rows: [{ id: '7', codeHash: hashSmsCode(phone, 'bind', '123456') }], rowCount: 1 } : undefined)
    await expect(new PhoneAuth(db, { sender: null, production: false }).verify(phone, 'bind', '123456')).resolves.toBe('7')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.sql).toMatch(/attempts<\$3 RETURNING id/)
    expect(calls[0]!.sql).toMatch(/consumed_at IS NULL AND expires_at>now\(\)/)
    expect(sameHash('abc', 'abc')).toBe(true)
    expect(sameHash('abc', 'abd')).toBe(false)
    expect(sameHash('abc', 'abcd')).toBe(false)
  })
  it('rejects when no usable code is left (exhausted / expired / consumed)', async () => {
    const { db } = fakeDb(sql => sql.startsWith('UPDATE sms_codes SET attempts') ? { rows: [], rowCount: 0 } : undefined)
    await expect(new PhoneAuth(db, { sender: null, production: false }).verify(phone, 'bind', '123456')).rejects.toMatchObject({ code: 'SMS_CODE_INVALID' })
  })
  it('consumes atomically', async () => {
    let n = 0
    const { db, calls } = fakeDb(sql => sql.startsWith('UPDATE sms_codes SET consumed_at') ? { rows: n++ === 0 ? [{ id: '7' }] : [], rowCount: 0 } : undefined)
    const pa = new PhoneAuth(db, { sender: null, production: false })
    expect(await pa.consume('7')).toBe(true)
    expect(await pa.consume('7')).toBe(false)
    expect(calls[0]!.sql).toMatch(/consumed_at IS NULL RETURNING id/)
  })
  it('answers a register send for a taken number like a real send but sends nothing', async () => {
    const sent: string[] = []
    const { db, calls } = fakeDb(sql => sql.startsWith('SELECT 1 FROM users') ? { rows: [{ x: 1 }], rowCount: 1 }
      : sql.startsWith('SELECT max(created_at)') ? { rows: [{ lastAt: null, today: 0, hour: 0 }], rowCount: 1 } : undefined)
    const pa = new PhoneAuth(db, { sender: async p => { sent.push(p) }, production: true })
    await expect(pa.send(phone, 'register', null)).resolves.toEqual({ ok: true, cooldownSeconds: 60 })
    expect(sent).toEqual([])
    const ins = calls.find(c => c.sql.startsWith('INSERT INTO sms_codes'))
    expect(ins?.params[2]).toBe('silent')
    expect(ins?.params[4]).toBeInstanceOf(Date)
  })
  it('refuses to bind a number that is another account\'s phone or username', async () => {
    const { db } = fakeDb(sql => sql.startsWith('SELECT 1 FROM users') ? { rows: [{ x: 1 }], rowCount: 1 } : undefined)
    await expect(new PhoneAuth(db, { sender: null, production: false }).bindPhone('11111111-1111-4111-8111-111111111111', phone, '123456')).rejects.toMatchObject({ code: 'PHONE_TAKEN', status: 409 })
  })
  it('caps sends per hour', () => {
    const now = new Date('2026-10-29T10:00:00Z')
    expect(smsSendDecision({ lastAt: new Date(now.getTime() - 120_000), hourCount: SMS_HOURLY_MAX, todayCount: 5 }, now)).toBe('hourly')
    expect(smsSendDecision({ lastAt: new Date(now.getTime() - 120_000), hourCount: SMS_HOURLY_MAX - 1, todayCount: 5 }, now)).toBe('ok')
  })
  it('masks the phone in dev logs and shows the code only in development', () => {
    expect(devSmsLog('register', phone, '123456', false)).toBe('[dev] sms code register 138****8000: ******')
    expect(devSmsLog('register', phone, '123456', true)).toContain('123456')
    expect(devSmsLog('register', phone, '123456', true)).not.toContain(phone)
  })
  it('treats +86 / 86 prefixed numbers as phones in the login box', () => {
    expect(looksLikePhone('+86 138 0013 8000')).toBe(true)
    expect(looksLikePhone('8613800138000')).toBe(true)
    expect(normalizePhone('+8613800138000')).toBe(phone)
    expect(looksLikePhone('12800138000')).toBe(false)
  })
})
