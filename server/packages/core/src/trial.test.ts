// 试用资格：一个核实身份（手机号 / 合作方账号）只发一次，没有核实身份的不发；注册来源 24 小时限额，IPv6 按 /64。
import { describe, expect, it } from 'vitest'
import { PgStore } from './store.js'
import { assertIpRegistrationBudget, decideTrial, ipHash, ipKey, trialIdentity } from './trial.js'

type Call = { sql: string; params: unknown[] }
type Reply = { rows: Record<string, unknown>[]; rowCount?: number } | undefined

function fakeDb(answer: (sql: string, params: unknown[]) => Reply) {
  const calls: Call[] = []
  const query = async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return answer(sql, params) ?? { rows: [], rowCount: 0 } }
  const pool = { query, connect: async () => ({ query, release: () => {} }) }
  const store = Object.create(PgStore.prototype) as PgStore
  Object.assign(store, { pool, bindReferrerInTx: async () => {} })
  return { calls, store, tx: { query } }
}
const has = (calls: Call[], part: string) => calls.some(c => c.sql.includes(part))
const PHONE = '13900139000'

/** 库里的现状：哪些身份 / 硬件领过，这个账号绑了什么。 */
function world(w: { claimedIdentities?: string[]; claimedHardware?: string[]; identities?: Array<{ kind: string; value: string }>; recentFromIp?: number; settings?: Record<string, unknown>; user?: Record<string, unknown> }) {
  return fakeDb((sql, params) => {
    if (sql.includes('FROM system_settings')) return { rows: Object.entries(w.settings ?? {}).map(([key, value]) => ({ key, value })) }
    if (sql.includes('FROM trial_identity_claims')) return { rows: (params[0] as string[]).some(h => w.claimedIdentities?.includes(h)) ? [{}] : [] }
    if (sql.includes('FROM trial_claims')) return { rows: w.claimedHardware?.includes(String(params[0])) ? [{}] : [] }
    if (sql.includes('FROM user_identities')) return { rows: w.identities ?? [] }
    if (sql.includes('registration_ip_hash=$1 AND created_at>')) return { rows: [{ n: w.recentFromIp ?? 0 }] }
    if (sql.includes('count(*)')) return { rows: [{ n: 0 }] }
    if (sql.includes('FROM plans')) return { rows: [{ id: 'plan-trial' }] }
    if (sql.includes('FROM users WHERE id=$1 FOR UPDATE')) return { rows: [w.user ?? { id: 'u1', trial_started_at: null }] }
    if (sql.includes('INSERT INTO users')) return { rows: [{ id: 'u1', username: 'alice' }], rowCount: 1 }
    return undefined
  })
}
const reg = (over: { phone?: string | null; ip?: string } = {}) => ({ username: 'alice', email: over.phone === null ? 'a@b.c' : null, phone: over.phone === undefined ? PHONE : over.phone, passwordHash: 'h', hardwareHash: 'hw-1', ip: over.ip ?? '203.0.113.9' })

describe('来源键', () => {
  it('IPv4 原样（和历史摘要一致），IPv6 取 /64，IPv4 映射地址按 IPv4', () => {
    expect(ipKey('203.0.113.9')).toBe('203.0.113.9')
    expect(ipKey('::ffff:203.0.113.9')).toBe('203.0.113.9')
    expect(ipKey('2408:8207:1234:5678:aaaa:bbbb:cccc:dddd')).toBe('2408:8207:1234:5678::/64')
    expect(ipKey('2408:8207:1234:5678::1')).toBe('2408:8207:1234:5678::/64')
    expect(ipKey('2408:8207::1')).toBe('2408:8207:0:0::/64')
    expect(ipKey('::1')).toBe('0:0:0:0::/64')
    expect(ipHash('2408:8207:1234:5678::1')).toBe(ipHash('2408:8207:1234:5678:ffff:ffff:ffff:ffff'))
    expect(ipHash('2408:8207:1234:5678::1')).not.toBe(ipHash('2408:8207:1234:5679::1'))
  })
})

