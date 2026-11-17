// 限流口径：正在运行的客户端定时调用的接口不能被「同一出口 IP 的多台机器」打满。
import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import type { ApiConfig } from './config.js'
import { CALLBACK_LIMIT, DEFAULT_LIMIT, FLEET_LIMIT, redisLimitStore, refreshFamilyKey } from './rate-limits.js'

const config: ApiConfig = {
  NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 18780, PUBLIC_BASE_URL: 'http://127.0.0.1:18780',
  DATABASE_URL: 'postgres://unused', ACCESS_TOKEN_SECRET: 'test-secret-must-be-at-least-32-bytes-long',
  REFRESH_TOKEN_TTL_DAYS: 30, ADMIN_ORIGIN: 'http://127.0.0.1:18781',
}
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
/** 形状正确的刷新令牌（签名随便写：core.auth.rotate 在这里是替身）。 */
const refreshToken = (fam: string) => `${b64({ alg: 'HS256' })}.${b64({ typ: 'refresh', fam, jti: 'j', sub: 'u', did: 'd' })}.signature-not-checked-here`
const fingerprint = 'f'.repeat(32)

async function app() {
  let rotations = 0
  const core = {
    auth: { publicKeyPem: 'K', rotate: async () => { rotations++; return { accessToken: 'a', refreshToken: 'r', expiresIn: 900 } } },
    store: {}, close: async () => {},
  }
  return { app: await buildApp(config, core as never), rotations: () => rotations }
}

describe('客户端定时接口的限流口径', () => {
  it('同一出口 IP 后的 40 台客户端各刷新一次：全部放行（原来每 IP 每分钟 10 次，第 11 台起 429）', async () => {
    const t = await app()
    const codes: number[] = []
    for (let i = 0; i < 40; i++) {
      const r = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', remoteAddress: '203.0.113.9', payload: { refreshToken: refreshToken(`family-${i}`), deviceFingerprint: fingerprint } })
      codes.push(r.statusCode)
    }
    expect(codes.every(c => c === 200)).toBe(true)
    expect(t.rotations()).toBe(40)
    expect(FLEET_LIMIT.max).toBeGreaterThanOrEqual(600)
    await t.app.close()
  })

  it('同一条会话（令牌 family）一分钟内刷新超过 30 次才限流，其它会话不受影响', async () => {
    const t = await app()
    const hit = (fam: string) => t.app.inject({ method: 'POST', url: '/v1/auth/refresh', remoteAddress: '203.0.113.10', payload: { refreshToken: refreshToken(fam), deviceFingerprint: fingerprint } })
    for (let i = 0; i < 30; i++) expect((await hit('same-family')).statusCode).toBe(200)
    const over = await hit('same-family')
    expect(over.statusCode).toBe(429)
    expect(over.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } })
    expect((await hit('another-family')).statusCode).toBe(200)
    await t.app.close()
  })

  it('refreshFamilyKey：取令牌里的 family；不是 JWT 形状 = null（交给验签去拒）', () => {
    expect(refreshFamilyKey(refreshToken('abc'))).toBe('abc')
    expect(refreshFamilyKey('garbage')).toBeNull()
    expect(refreshFamilyKey(`${b64({})}.${b64({ fam: 7 })}.x`)).toBeNull()
  })
})

