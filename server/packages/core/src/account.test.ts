import { describe, expect, it } from 'vitest'
import { AppError } from '@proxysplit/shared'
import { argon2Hasher, createAccount, redisKv, toAppError, type AccountRedis } from './account.js'
import { hashPassword } from './auth.js'
import { ZhanghaoError } from './vendor/zhanghao/types.js'

/** 只认 zhanghao sql-pg store 在这几条后台动作里发的语句，够验证装配与「动作后吊销本项目会话」。 */
function fakePool() {
  const user = { id: '11111111-1111-4111-8111-111111111111', username: 'alice', password_hash: 'x', phone: null, email: null, nickname: null, avatar_key: null, role: 'user', status: 'active', banned_until: null as Date | null, banned_reason: null as string | null, register_meta: null, created_at: new Date(), updated_at: new Date() }
  const actions: Record<string, unknown>[] = []
  const query = async (text: string, params: unknown[] = []) => {
    const t = text.replace(/\s+/g, ' ').trim().toLowerCase()
    if (t.startsWith('select') && t.includes('from users')) return { rows: params[0] === user.id ? [user] : [] }
    if (t.startsWith('update users set')) {
      const cols = [...t.matchAll(/(\w+) = \$(\d+)/g)]
      for (const [, col, n] of cols) (user as Record<string, unknown>)[col!] = params[Number(n) - 1]
      return { rows: [] }
    }
    if (t.startsWith('insert into zh_admin_actions')) {
      if (actions.some(a => a.request_id === params[0])) return { rows: [] }
      const row = { id: String(actions.length + 1), request_id: params[0], operator_id: params[1], target_user_id: params[2], action: params[3], detail: params[4], created_at: new Date() }
      actions.push(row)
      return { rows: [row] }
    }
    if (t.includes('from zh_admin_actions where request_id')) return { rows: actions.filter(a => a.request_id === params[0]) }
    if (t.startsWith('delete from zh_admin_actions')) return { rows: [] }
    throw new Error('unexpected sql: ' + t)
  }
  return { pool: { query } as never, user, actions }
}

const setup = () => {
  const db = fakePool(), revoked: string[] = [], audits: string[] = []
  const account = createAccount(db.pool, {
    accessSecret: 'a'.repeat(40), revokeSessions: async id => { revoked.push(id) },
    audit: async (_a, action) => { audits.push(action) }, warn: () => {},
  })
  return { ...db, account, revoked, audits }
}
const ctx = (requestId: string) => ({ operatorId: '22222222-2222-4222-8222-222222222222', requestId })

describe('account (zhanghao)', () => {
  it('ban writes status + reason, revokes our sessions and audits once', async () => {
    const s = setup()
    const u = await s.account.ban(s.user.id, { days: 3, reason: '刷单' }, ctx('req-ban-0001'))
    expect(u.status).toBe('banned')
    expect(s.user.banned_reason).toBe('刷单')
    expect(s.user.banned_until).toBeInstanceOf(Date)
    expect(s.revoked).toEqual([s.user.id])
    await new Promise(r => setTimeout(r, 0))
    expect(s.audits).toEqual(['admin.user.ban'])
  })
  it('same requestId is a replay, not a second action', async () => {
    const s = setup()
    await s.account.ban(s.user.id, { days: null, reason: 'x' }, ctx('req-ban-0002'))
    await s.account.ban(s.user.id, { days: null, reason: 'x' }, ctx('req-ban-0002'))
    expect(s.actions).toHaveLength(1)
  })
  it('unban clears the ban and does not revoke', async () => {
    const s = setup()
    await s.account.ban(s.user.id, { days: null, reason: 'x' }, ctx('req-ban-0003'))
    s.revoked.length = 0
    const u = await s.account.unban(s.user.id, { reason: '误封' }, ctx('req-unban-01'))
    expect(u.status).toBe('active')
    expect(s.user.banned_until).toBeNull()
    expect(s.revoked).toEqual([])
  })
  it('refuses to ban / unban a suspended account (would overwrite the suspension)', async () => {
    const s = setup()
    s.user.status = 'suspended'
    const e = await s.account.unban(s.user.id, { reason: 'x' }, ctx('req-unban-02')).catch(x => x)
    expect((e as AppError).code).toBe('ACCOUNT_SUSPENDED')
    expect(s.user.status).toBe('suspended')
  })
  it('unknown user maps to a 404 AppError', async () => {
    const s = setup()
    const e = await s.account.ban('33333333-3333-4333-8333-333333333333', { days: 1, reason: 'x' }, ctx('req-ban-0004')).catch(x => x)
    expect(e).toBeInstanceOf(AppError)
    expect((e as AppError).code).toBe('NOT_FOUND')
  })
  it('hasher verifies project argon2 hashes and rejects NULL (read as "null")', async () => {
    const h = await hashPassword('secret-123')
    expect(await argon2Hasher.verify('secret-123', h)).toBe(true)
    expect(await argon2Hasher.verify('secret-123', 'null')).toBe(false)
    expect(argon2Hasher.owns!(h)).toBe(true)
  })
  it('redisKv setNx uses SET EX NX', async () => {
    const calls: unknown[][] = []
    const r = { set: async (...a: unknown[]) => { calls.push(a); return 'OK' } } as unknown as AccountRedis
    expect(await redisKv(r).setNx('k', 'v', 9)).toBe(true)
    expect(calls[0]).toEqual(['k', 'v', 'EX', 9, 'NX'])
  })
  it('toAppError keeps non-zhanghao errors as is', () => {
    const plain = new Error('boom')
    expect(toAppError(plain)).toBe(plain)
    expect((toAppError(new ZhanghaoError('VALIDATION', '昵称不合规')) as AppError).message).toBe('昵称不合规')
  })
})
