// POST /v1/auth/sms/send：把人机凭证 / 用户真实 IP / 设备标识交给 core，错误里带回冷却秒数；LCV_* 配置校验。
import { describe, expect, it } from 'vitest'
import { AppError } from '@proxysplit/shared'
import { buildApp } from './app.js'
import { loadConfig, type ApiConfig } from './config.js'

const config: ApiConfig = {
  NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 18780, PUBLIC_BASE_URL: 'http://127.0.0.1:18780',
  DATABASE_URL: 'postgres://unused', ACCESS_TOKEN_SECRET: 'test-secret-must-be-at-least-32-bytes-long',
  REFRESH_TOKEN_TTL_DAYS: 30, ADMIN_ORIGIN: 'http://127.0.0.1:18781',
}
type Seen = { input: Record<string, unknown>; userId: string | null; ctx: Record<string, unknown> }
async function appWith(send: (seen: Seen) => unknown) {
  const calls: Seen[] = []
  const auth = {
    publicKeyPem: 'K',
    verifyAccess: async () => ({ userId: 'u1', deviceId: 'd1', role: 'user' }),
    sendSmsCode: async (input: Record<string, unknown>, userId: string | null, ctx: Record<string, unknown>) => { const seen = { input, userId, ctx }; calls.push(seen); return send(seen) },
  }
  return { app: await buildApp(config, { auth, store: {}, close: async () => {} } as never), calls }
}

describe('POST /v1/auth/sms/send', () => {
  it('passes ticket, the client IP from the single trusted proxy hop and the device id', async () => {
    const { app, calls } = await appWith(() => ({ ok: true, cooldownSeconds: 45, message: 'sent' }))
    const r = await app.inject({ method: 'POST', url: '/v1/auth/sms/send', headers: { 'x-forwarded-for': '203.0.113.9' }, payload: { phone: '+86 138 0013 8000', purpose: 'register', captchaTicket: 'tk', deviceFp: 'fp-body' } })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ ok: true, cooldownSeconds: 45, message: 'sent' })
    expect(calls[0]).toMatchObject({ input: { phone: '13800138000', purpose: 'register' }, userId: null, ctx: { captchaTicket: 'tk', clientIp: '203.0.113.9', deviceFp: 'fp-body' } })
    await app.close()
  })
  it('keeps "no ticket field" (released clients) apart from an empty ticket and never forwards the fingerprint header', async () => {
    const { app, calls } = await appWith(() => ({ ok: true, cooldownSeconds: 60 }))
    await app.inject({ method: 'POST', url: '/v1/auth/sms/send', headers: { 'x-device-fingerprint': 'raw-fingerprint' }, payload: { phone: '13800138000', purpose: 'reset' } })
    await app.inject({ method: 'POST', url: '/v1/auth/sms/send', payload: { phone: '13800138000', purpose: 'reset', captchaTicket: '' } })
    expect(calls[0]?.ctx).toEqual({ captchaTicket: undefined, clientIp: '127.0.0.1', deviceFp: null, web: false })
    expect(calls[1]?.ctx).toMatchObject({ captchaTicket: '', deviceFp: null, web: false })
    await app.close()
  })
  it('marks browser requests (Origin header) so a stale page gets the refresh wording', async () => {
    const { app, calls } = await appWith(() => ({ ok: true, cooldownSeconds: 60 }))
    await app.inject({ method: 'POST', url: '/v1/auth/sms/send', headers: { origin: 'https://proxysplit.zygskins.cn' }, payload: { phone: '13800138000', purpose: 'register' } })
    expect(calls[0]?.ctx).toMatchObject({ captchaTicket: undefined, web: true })
    await app.close()
  })
  it('bind needs a session and passes the user id', async () => {
    const { app, calls } = await appWith(() => ({ ok: true, cooldownSeconds: 60 }))
    await app.inject({ method: 'POST', url: '/v1/auth/sms/send', headers: { authorization: 'Bearer t' }, payload: { phone: '13800138000', purpose: 'bind', captchaTicket: 'tk' } })
    expect(calls[0]?.userId).toBe('u1')
    await app.close()
  })
  it('returns the error code, message and cooldown seconds so the countdown stays right', async () => {
    const { app } = await appWith(() => { throw new AppError('SMS_COOLDOWN', '发送太频繁，请 42 秒后再试', 429, { cooldownSeconds: 42 }) })
    const r = await app.inject({ method: 'POST', url: '/v1/auth/sms/send', payload: { phone: '13800138000', purpose: 'register', captchaTicket: 'tk' } })
    expect(r.statusCode).toBe(429)
    expect(r.json()).toEqual({ error: { code: 'SMS_COOLDOWN', message: '发送太频繁，请 42 秒后再试', cooldownSeconds: 42 } })
    await app.close()
  })
  it('rejects an oversized ticket before it reaches the center', async () => {
    const { app, calls } = await appWith(() => ({ ok: true, cooldownSeconds: 60 }))
    const r = await app.inject({ method: 'POST', url: '/v1/auth/sms/send', payload: { phone: '13800138000', purpose: 'register', captchaTicket: 'x'.repeat(2049) } })
    expect(r.statusCode).toBe(400)
    expect(calls).toEqual([])
    await app.close()
  })
})

