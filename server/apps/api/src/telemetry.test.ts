import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import type { ApiConfig } from './config.js'
import { DeviceLimiter } from './telemetry-routes.js'
import { IpByteBudget } from './telemetry-budget.js'

const config: ApiConfig = {
  NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 18780, PUBLIC_BASE_URL: 'http://127.0.0.1:18780',
  DATABASE_URL: 'postgres://unused', ACCESS_TOKEN_SECRET: 'test-secret-must-be-at-least-32-bytes-long',
  REFRESH_TOKEN_TTL_DAYS: 30, ADMIN_ORIGIN: 'http://127.0.0.1:18781', TELEMETRY_PER_DEVICE_PER_MINUTE: 3, TELEMETRY_MAX_GZIP_BYTES: 4096,
}
const DEVICE = 'a'.repeat(64)
const batch = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1, deviceId: DEVICE, appVersion: '1.9.96', os: 'Windows 11', arch: 'amd64',
  events: [{ eventId: '11111111-2222-4333-8444-555555555555', sessionId: 's1', seq: 1, ts: '2026-10-27T10:00:00Z', type: 'proxy.start', status: 'fail', durationMs: 120, errorCode: 'TUN_CREATE_FAIL', errorText: 'wintun failed', payload: { capture: 'tun' } }],
  logs: [{ chunkId: '21111111-2222-4333-8444-555555555555', sessionId: 's1', startedAt: '2026-10-27T10:00:00Z', endedAt: '2026-10-27T10:00:05Z', lineCount: 1, text: '10:00:00.000 [core] boom\n' }],
  ...over,
})

function setup(role = 'admin') {
  const ingested: { batch: unknown; ctx: { accountId: string | null } }[] = []
  const core = {
    auth: { publicKeyPem: 'K', verifyAccess: async (t: string) => { if (t !== 'good') throw new Error('bad'); return { userId: 'u1', deviceId: 'd', role } } },
    store: {},
    telemetry: {
      store: { ingest: async (b: unknown, ctx: { accountId: string | null }) => { ingested.push({ batch: b, ctx }); return { events: 1, logs: 1 } }, purge: async () => ({ events: 0, logs: 0, devices: 0 }) },
      query: {
        listDevices: async (q: unknown) => ({ items: [], total: 0, q }), getDevice: async () => null,
        listEvents: async () => ({ items: [] }), searchLogs: async (_id: string, q: unknown) => ({ items: [], q }), failures: async () => ({ items: [] }), analytics: async () => ({ days: 7 }),
      },
    },
    close: async () => {},
  }
  return { core, ingested }
}

