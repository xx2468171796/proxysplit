// 路径里的 id 不是 uuid：统一 404，不碰数据库（原来多数接口把它原样塞进 SQL → 22P02 → 500）。
import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import type { ApiConfig } from './config.js'

const config: ApiConfig = {
  NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 18780, PUBLIC_BASE_URL: 'http://127.0.0.1:18780',
  DATABASE_URL: 'postgres://unused', ACCESS_TOKEN_SECRET: 'test-secret-must-be-at-least-32-bytes-long',
  REFRESH_TOKEN_TTL_DAYS: 30, ADMIN_ORIGIN: 'http://127.0.0.1:18781', CONFIG_SYNC_KEY: Buffer.alloc(32, 7).toString('base64'),
}
const ADMIN = '11111111-1111-4111-8111-111111111111'
const GOOD = '22222222-2222-4222-8222-222222222222'

/** 任何数据库访问都抛「uuid 语法错误」—— 和真库收到坏 id 时一样。 */
async function app() {
  const touched: string[] = []
  const pgError = (name: string) => async () => { touched.push(name); throw Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' }) }
  const store = new Proxy({ pool: { query: pgError('pool.query'), connect: pgError('pool.connect') } } as Record<string, unknown>, {
    get: (target, prop: string) => {
      if (prop in target) return target[prop]
      if (prop === 'findUserById') return async (id: string) => (id === ADMIN ? { id, username: 'admin', role: 'admin', status: 'active' } : null)
      if (prop === 'fx' || prop === 'notifySink' || prop === 'then') return undefined
      return pgError(prop)
    },
  })
  const core = { auth: { verifyAccess: async () => ({ userId: ADMIN, deviceId: 'd', role: 'admin' }), effectiveFor: async () => ({ ent: { tier: 'premium' } }) }, store, close: async () => {} }
  return { app: await buildApp(config, core as never), touched }
}

const BAD = 'not-a-uuid'
const routes: Array<['GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', string, object?]> = [
  ['DELETE', `/v1/me/devices/${BAD}`],
  ['GET', `/v1/admin/users/${BAD}`],
  ['PATCH', `/v1/admin/users/${BAD}/status`, { status: 'active' }],
  ['PATCH', `/v1/admin/users/${BAD}/password`, { password: 'a-long-enough-password' }],
  ['POST', `/v1/admin/users/${BAD}/extend`, { days: 30 }],
  ['POST', `/v1/admin/users/${BAD}/grant`, { planId: GOOD, durationDays: 30 }],
  ['DELETE', `/v1/admin/users/${BAD}`],
  ['POST', `/v1/admin/users/${BAD}/ban`, { days: 1, reason: 'r' }],
  ['POST', `/v1/admin/users/${BAD}/unban`, { reason: 'r' }],
  ['POST', `/v1/admin/users/${BAD}/nickname`, { nickname: 'n' }],
  ['POST', `/v1/admin/users/${BAD}/revoke-sessions`, { reason: 'r' }],
  ['GET', `/v1/admin/users/${BAD}/actions`],
  ['GET', `/v1/admin/users/${BAD}/cloud`],
  ['DELETE', `/v1/admin/devices/${BAD}`],
  ['PATCH', `/v1/admin/plans/${BAD}`, {}],
  ['DELETE', `/v1/admin/plans/${BAD}`],
  ['POST', `/v1/admin/redeem-codes/${BAD}/status`, { status: 'disabled' }],
  ['DELETE', `/v1/admin/redeem-codes/${BAD}`],
  ['DELETE', `/v1/admin/releases/${BAD}`],
  ['PATCH', `/v1/admin/fenxiao/members/${BAD}`, {}],
]

describe('路径参数 id', () => {
  it('不是 uuid 的 id：每个 :id 接口都回 404，数据库一次都没碰', async () => {
    const t = await app()
    for (const [method, url, payload] of routes) {
      const r = await t.app.inject({ method, url, headers: { authorization: 'Bearer t' }, ...(payload ? { payload } : {}) })
      expect(r.statusCode, `${method} ${url}`).toBe(404)
      expect(r.json(), url).toMatchObject({ error: { code: 'NOT_FOUND' } })
    }
    expect(t.touched).toEqual([])
    await t.app.close()
  })

  it('兑换码改状态的请求体要过 schema：乱写的 status 回 400（原来除了 disabled 一律当成 active）', async () => {
    const t = await app()
    const r = await t.app.inject({ method: 'POST', url: `/v1/admin/redeem-codes/${GOOD}/status`, headers: { authorization: 'Bearer t' }, payload: { status: 'whatever' } })
    expect(r.statusCode).toBe(400)
    expect(t.touched).toEqual([])
    const none = await t.app.inject({ method: 'POST', url: `/v1/admin/redeem-codes/${GOOD}/status`, headers: { authorization: 'Bearer t' }, payload: {} })
    expect(none.statusCode).toBe(400)
    await t.app.close()
  })
})