describe('试用资格（decideTrial）', () => {
  const settings = new Map<string, unknown>()
  const phone = trialIdentity('phone', PHONE)
  it('没有核实身份不发；身份领过不发；硬件领过不发；都没领过才发', async () => {
    expect(await decideTrial(world({}).tx, { identities: [], hardwareHash: 'hw-1', settings })).toEqual({ grant: false, reason: 'no_identity' })
    expect(await decideTrial(world({ claimedIdentities: [phone.hash] }).tx, { identities: [phone], hardwareHash: 'hw-1', settings })).toEqual({ grant: false, reason: 'identity_claimed' })
    expect(await decideTrial(world({ claimedHardware: ['hw-1'] }).tx, { identities: [phone], hardwareHash: 'hw-1', settings })).toEqual({ grant: false, reason: 'hardware_claimed' })
    expect(await decideTrial(world({}).tx, { identities: [phone], hardwareHash: 'hw-1', settings })).toMatchObject({ grant: true, days: 3, planId: 'plan-trial' })
    expect(await decideTrial(world({}).tx, { identities: [phone], hardwareHash: 'hw-1', settings: new Map([['trial_days', 0]]) })).toEqual({ grant: false, reason: 'disabled' })
  })
  it('账号有多个身份时，任何一个领过都不发', async () => {
    const partner = trialIdentity('powervpn', 'pv-7')
    expect(await decideTrial(world({ claimedIdentities: [partner.hash] }).tx, { identities: [phone, partner], hardwareHash: 'hw-9', settings })).toEqual({ grant: false, reason: 'identity_claimed' })
  })
})

describe('客户端注册（registerTrialUser）', () => {
  it('手机号注册：发试用，并按身份记一条领取记录', async () => {
    const w = world({})
    await expect(w.store.registerTrialUser(reg())).resolves.toMatchObject({ trialGranted: true, trialDays: 3 })
    const claim = w.calls.find(c => c.sql.includes('INSERT INTO trial_identity_claims'))
    expect(claim?.params[0]).toEqual([trialIdentity('phone', PHONE).hash])
    expect(claim?.params[1]).toEqual(['phone'])
    expect(has(w.calls, 'INSERT INTO trial_claims')).toBe(true)
  })
  it('同一个手机号换一台新电脑再注册：账号照建，试用不再发', async () => {
    const w = world({ claimedIdentities: [trialIdentity('phone', PHONE).hash] })
    await expect(w.store.registerTrialUser(reg())).resolves.toMatchObject({ trialGranted: false, trialDays: 0 })
    expect(has(w.calls, 'INSERT INTO users')).toBe(true)
    expect(has(w.calls, 'INSERT INTO licenses')).toBe(false)
  })
  it('只有邮箱（老接口，没有核实身份）：账号照建，不发试用', async () => {
    const w = world({})
    await expect(w.store.registerTrialUser(reg({ phone: null }))).resolves.toMatchObject({ trialGranted: false })
    expect(has(w.calls, 'INSERT INTO licenses')).toBe(false)
    expect(has(w.calls, 'INSERT INTO trial_claims')).toBe(false)
  })
  it('同一来源 24 小时内注册数到上限：拒绝，且还没建号', async () => {
    const w = world({ recentFromIp: 10 })
    await expect(w.store.registerTrialUser(reg())).rejects.toThrow('IP_ACCOUNT_LIMIT')
    expect(has(w.calls, 'INSERT INTO users')).toBe(false)
    const count = w.calls.find(c => c.sql.includes('registration_ip_hash=$1 AND created_at>'))
    expect(count?.sql).toContain("interval '24 hours'")
    expect(count?.params).toEqual([ipHash('203.0.113.9')])
    const off = world({ recentFromIp: 99, settings: { max_client_accounts_per_ip: 0 } })
    await expect(off.store.registerTrialUser(reg())).resolves.toMatchObject({ trialGranted: true })
  })
  it('IPv6 换同一 /64 里的地址绕不过限额，注册来源也按 /64 记', async () => {
    const w = world({})
    await w.store.registerTrialUser(reg({ ip: '2408:8207:1234:5678:1:2:3:4' }))
    const insert = w.calls.find(c => c.sql.includes('INSERT INTO users'))
    expect(insert?.params).toContain(ipHash('2408:8207:1234:5678::'))
  })
})

