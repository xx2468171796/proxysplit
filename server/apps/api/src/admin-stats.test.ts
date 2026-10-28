import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import type { ApiConfig } from './config.js'
import { AdminStatsQuery, centsString, fillDays, shanghaiDate, statsOverviewQuery, statsWindows } from './admin-stats.js'

describe('admin stats helpers', () => {
  it('splits the current and previous windows with equal length', () => {
    const now = new Date('2026-10-29T04:00:00Z')
    const w = statsWindows(now, 7)
    expect(w.cur.to.getTime() - w.cur.from.getTime()).toBe(7 * 86_400_000)
    expect(w.prev.to).toEqual(w.cur.from)
    expect(w.prev.to.getTime() - w.prev.from.getTime()).toBe(7 * 86_400_000)
  })

  it('keeps money exact as decimal strings', () => {
    expect(centsString('9007199254740993')).toBe('9007199254740993')
    expect(centsString(12345n)).toBe('12345')
    expect(centsString(99.9)).toBe('99')
    expect(centsString(null)).toBe('0')
    expect(centsString('abc')).toBe('0')
  })

  it('uses Beijing calendar days and fills missing days', () => {
    expect(shanghaiDate(new Date('2026-10-28T16:30:00Z'))).toBe('2026-10-29')
    const from = new Date('2026-10-26T04:00:00Z')
    const rows = fillDays([{ date: '2026-10-28', value: 5 }], from, 3, 0)
    expect(rows).toEqual([{ date: '2026-10-27', value: 0 }, { date: '2026-10-28', value: 5 }, { date: '2026-10-29', value: 0 }])
  })

  it('only accepts 7 / 30 / 90 days', () => {
    expect(statsOverviewQuery.parse({}).days).toBe(30)
    expect(statsOverviewQuery.parse({ days: '7' }).days).toBe(7)
    expect(() => statsOverviewQuery.parse({ days: '8' })).toThrow()
  })

  it('maps aggregate rows and never leaks share codes', async () => {
    const seen: string[] = []
    const db = { query: async (sql: string) => {
      seen.push(sql)
      if (sql.includes('"phoneBound"')) return { rows: [{ users: 10, paid: 3, phoneBound: 4, profiles: 2, shared: 1, locked: 0, profileUsers: 2, syncUsers: 1, online: 5 }] }
      if (sql.includes('"signupsCur"')) return { rows: [{ signupsCur: 6, signupsPrev: 4, revCur: '1999', revPrev: '0', paidOrdersCur: 2, paidOrdersPrev: 0, convCur: 1, convPrev: 0, newPaidCur: 1, newPaidPrev: 0 }] }
      if (sql.includes('"verified"')) return { rows: [{ sent: 3, prev: 1, verified: 2 }] }
      return { rows: [] }
    } }
    const o = await new AdminStatsQuery(db).overview(7, new Date('2026-10-29T04:00:00Z'))
    expect(o.members).toEqual({ users: 10, paid: 3, free: 7, newPaid: { cur: 1, prev: 0 } })
    expect(o.revenue.curCents).toBe('1999')
    expect(o.signups.daily).toHaveLength(7)
    expect(o.sms).toMatchObject({ sent24h: 3, prev24h: 1, verified24h: 2 })
    await new AdminStatsQuery(db).userCloud('u')
    expect(seen.at(-1)).not.toMatch(/share_code AS|share_password_hash,|restore_password_hash,/)
  })
})

describe('admin stats routes', () => {
  const config: ApiConfig = {
    NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 18780, PUBLIC_BASE_URL: 'http://127.0.0.1:18780',
    DATABASE_URL: 'postgres://unused', ACCESS_TOKEN_SECRET: 'test-secret-must-be-at-least-32-bytes-long',
    REFRESH_TOKEN_TTL_DAYS: 30, ADMIN_ORIGIN: 'http://127.0.0.1:18781',
  }
  const stats = { overview: async (days: number) => ({ days }), userCloud: async (id: string) => ({ id }) }

  it('requires an admin and validates input', async () => {
    const asUser = { auth: { publicKeyPem: 'K', verifyAccess: async () => ({ userId: 'u', deviceId: 'd', role: 'user' }) }, store: {}, adminStats: stats, close: async () => {} }
    const app = await buildApp(config, asUser as never)
    const denied = await app.inject({ method: 'GET', url: '/v1/admin/stats/overview', headers: { authorization: 'Bearer t' } })
    expect(denied.statusCode).toBe(403)
    await app.close()

    const asAdmin = { ...asUser, auth: { publicKeyPem: 'K', verifyAccess: async () => ({ userId: 'a', deviceId: 'd', role: 'admin' }) } }
    const app2 = await buildApp(config, asAdmin as never)
    const ok = await app2.inject({ method: 'GET', url: '/v1/admin/stats/overview?days=90', headers: { authorization: 'Bearer t' } })
    expect(ok.json()).toEqual({ days: 90 })
    const bad = await app2.inject({ method: 'GET', url: '/v1/admin/users/not-a-uuid/cloud', headers: { authorization: 'Bearer t' } })
    expect(bad.statusCode).toBe(404)
    await app2.close()
  })
})
