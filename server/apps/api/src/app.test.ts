import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import type { ApiConfig } from './config.js'

describe('commercial API shell', () => {
  it('exposes health and the lease verification public key without authentication', async () => {
    const config: ApiConfig = {
      NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 18780,
      DATABASE_URL: 'postgres://unused', ACCESS_TOKEN_SECRET: 'test-secret-must-be-at-least-32-bytes-long',
      REFRESH_TOKEN_TTL_DAYS: 30, ADMIN_ORIGIN: 'http://127.0.0.1:18781',
    }
    const core = {
      auth: { publicKeyPem: 'PUBLIC-KEY', verifyAccess: async () => ({ userId: 'u', deviceId: 'd', role: 'admin' }) },
      store: {}, close: async () => {},
    }
    const app = await buildApp(config, core as never)
    const health = await app.inject({ method: 'GET', url: '/health' })
    expect(health.statusCode).toBe(200)
    expect(health.json()).toMatchObject({ ok: true, service: 'proxysplit-commercial-api' })
    const key = await app.inject({ method: 'GET', url: '/v1/auth/public-key' })
    expect(key.json()).toMatchObject({ algorithm: 'Ed25519', publicKeyPem: 'PUBLIC-KEY' })
    await app.close()
  })
})
