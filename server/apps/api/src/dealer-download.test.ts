import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import type { ApiConfig } from './config.js'

const config: ApiConfig = {
  NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 18780, PUBLIC_BASE_URL: 'http://127.0.0.1:18780',
  DATABASE_URL: 'postgres://unused', ACCESS_TOKEN_SECRET: 'test-secret-must-be-at-least-32-bytes-long',
  REFRESH_TOKEN_TTL_DAYS: 30, ADMIN_ORIGIN: 'http://127.0.0.1:18781',
}

describe('dealer-site download route', () => {
  it('records and redirects proxysplit-ai-d-<slug>.exe, rejects anything else', async () => {
    const events: Array<{ file?: string }> = []
    const core = {
      auth: { publicKeyPem: 'K', verifyAccess: async () => ({ userId: 'u', deviceId: 'd', role: 'user' }) },
      store: { recordDownloadEvent: async (e: { file?: string }) => { events.push(e) }, releaseExists: async () => true },
      close: async () => {},
    }
    const app = await buildApp(config, core as never)
    for (const file of ['proxysplit-ai-d-wen.exe', 'proxysplit-ai-d-my-shop-2.exe', 'proxysplit-ai-latest.exe']) {
      const r = await app.inject({ method: 'GET', url: `/v1/download/${file}` })
      expect(r.statusCode).toBe(302)
      expect(r.headers.location).toBe(`/download/${file}`)
    }
    for (const file of ['proxysplit-ai-d-w.exe', 'proxysplit-ai-d-WEN.exe', 'proxysplit-ai-d-abcdefghijabcdefghijabcdefghijk.exe', 'proxysplit-ai-d-we_n.exe', 'proxysplit-ai-d-wen.zip']) {
      const r = await app.inject({ method: 'GET', url: `/v1/download/${file}` })
      expect(r.statusCode, file).toBe(404)
    }
    expect(events.map(e => e.file)).toEqual(['proxysplit-ai-d-wen.exe', 'proxysplit-ai-d-my-shop-2.exe', 'proxysplit-ai-latest.exe'])
    await app.close()
  })
})