describe('官网注册（registerWebUser）', () => {
  it('上限只看最近 24 小时（以前是永久累计，共用出口的后来者永远注册不了）', async () => {
    const w = world({ recentFromIp: 3 })
    await expect(w.store.registerWebUser({ username: 'alice', email: null, phone: PHONE, passwordHash: 'h', ip: '203.0.113.9' })).rejects.toThrow('IP_ACCOUNT_LIMIT')
    expect(w.calls.find(c => c.sql.includes('registration_ip_hash=$1'))?.sql).toContain("interval '24 hours'")
    const ok = world({ recentFromIp: 2 })
    await expect(ok.store.registerWebUser({ username: 'alice', email: null, phone: PHONE, passwordHash: 'h', ip: '203.0.113.9' })).resolves.toMatchObject({ id: 'u1' })
  })
  it('assertIpRegistrationBudget：0 = 不限，不查库', async () => {
    const w = world({ recentFromIp: 99 })
    await assertIpRegistrationBudget(w.tx, '203.0.113.9', 0)
    expect(w.calls).toEqual([])
  })
})

describe('登录补发（claimTrialOnLogin）', () => {
  it('合作方账号第一次登录：发试用并记合作方身份', async () => {
    const w = world({ identities: [{ kind: 'powervpn', value: 'pv-7' }] })
    await expect(w.store.claimTrialOnLogin('u1', 'hw-1', '203.0.113.9')).resolves.toMatchObject({ trialDays: 3 })
    expect(w.calls.find(c => c.sql.includes('INSERT INTO trial_identity_claims'))?.params[0]).toEqual([trialIdentity('powervpn', 'pv-7').hash])
  })
  it('没手机号也没合作方账号：不发；身份领过：不发；账号自己领过：不发', async () => {
    for (const w of [
      world({}),
      world({ identities: [{ kind: 'phone', value: PHONE }], claimedIdentities: [trialIdentity('phone', PHONE).hash] }),
      world({ identities: [{ kind: 'phone', value: PHONE }], user: { id: 'u1', trial_started_at: '2026-01-01' } }),
    ]) {
      await expect(w.store.claimTrialOnLogin('u1', 'hw-1', '203.0.113.9')).resolves.toBeNull()
      expect(has(w.calls, 'INSERT INTO licenses')).toBe(false)
    }
  })
})

describe('迁移 0026 回填', () => {
  it('SQL 里的身份摘要前缀与 trialIdentity 用的是同一个', async () => {
    const { readFile } = await import('node:fs/promises')
    const sql = await readFile(new URL('../../db/migrations/0026_trial_identity.sql', import.meta.url), 'utf8')
    expect(sql).toContain("'proxysplit-trial-identity-v1:phone:' || phone")
    expect(sql).toContain("'proxysplit-trial-identity-v1:' || i.provider || ':' || i.external_id")
    expect(sql).not.toMatch(/DELETE FROM|DROP |UPDATE /i)
  })
})

// 领过试用的账号换绑一个新手机号：新号也要记成领过，否则拿新号再注册一个账号又能领一次。
describe('绑定手机号时带上领取记录（bindPhone）', () => {
  const bind = async () => {
    const calls: Call[] = []
    const query = async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: [], rowCount: 1 } }
    const { PhoneAuth } = await import('./phone-auth.js')
    const phone = new PhoneAuth({ query, connect: async () => ({ query, release: () => {} }) }, { sender: null, production: true })
    await phone.bindPhone('u1', '13800138000', '123456', async () => {})
    return calls
  }
  it('改手机号和记领取记录在同一个事务里；只给领过试用的账号记（条件在 SQL 里），重复不报错', async () => {
    const calls = await bind()
    const words = calls.map(c => c.sql.trim().split(/\s+/)[0])
    expect(words.slice(words.indexOf('BEGIN'))).toEqual(['BEGIN', 'UPDATE', 'INSERT', 'COMMIT'])
    const carry = calls.find(c => c.sql.includes('INSERT INTO trial_identity_claims'))
    expect(carry?.params).toEqual(['u1', trialIdentity('phone', '13800138000').hash])
    expect(carry?.sql).toContain('u.trial_started_at IS NOT NULL')
    expect(carry?.sql).toContain('FROM trial_claims c WHERE c.user_id=u.id')
    expect(carry?.sql).toContain('ON CONFLICT(identity_hash) DO NOTHING')
  })
})