describe('startup SMS mode', () => {
  const lcvConfig: ApiConfig = { ...config, REDIS_URL: 'redis://127.0.0.1:1', LCV_SITE_ID: 'proxysplit', LCV_HOST: 'proxysplit.zygskins.cn', LCV_SITE_SECRET: 's'.repeat(32) }
  it('refuses to start when env asks for center mode but the core did not switch', async () => {
    await expect(buildApp(lcvConfig, { auth: { publicKeyPem: 'K' }, store: {}, close: async () => {} } as never)).rejects.toThrow(/center SMS mode/)
  })
  it('starts when the core really is in center mode', async () => {
    let mode: 'local' | 'center' = 'local'
    const auth = { publicKeyPem: 'K', setSmsCenter: () => { mode = 'center' }, get smsMode() { return mode } }
    const app = await buildApp(lcvConfig, { auth, store: {}, close: async () => {} } as never)
    expect(mode).toBe('center')
    await app.close()
  })
})

describe('LCV_* config', () => {
  const base = { DATABASE_URL: 'postgres://x', ACCESS_TOKEN_SECRET: 'a'.repeat(32), NODE_ENV: 'test' }
  const lcv = { LCV_SITE_ID: 'proxysplit', LCV_HOST: 'proxysplit.zygskins.cn', LCV_SITE_SECRET: 's'.repeat(32) }
  it('treats empty values as not configured (local mode)', () => {
    const c = loadConfig({ ...base, LCV_SITE_ID: '', LCV_HOST: '', LCV_SITE_SECRET: '', LCV_URL: '' })
    expect([c.LCV_SITE_ID, c.LCV_HOST, c.LCV_SITE_SECRET, c.LCV_URL]).toEqual([undefined, undefined, undefined, undefined])
  })
  it('accepts the full set with Redis and refuses a partial set or a missing Redis at startup', () => {
    expect(loadConfig({ ...base, ...lcv, LCV_URL: 'http://172.20.0.1:18977', REDIS_URL: 'redis://127.0.0.1:6379' }).LCV_SITE_ID).toBe('proxysplit')
    expect(() => loadConfig({ ...base, LCV_SITE_ID: 'proxysplit', REDIS_URL: 'redis://127.0.0.1:6379' })).toThrow()
    expect(() => loadConfig({ ...base, ...lcv })).toThrow()
    expect(() => loadConfig({ ...base, ...lcv, LCV_SITE_SECRET: 'short', REDIS_URL: 'redis://127.0.0.1:6379' })).toThrow()
  })
})
