import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import type { ApiConfig } from './config.js'

const config: ApiConfig = {
  NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 18780, PUBLIC_BASE_URL: 'http://127.0.0.1:18780',
  DATABASE_URL: 'postgres://unused', ACCESS_TOKEN_SECRET: 'test-secret-must-be-at-least-32-bytes-long',
  REFRESH_TOKEN_TTL_DAYS: 30, ADMIN_ORIGIN: 'http://127.0.0.1:18781',
}
const DEVICE = 'a'.repeat(64)
const report = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1, deviceId: DEVICE, appVersion: '1.10.7', reason: 'start', selectedId: 'n1',
  nodes: [{ id: 'n1', name: '台湾1', type: 'vless', server: 'a.example', port: 443, link: 'vless://x' }],
  subs: [], ...over,
})

function setup(opts: { role?: string; username?: string } = {}) {
  const ingested: { accountId: string | null }[] = []
  const audits: unknown[][] = []
  const core = {
    auth: { publicKeyPem: 'K', verifyAccess: async (t: string) => { if (t !== 'good') throw new Error('bad'); return { userId: 'u1', deviceId: 'd', role: opts.role ?? 'admin' } } },
    store: {
      findUserById: async () => ({ id: 'u1', username: opts.username ?? 'admin' }),
      audit: async (...args: unknown[]) => { audits.push(args) },
    },
    telemetry: { store: { ingest: async () => ({}), purge: async () => ({}) }, query: {} },
    clientNodes: {
      store: { ingest: async (_r: unknown, ctx: { accountId: string | null }) => { ingested.push(ctx); return { nodes: 1, subs: 0, changes: 1, ignored: false } }, purge: async () => ({ changes: 0 }) },
      query: {
        listNodes: async (q: unknown) => ({ items: [], total: 0, q }), listSubs: async (q: unknown) => ({ items: [], q }), changes: async () => ({ items: [] }),
        stats: async () => ({ devices: 1 }),
        revealNode: async (_d: string, id: string) => (id === 'n1' ? { found: true, link: 'vless://x' } : { found: false, link: null }),
        revealSub: async () => ({ found: true, link: 'https://sub' }),
      },
    },
    close: async () => {},
  }
  return { core, ingested, audits }
}

const post = (app: Awaited<ReturnType<typeof buildApp>>, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/v1/client/nodes', headers: { 'content-type': 'application/json', 'x-device-id': DEVICE, ...headers }, payload: payload as string })

describe('client node upload', () => {
  it('accepts gzip, binds the account only for a valid token', async () => {
    const { core, ingested } = setup()
    const app = await buildApp(config, core as never)
    const anon = await post(app, gzipSync(JSON.stringify(report())), { 'content-encoding': 'gzip' })
    expect(anon.statusCode).toBe(200)
    expect(anon.json()).toEqual({ ok: true, nodes: 1 })
    await post(app, report(), { authorization: 'Bearer good' })
    await post(app, report(), { authorization: 'Bearer expired' })
    expect(ingested.map(i => i.accountId)).toEqual([null, 'u1', null])
    await app.close()
  })

  it('rejects device id mismatch / missing header with 400', async () => {
    const { core, ingested } = setup()
    const app = await buildApp(config, core as never)
    const bad = await post(app, report(), { 'x-device-id': 'b'.repeat(64) })
    expect(bad.statusCode).toBe(400)
    expect(bad.json()).toMatchObject({ error: { code: 'DEVICE_MISMATCH' } })
    expect((await post(app, report(), { 'x-device-id': '' })).statusCode).toBe(400)
    expect((await post(app, report({ deviceId: 'xyz' }))).statusCode).toBe(400)
    expect(ingested).toHaveLength(0)
    await app.close()
  })

  it('rate-limits each device to 6 per minute', async () => {
    const { core } = setup()
    const app = await buildApp(config, core as never)
    const codes: number[] = []
    for (let i = 0; i < 7; i++) codes.push((await post(app, report())).statusCode)
    expect(codes).toEqual([200, 200, 200, 200, 200, 200, 429])
    await app.close()
  })
})

describe('admin client node endpoints', () => {
  it('require an administrator; list / stats work for normal admins', async () => {
    const user = await buildApp(config, setup({ role: 'user' }).core as never)
    expect((await user.inject({ method: 'GET', url: '/v1/admin/client-nodes', headers: { authorization: 'Bearer good' } })).statusCode).toBe(403)
    await user.close()
    const app = await buildApp(config, setup({ username: 'ops' }).core as never)
    const list = await app.inject({ method: 'GET', url: '/v1/admin/client-nodes?status=all&dead=1&page=2&pageSize=10', headers: { authorization: 'Bearer good' } })
    expect(list.json()).toMatchObject({ q: { status: 'all', dead: true, page: 2, pageSize: 10 } })
    const stats = await app.inject({ method: 'GET', url: '/v1/admin/client-nodes/stats', headers: { authorization: 'Bearer good' } })
    expect(stats.json()).toEqual({ devices: 1, canReveal: false })
    await app.close()
  })

  it('reveal requires a super admin and writes an audit row', async () => {
    const plain = setup({ username: 'ops' })
    const app1 = await buildApp(config, plain.core as never)
    const denied = await app1.inject({ method: 'POST', url: '/v1/admin/client-nodes/reveal', headers: { authorization: 'Bearer good' }, payload: { deviceId: DEVICE, nodeId: 'n1' } })
    expect(denied.statusCode).toBe(403)
    expect(plain.audits).toHaveLength(0)
    await app1.close()

    const sup = setup({ username: 'admin' })
    const app = await buildApp(config, sup.core as never)
    const ok = await app.inject({ method: 'POST', url: '/v1/admin/client-nodes/reveal', headers: { authorization: 'Bearer good' }, payload: { deviceId: DEVICE, nodeId: 'n1' } })
    expect(ok.json()).toEqual({ link: 'vless://x' })
    expect(sup.audits[0]).toEqual(['u1', 'admin.client_node.reveal', 'client-node', `${DEVICE}:n1`, expect.any(String), 'success', { deviceId: DEVICE, nodeId: 'n1' }])
    const missing = await app.inject({ method: 'POST', url: '/v1/admin/client-nodes/reveal', headers: { authorization: 'Bearer good' }, payload: { deviceId: DEVICE, nodeId: 'zz' } })
    expect(missing.statusCode).toBe(404)
    expect(sup.audits[1]![5]).toBe('not_found')
    const sub = await app.inject({ method: 'POST', url: '/v1/admin/client-subs/reveal', headers: { authorization: 'Bearer good' }, payload: { deviceId: DEVICE, subId: 's1' } })
    expect(sub.json()).toEqual({ url: 'https://sub' })
    expect(sup.audits[2]![1]).toBe('admin.client_sub.reveal')
    await app.close()
  })
})