describe('限流存储挂了（Redis 不可用）时的方向', () => {
  // 127.0.0.1:1 没人监听：ioredis 连不上，enableOfflineQueue=false → 每条命令立刻报错（和生产 Redis 宕机同一条路）。
  const down: ApiConfig = { ...config, REDIS_URL: 'redis://127.0.0.1:1' }
  const build = async () => {
    const calls = { rotate: 0, sms: 0, register: 0 }
    const core = {
      auth: {
        publicKeyPem: 'K', smsMode: 'local',
        rotate: async () => { calls.rotate++; return { ok: true } },
        sendSmsCode: async () => { calls.sms++; return { ok: true } },
        register: async () => { calls.register++; return { ok: true } },
        registerWeb: async () => { calls.register++; return { ok: true } },
      },
      store: {}, close: async () => {},
    }
    return { app: await buildApp(down, core as never), calls }
  }

  it('普通接口放行（fail open）：刷新令牌照常 200，而不是 500', async () => {
    const t = await build()
    const r = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: refreshToken('fam-down'), deviceFingerprint: fingerprint } })
    expect(r.statusCode).toBe(200)
    expect(t.calls.rotate).toBe(1)
    await t.app.close()
  })

  it('发短信 / 注册不放行（fail closed）：回 503 RATE_LIMIT_UNAVAILABLE，业务代码没被调用', async () => {
    const t = await build()
    for (const url of ['/v1/auth/sms/send', '/v1/auth/register', '/v1/auth/register/web']) {
      const r = await t.app.inject({ method: 'POST', url, payload: {} })
      expect(r.statusCode, url).toBe(503)
      expect(r.json(), url).toMatchObject({ error: { code: 'RATE_LIMIT_UNAVAILABLE' } })
    }
    expect(t.calls).toMatchObject({ sms: 0, register: 0 })
    await t.app.close()
  })

  it('redisLimitStore：按「前缀 + 路由 + 键」计数，Redis 报错统一成 503 的 AppError', async () => {
    const seen: string[] = []
    let fail = false
    const Store = redisLimitStore({ eval: async (_lua, _n, key, windowMs) => { if (fail) throw new Error('ECONNREFUSED'); seen.push(`${key}|${windowMs}`); return [seen.length, 60_000] } })
    const route = new Store({}).child({ routeInfo: { method: 'POST', url: '/v1/x' } })
    const incr = () => new Promise<{ err: unknown; res: unknown }>(resolve => route.incr('1.2.3.4', (err, res) => resolve({ err, res }), 60_000, 10))
    expect(await incr()).toEqual({ err: null, res: { current: 1, ttl: 60_000 } })
    expect(seen).toEqual(['proxysplit:rl:POST/v1/x:1.2.3.4|60000'])
    fail = true
    expect((await incr()).err).toMatchObject({ code: 'RATE_LIMIT_UNAVAILABLE', status: 503 })
  })
})

