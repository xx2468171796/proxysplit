import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { phoneSchema, registerSchema } from '@proxysplit/contracts'
import { looksLikePhone, maskPhone } from '@proxysplit/shared'
import { effective, licenseView, profileQuota } from './entitlement.js'
import { beijingDay, checkSmsCode, hashSmsCode, PhoneAuth, SMS_MAX_ATTEMPTS, smsSendDecision } from './phone-auth.js'
import { ConfigSyncStore, SyncCipher, syncDecision } from './config-sync.js'
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
    expect(cipher.open(cipher.seal('{"a":1}'))).toBe('{"a":1}')
    expect(() => new SyncCipher(randomBytes(16).toString('base64'))).toThrow()
    expect(() => new SyncCipher(undefined).seal('x')).toThrow(/云同步/)
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
  it('answers an unknown share code with the uniform 404 and records the failure', async () => {
    const { db, calls } = fakeDb(sql => sql.startsWith('SELECT count(*)') ? { rows: [{ n: 0 }], rowCount: 1 } : sql.startsWith('SELECT name') ? { rows: [], rowCount: 0 } : undefined)
    await expect(new ConfigProfilesStore(db, cipher).importShare('u1', 'ABCDEFGH', 'pw')).rejects.toMatchObject({ code: 'SHARE_INVALID', status: 404 })
    expect(calls.filter(c => c.sql.startsWith('INSERT INTO config_attempts')).map(c => c.params[0])).toEqual(['share_user', 'share_code'])
  })
  it('locks a user after 10 import attempts in 10 minutes', async () => {
    const { db } = fakeDb(sql => sql.startsWith('SELECT count(*)') ? { rows: [{ n: 10 }], rowCount: 1 } : undefined)
    await expect(new ConfigProfilesStore(db, cipher).importShare('u1', 'ABCDEFGH', 'pw')).rejects.toMatchObject({ status: 429 })
  })
  it('requires the restore password on a locked profile', async () => {
    const sealed = cipher.seal('{}')
    const { db } = fakeDb(sql => sql.startsWith('SELECT count(*)') ? { rows: [{ n: 0 }], rowCount: 1 }
      : sql.startsWith('SELECT id,name') ? { rows: [{ id: 'p1', name: 'a', size: 2, updatedAt: new Date(), restoreHash: '$argon2id$bad', ...sealed }], rowCount: 1 } : undefined)
    await expect(new ConfigProfilesStore(db, cipher).restore('u1', 'p1', undefined)).rejects.toMatchObject({ code: 'RESTORE_PASSWORD_WRONG', status: 403 })
  })
})
