import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { AppError } from '@proxysplit/shared'
import { buildApp } from './app.js'
import { registerClientNodesRoutes } from './client-nodes-routes.js'
import { IpByteBudget } from './telemetry-budget.js'
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

/** verifyAccess 的替身：'staff' = 员工账号在 DEVICE 这台上的令牌；'customer' = 普通客户；'other-device' = 员工但令牌绑的是另一台；'good' = 后台管理员。 */
function setup(opts: { role?: string; username?: string } = {}) {
  const ingested: { accountId: string }[] = []
  const audits: unknown[][] = []
  const principals: Record<string, { userId: string; deviceId: string; role: string; staff: boolean; deviceHash: string | null }> = {
    good: { userId: 'u1', deviceId: 'd', role: opts.role ?? 'admin', staff: false, deviceHash: null },
    staff: { userId: 'staff-1', deviceId: 'd1', role: 'user', staff: true, deviceHash: DEVICE },
    customer: { userId: 'cust-1', deviceId: 'd2', role: 'user', staff: false, deviceHash: DEVICE },
    'other-device': { userId: 'staff-1', deviceId: 'd3', role: 'user', staff: true, deviceHash: 'c'.repeat(64) },
  }
  const core = {
    auth: { publicKeyPem: 'K', verifyAccess: async (t: string) => { const p = principals[t]; if (!p) throw new Error('bad'); return p } },
    store: {
      findUserById: async () => ({ id: 'u1', username: opts.username ?? 'admin', role: opts.role ?? 'admin' }),
      audit: async (...args: unknown[]) => { audits.push(args) },
    },
    telemetry: { store: { ingest: async () => ({}), purge: async () => ({}) }, query: {} },
    clientNodes: {
      store: { ingest: async (_r: unknown, ctx: { accountId: string }) => { ingested.push(ctx); return { nodes: 1, subs: 0, changes: 1, ignored: false } }, purge: async () => ({ changes: 0 }) },
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
const asStaff = { authorization: 'Bearer staff' }

// 业主定（2026-11-18）：节点清单只收公司员工账号的。原来任何人、不登录也能报，全网客户端都在报。
describe('client node upload：只收员工账号', () => {
  it('员工账号 + 令牌绑定的设备就是上报的这台：入库（gzip 照收），账号记到清单上', async () => {
    const { core, ingested } = setup()
    const app = await buildApp(config, core as never)
    const r = await post(app, gzipSync(JSON.stringify(report())), { 'content-encoding': 'gzip', ...asStaff })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ ok: true, nodes: 1 })
    expect(ingested).toEqual([{ accountId: 'staff-1' }])
    await app.close()
  })

  // 已发布的客户端（v1.12.2–v1.12.5）人人都在报，非 2xx 会一直重试：对它们必须是安静的 200。
  it('没登录 / 令牌失效 / 普通客户 / 员工但设备对不上 / 没带设备头：一律 200 {ok,nodes:0}，什么都不存', async () => {
    const { core, ingested } = setup()
    const app = await buildApp(config, core as never)
    const cases: Array<[string, Record<string, string>]> = [
      ['anonymous', {}], ['expired token', { authorization: 'Bearer expired' }], ['customer', { authorization: 'Bearer customer' }],
      ['staff on another device', { authorization: 'Bearer other-device' }], ['staff without device header', { ...asStaff, 'x-device-id': '' }],
      ['admin console token (pending device)', { authorization: 'Bearer good' }],
    ]
    for (const [name, headers] of cases) {
      const r = await post(app, report(), headers)
      expect(r.statusCode, name).toBe(200)
      expect(r.json(), name).toEqual({ ok: true, nodes: 0 })
    }
    expect(ingested).toHaveLength(0)
    await app.close()
  })

  it('不是员工的请求连请求体都不读：坏的 gzip、不合合同的 JSON、超过 2 MB 的体都是同一个 200（不会变成 4xx 让客户端重试）', async () => {
    const { core, ingested } = setup()
    const app = await buildApp(config, core as never)
    expect((await post(app, Buffer.from('not gzip at all'), { 'content-encoding': 'gzip' })).statusCode).toBe(200)
    expect((await post(app, { nonsense: true })).statusCode).toBe(200)
    expect((await post(app, JSON.stringify({ pad: 'x'.repeat(3 * 1024 * 1024) }))).statusCode).toBe(200)
    // 同样的坏请求换成员工：照常按合同校验
    expect((await post(app, { nonsense: true }, asStaff)).statusCode).toBe(400)
    expect(ingested).toHaveLength(0)
    await app.close()
  })

  it('员工：请求体里的设备号必须和头一致（400）；每台设备每分钟 6 次', async () => {
    const { core, ingested } = setup()
    const app = await buildApp(config, core as never)
    const bad = await post(app, report({ deviceId: 'b'.repeat(64) }), asStaff)
    expect(bad.statusCode).toBe(400)
    expect(bad.json()).toMatchObject({ error: { code: 'DEVICE_MISMATCH' } })
    expect(ingested).toHaveLength(0)
    const codes: number[] = []
    for (let i = 0; i < 7; i++) codes.push((await post(app, report(), asStaff)).statusCode)
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

// 每 IP 字节预算（只对真正入库的员工上报计）：直接挂路由，预算调小好测。
describe('client node upload budgets', () => {
  it('每 IP 字节预算：用完后 429，不再入库', async () => {
    const ingested: string[] = []
    const app = Fastify()
    app.setErrorHandler((error, _req, reply) => reply.code(error instanceof AppError ? error.status : 500).send({ error: { code: error instanceof AppError ? error.code : 'E' } }))
    const one = Buffer.byteLength(JSON.stringify(report()))
    registerClientNodesRoutes(app, {
      store: {
        ingest: async r => { ingested.push(r.deviceId); return { nodes: r.nodes.length, subs: 0, changes: 0, ignored: false } },
        purge: async () => ({ changes: 0, clearedLinks: 0, staleRows: 0 }),
      },
      query: {} as never, admin: async () => { throw new Error('unused') }, isSuperAdmin: async () => false, audit: async () => {},
      staffReporter: async () => 'staff-1',
      perDevicePerMinute: 1000, runRetention: false, log: { warn() {}, info() {} },
      ipBudget: new IpByteBudget(one * 2, 600_000, undefined, 100, () => 0, 'nodes'),
    })
    const send = () => app.inject({ method: 'POST', url: '/v1/client/nodes', headers: { 'x-device-id': DEVICE }, payload: report() })
    expect((await send()).statusCode).toBe(200)
    expect((await send()).statusCode).toBe(200)
    expect((await send()).statusCode).toBe(429)
    expect(ingested).toHaveLength(2)
    await app.close()
  })
})
