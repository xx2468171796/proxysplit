// store 侧的登录锁定落库：行锁里读 → nextLoginFailure → 写；成功登录把级别一起清零。
import { describe, expect, it } from 'vitest'
import { PgStore } from './store.js'

type Call = { sql: string; params: unknown[] }
function storeWith(row: Record<string, unknown> | undefined) {
  const calls: Call[] = []
  const query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params })
    return { rows: sql.includes('FOR UPDATE') && row ? [row] : [], rowCount: 1 }
  }
  const store = Object.create(PgStore.prototype) as PgStore
  Object.assign(store, { pool: { query, connect: async () => ({ query, release() {} }) } })
  return { store, calls }
}

describe('登录锁定落库', () => {
  it('第 5 次输错：同一事务里锁住该用户行，写入锁定到期时间与级别', async () => {
    const { store, calls } = storeWith({ failedLoginCount: 4, lockoutLevel: 0, lockedUntil: null })
    const next = await store.recordLoginFailure('u1')
    expect(next).toMatchObject({ failedLoginCount: 0, lockoutLevel: 1 })
    expect(calls.map(c => c.sql.split(' ')[0])).toEqual(['BEGIN', 'SELECT', 'UPDATE', 'COMMIT'])
    expect(calls[1]?.sql).toContain('FOR UPDATE')
    expect(calls[2]?.params).toEqual(['u1', 0, 1, next?.lockedUntil])
  })

  it('用户不存在：回滚，返回 null', async () => {
    const { store, calls } = storeWith(undefined)
    expect(await store.recordLoginFailure('nobody')).toBeNull()
    expect(calls.at(-1)?.sql).toBe('ROLLBACK')
  })

  it('改密码：吊销该账号的会话，但留下指定设备（本人正在用的那台）的', async () => {
    const { store, calls } = storeWith(undefined)
    await store.setUserPassword('u1', 'hash', 'device-1')
    const revoke = calls.find(c => c.sql.startsWith('UPDATE sessions'))
    expect(revoke?.sql).toContain('device_id IS DISTINCT FROM $2::uuid')
    expect(revoke?.params).toEqual(['u1', 'device-1'])
    const all = storeWith(undefined)
    await all.store.setUserPassword('u1', 'hash', null)
    expect(all.calls.find(c => c.sql.startsWith('UPDATE sessions'))?.params).toEqual(['u1', null])
  })

  it('成功登录：失败次数、锁定时间、锁定级别一起清零（原来级别只增不减）', async () => {
    const { store, calls } = storeWith(undefined)
    await store.recordLoginSuccess('u1')
    expect(calls[0]?.sql).toContain('lockout_level=0')
    expect(calls[0]?.sql).toContain('failed_login_count=0')
    expect(calls[0]?.sql).toContain('locked_until=NULL')
  })
})