describe('client telemetry upload', () => {
  it('accepts a gzip batch without a token and binds the account when the token is valid', async () => {
    const { core, ingested } = setup()
    const app = await buildApp(config, core as never)
    const anon = await app.inject({ method: 'POST', url: '/v1/client/telemetry', headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'x-device-id': DEVICE }, payload: gzipSync(JSON.stringify(batch())) })
    expect(anon.statusCode).toBe(200)
    expect(anon.json()).toMatchObject({ ok: true, events: 1 })
    const authed = await app.inject({ method: 'POST', url: '/v1/client/telemetry', headers: { 'content-type': 'application/json', authorization: 'Bearer good' }, payload: batch() })
    expect(authed.statusCode).toBe(200)
    const expired = await app.inject({ method: 'POST', url: '/v1/client/telemetry', headers: { 'content-type': 'application/json', authorization: 'Bearer expired' }, payload: batch() })
    expect(expired.statusCode).toBe(200)
    expect(ingested.map(i => i.ctx.accountId)).toEqual([null, 'u1', null])
    await app.close()
  })

  it('rejects malformed batches, device id mismatch and oversized bodies', async () => {
    const { core, ingested } = setup()
    const app = await buildApp(config, core as never)
    const post = (payload: unknown, headers: Record<string, string> = {}) => app.inject({ method: 'POST', url: '/v1/client/telemetry', headers: { 'content-type': 'application/json', ...headers }, payload: payload as string })
    expect((await post(batch({ deviceId: 'not-hex' }))).statusCode).toBe(400)
    expect((await post(batch({ events: [{ eventId: 'x', type: 'BAD TYPE' }] }))).statusCode).toBe(400)
    expect((await post(batch(), { 'x-device-id': 'b'.repeat(64) })).json()).toMatchObject({ error: { code: 'DEVICE_MISMATCH' } })
    const huge = await post(JSON.stringify(batch({ logs: [] })) + ' '.repeat(5000))
    expect(huge.statusCode).toBe(413)
    expect(ingested).toHaveLength(0)
    await app.close()
  })

  it('caps bytes per IP per window (in memory without Redis, Redis when given)', async () => {
    let t = 0
    const mem = new IpByteBudget(100, 600_000, undefined, 10, () => t)
    expect(await mem.charge('1.1.1.1', 60)).toBe(true)
    expect(await mem.charge('1.1.1.1', 60)).toBe(false)
    expect(await mem.charge('2.2.2.2', 60)).toBe(true)
    t = 600_000
    expect(await mem.charge('1.1.1.1', 60)).toBe(true)
    const store = new Map<string, number>()
    const redis = { incrby: async (k: string, n: number) => { store.set(k, (store.get(k) ?? 0) + n); return store.get(k)! }, pexpire: async () => 1 }
    const viaRedis = new IpByteBudget(100, 600_000, redis, 10, () => 0)
    expect(await viaRedis.charge('1.1.1.1', 80)).toBe(true)
    expect(await viaRedis.charge('1.1.1.1', 80)).toBe(false)
    const broken = new IpByteBudget(100, 600_000, { incrby: async () => { throw new Error('down') }, pexpire: async () => 1 }, 10, () => 0)
    expect(await broken.charge('1.1.1.1', 80)).toBe(true)
  })

  it('rate-limits each device', async () => {
    const { core } = setup()
    const app = await buildApp(config, core as never)
    const codes: number[] = []
    for (let i = 0; i < 4; i++) codes.push((await app.inject({ method: 'POST', url: '/v1/client/telemetry', headers: { 'content-type': 'application/json' }, payload: batch() })).statusCode)
    expect(codes).toEqual([200, 200, 200, 429])
    const other = await app.inject({ method: 'POST', url: '/v1/client/telemetry', headers: { 'content-type': 'application/json' }, payload: batch({ deviceId: 'c'.repeat(64) }) })
    expect(other.statusCode).toBe(200)
    await app.close()
  })

  it('limiter resets every minute and bounds its memory', () => {
    let now = 0
    const l = new DeviceLimiter(1, 2, () => now)
    expect([l.allow('a'), l.allow('a')]).toEqual([true, false])
    now = 60_000
    expect(l.allow('a')).toBe(true)
    l.allow('b'); l.allow('c'); l.allow('d')
    expect(l.allow('a')).toBe(true) // table cleared after exceeding the cap
  })
})

describe('admin telemetry endpoints', () => {
  it('require an administrator and validate queries', async () => {
    const { core } = setup('user')
    const app = await buildApp(config, core as never)
    const denied = await app.inject({ method: 'GET', url: '/v1/admin/telemetry/devices', headers: { authorization: 'Bearer good' } })
    expect(denied.statusCode).toBe(403)
    await app.close()
    const admin = await buildApp(config, setup('admin').core as never)
    const ok = await admin.inject({ method: 'GET', url: '/v1/admin/telemetry/devices?lastStatus=fail&limit=5', headers: { authorization: 'Bearer good' } })
    expect(ok.json()).toMatchObject({ q: { lastStatus: 'fail', limit: 5, offset: 0 } })
    const bad = await admin.inject({ method: 'GET', url: '/v1/admin/telemetry/devices?limit=500', headers: { authorization: 'Bearer good' } })
    expect(bad.statusCode).toBe(400)
    const missing = await admin.inject({ method: 'GET', url: `/v1/admin/telemetry/devices/${DEVICE}`, headers: { authorization: 'Bearer good' } })
    expect(missing.statusCode).toBe(404)
    const badId = await admin.inject({ method: 'GET', url: '/v1/admin/telemetry/devices/xyz/logs', headers: { authorization: 'Bearer good' } })
    expect(badId.statusCode).toBe(404)
    const analytics = await admin.inject({ method: 'GET', url: '/v1/admin/telemetry/analytics?days=7', headers: { authorization: 'Bearer good' } })
    expect(analytics.json()).toEqual({ days: 7 })
    await admin.close()
  })
})
