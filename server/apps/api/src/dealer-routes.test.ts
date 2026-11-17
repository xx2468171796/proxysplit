// 代理商分成后台接口：待复核的复核 / 作废、设本人账号——都要管理员，入参过 Zod。
import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import type { ApiConfig } from './config.js'

const config: ApiConfig = {
  NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 18780, PUBLIC_BASE_URL: 'http://127.0.0.1:18780',
  DATABASE_URL: 'postgres://unused', ACCESS_TOKEN_SECRET: 'test-secret-must-be-at-least-32-bytes-long',
  REFRESH_TOKEN_TTL_DAYS: 30, ADMIN_ORIGIN: 'http://127.0.0.1:18781',
}
const ADMIN = '11111111-1111-4111-8111-111111111111'

async function appAs(role: 'admin' | 'user') {
  const calls: Array<{ text: string; params: unknown[] }> = []
  const query = async (text: string, params: unknown[] = []) => {
    calls.push({ text, params })
    if (text.startsWith('UPDATE dealer_commissions')) return { rows: [{ id: 7, commissionCents: 2970, dealerSlug: 'wen' }], rowCount: 1 }
    if (text.startsWith('SELECT id,username')) return { rows: [{ id: ADMIN, username: 'wen_boss' }], rowCount: 1 }
    if (text.startsWith('UPDATE dealers')) return { rows: [{ slug: 'wen' }], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  }
  const store = { pool: { query, connect: async () => ({ query, release: () => {} }) }, findUserById: async () => ({ id: ADMIN, username: 'admin', role, status: 'active' }), audit: async () => undefined }
  const core = { auth: { verifyAccess: async () => ({ userId: ADMIN, deviceId: 'd', role }) }, store, close: async () => {} }
  const app = await buildApp(config, core as never)
  const call = (method: 'POST' | 'PUT', url: string, payload: object) => app.inject({ method, url, headers: { authorization: 'Bearer t' }, payload })
  return { app, calls, call }
}

describe('代理商分成：复核与本人账号', () => {
  it('管理员复核通过 / 作废待复核的分成；坏入参 400', async () => {
    const t = await appAs('admin')
    const ok = await t.call('POST', '/v1/admin/dealers/commissions/review', { ids: [7], action: 'approve', note: '核实过' })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toMatchObject({ action: 'approve', changed: 1, ids: [7], commissionCents: 2970 })
    expect(t.calls.find(c => c.text.startsWith('UPDATE dealer_commissions'))?.params).toEqual([[7], 'pending', '核实过'])
    expect(t.calls.find(c => c.text.startsWith('INSERT INTO audit_logs'))?.params.slice(0, 2)).toEqual([ADMIN, 'admin.dealer.review'])
    expect((await t.call('POST', '/v1/admin/dealers/commissions/review', { ids: [7], action: 'pay' })).statusCode).toBe(400)
    expect((await t.call('POST', '/v1/admin/dealers/commissions/review', { ids: [], action: 'void' })).statusCode).toBe(400)
    const owners = await t.call('PUT', '/v1/admin/dealers/wen/owners', { usernames: ['wen_boss'] })
    expect(owners.json()).toEqual({ slug: 'wen', ownerUsernames: ['wen_boss'] })
    expect((await t.call('PUT', '/v1/admin/dealers/wen/owners', { usernames: 'wen_boss' })).statusCode).toBe(400)
    await t.app.close()
  })
  it('不是管理员：403，什么都没改', async () => {
    const t = await appAs('user')
    expect((await t.call('POST', '/v1/admin/dealers/commissions/review', { ids: [7], action: 'approve' })).statusCode).toBe(403)
    expect((await t.call('PUT', '/v1/admin/dealers/wen/owners', { usernames: [] })).statusCode).toBe(403)
    expect(t.calls.some(c => c.text.startsWith('UPDATE'))).toBe(false)
    await t.app.close()
  })
})
