import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import type { ApiConfig } from './config.js'

describe('commercial API shell', () => {
  it('exposes health and the lease verification public key without authentication', async () => {
    const config: ApiConfig = {
      NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 18780, PUBLIC_BASE_URL:'http://127.0.0.1:18780',
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

  it('limits a pending-device token to device recovery endpoints', async () => {
    const config: ApiConfig = {
      NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 18780, PUBLIC_BASE_URL:'http://127.0.0.1:18780',
      DATABASE_URL: 'postgres://unused', ACCESS_TOKEN_SECRET: 'test-secret-must-be-at-least-32-bytes-long',
      REFRESH_TOKEN_TTL_DAYS: 30, ADMIN_ORIGIN: 'http://127.0.0.1:18781',
    }
    const core = {
      auth: { publicKeyPem: 'PUBLIC-KEY', verifyAccess: async () => ({ userId: 'u', deviceId: 'pending', role: 'admin' }) },
      store: {}, close: async () => {},
    }
    const app = await buildApp(config, core as never)
    const order = await app.inject({
      method: 'POST', url: '/v1/orders',
      headers: { authorization: 'Bearer pending-token' },
      payload: { planId: '44444444-4444-4444-8444-444444444444' },
    })
    expect(order.statusCode).toBe(403)
    expect(order.json()).toMatchObject({ error: { code: 'DEVICE_ACTIVATION_REQUIRED' } })
    const admin = await app.inject({
      method: 'GET', url: '/v1/admin/dashboard',
      headers: { authorization: 'Bearer pending-token' },
    })
    expect(admin.statusCode).toBe(403)
    await app.close()
  })

  it('accepts legacy bodyless device DELETE requests that advertise JSON', async () => {
    const config: ApiConfig = {
      NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 18780, PUBLIC_BASE_URL:'http://127.0.0.1:18780',
      DATABASE_URL: 'postgres://unused', ACCESS_TOKEN_SECRET: 'test-secret-must-be-at-least-32-bytes-long',
      REFRESH_TOKEN_TTL_DAYS: 30, ADMIN_ORIGIN: 'http://127.0.0.1:18781',
    }
    let unbound=''
    const core = {
      auth: { publicKeyPem: 'PUBLIC-KEY', verifyAccess: async () => ({ userId: 'u', deviceId: 'current', role: 'user' }) },
      store: {
        unbindDevice: async(id:string,userId:string)=>{unbound=`${userId}:${id}`;return {userId}},
        audit: async()=>{},
      },
      close: async () => {},
    }
    const app = await buildApp(config, core as never)
    const response = await app.inject({
      method: 'DELETE', url: '/v1/me/devices/old-device',
      headers: { authorization: 'Bearer token', 'content-type':'application/json' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ok:true})
    expect(unbound).toBe('u:old-device')
    await app.close()
  })
})
