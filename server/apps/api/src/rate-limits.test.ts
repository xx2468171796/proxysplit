// 限流口径：正在运行的客户端定时调用的接口不能被「同一出口 IP 的多台机器」打满。
import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import type { ApiConfig } from './config.js'
import { FLEET_LIMIT, refreshFamilyKey } from './rate-limits.js'

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