// 原来限流是「按路由自己声明」（global:false）：忘了声明的路由（lease、/v1/me、全部后台接口…）完全不限流。
// 现在默认就限（没声明的路由共用一个每 IP 桶），在线客户端定时调的接口各自声明 FLEET_LIMIT（各有各的桶）。
describe('默认限流 + 明确豁免', () => {
  const ip = '203.0.113.77'
  /** 每台在线客户端都会定时调的接口：必须各自声明限额（不落进共用的默认桶）。 */
  const fleetRoutes: Array<['GET' | 'POST' | 'PUT', string]> = [
    ['POST', '/v1/license/lease'], ['POST', '/v1/auth/refresh'], ['POST', '/v1/auth/logout'], ['POST', '/v1/auth/powervpn/sync'],
    ['GET', '/v1/auth/public-key'], ['GET', '/v1/me'], ['GET', '/v1/me/devices'], ['GET', '/v1/me/orders'], ['GET', '/v1/me/orders/PS1'],
    ['GET', '/v1/announcements'], ['GET', '/v1/tongzhi/inbox'], ['GET', '/v1/releases/latest'], ['GET', '/v1/catalog/plans'],
    ['POST', '/v1/accel/token'], ['GET', '/v1/me/config-sync'], ['PUT', '/v1/me/config-sync'], ['GET', '/v1/me/config-profiles'],
    ['POST', '/v1/client/telemetry'], ['POST', '/v1/client/nodes'], ['GET', '/v1/fenxiao/me'],
  ]
  const exhaustDefault = async (t: Awaited<ReturnType<typeof app>>) => {
    // 没声明限额的路由（这里用两个后台接口）共用默认桶：用满它
    for (let i = 0; i < DEFAULT_LIMIT.max; i++) {
      const r = await t.app.inject({ method: 'GET', url: i % 2 ? '/v1/admin/dashboard' : '/v1/admin/users', remoteAddress: ip })
      if (r.statusCode === 429) throw new Error(`default bucket ran out early at ${i}`)
    }
  }

  it('没声明限额的路由也被限：同一 IP 用满默认额度后 429；别的 IP 不受影响', async () => {
    const t = await app()
    await exhaustDefault(t)
    const over = await t.app.inject({ method: 'GET', url: '/v1/admin/orders', remoteAddress: ip })
    expect(over.statusCode).toBe(429)
    expect(over.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } })
    expect((await t.app.inject({ method: 'GET', url: '/v1/admin/orders', remoteAddress: '203.0.113.78' })).statusCode).not.toBe(429)
    await t.app.close()
  }, 30_000)

  it('默认额度用满后：/health、付款回调、客户端定时接口照常（各自豁免或有自己的桶）', async () => {
    const t = await app()
    await exhaustDefault(t)
    expect((await t.app.inject({ method: 'GET', url: '/health', remoteAddress: ip })).statusCode).toBe(200)
    for (const url of ['/v1/payments/zhongzhuan/notify', '/v1/pay/center/notify']) {
      expect((await t.app.inject({ method: 'POST', url, remoteAddress: ip, payload: {} })).statusCode, url).not.toBe(429)
    }
    for (const [method, url] of fleetRoutes) {
      expect((await t.app.inject({ method, url, remoteAddress: ip, ...(method === 'GET' ? {} : { payload: {} }) })).statusCode, `${method} ${url}`).not.toBe(429)
    }
    await t.app.close()
  }, 30_000)

  it('/health 完全不限流（探活不能被自己打挂）', async () => {
    const t = await app()
    for (let i = 0; i < DEFAULT_LIMIT.max + 50; i++) {
      const r = await t.app.inject({ method: 'GET', url: '/health', remoteAddress: ip })
      if (r.statusCode !== 200) throw new Error(`/health answered ${r.statusCode} at ${i}`)
    }
    await t.app.close()
  }, 30_000)

  it('默认额度与定时接口的额度都远高于一个出口 IP 后的正常用量', () => {
    expect(DEFAULT_LIMIT.max).toBeGreaterThanOrEqual(600)
    expect(FLEET_LIMIT.max).toBeGreaterThanOrEqual(600)
    expect(CALLBACK_LIMIT.max).toBeGreaterThanOrEqual(1200)
  })
})

// 一户宽带 / 一台手机拿到的是整个 IPv6 /64：按单个地址限流，换个后缀就是一个新桶，等于不限。
describe('IPv6 按 /64 计', () => {
  const payload = { username: 'alice', email: 'a@example.com', password: 'a-long-enough-password', device: { fingerprint, name: 'pc', platform: 'windows', appVersion: '1.12.5' } }
  it('同一 /64 里换地址注册：共用一个桶（每小时 3 次），别的 /64 不受影响', async () => {
    let registered = 0
    const core = { auth: { publicKeyPem: 'K', register: async () => { registered++; return { ok: true } } }, store: {}, close: async () => {} }
    const a = await buildApp(config, core as never)
    const post = (remoteAddress: string) => a.inject({ method: 'POST', url: '/v1/auth/register', remoteAddress, payload })
    const codes: number[] = []
    for (let i = 1; i <= 4; i++) codes.push((await post(`2408:8207:1234:5678::${i}`)).statusCode)
    expect(codes).toEqual([200, 200, 200, 429])
    expect((await post('2408:8207:1234:5679::1')).statusCode).toBe(200)
    expect(registered).toBe(4)
    await a.close()
  })
})
