import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import type { ApiConfig } from './config.js'

// 设备 id 是 uuid：路径参数现在统一校验形状（params.ts），所以这里用真实形状的 id。
const OLD_DEVICE = '77777777-7777-4777-8777-777777777777'

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
      method: 'DELETE', url: `/v1/me/devices/${OLD_DEVICE}`,
      headers: { authorization: 'Bearer token', 'content-type':'application/json' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ok:true})
    expect(unbound).toBe(`u:${OLD_DEVICE}`)
    await app.close()
  })

  it('统一支付中心回调路由按原始字符串收体；未配置回 503、验签失败回 4xx（都不是 2xx，中心会重试）', async () => {
    const config: ApiConfig = {
      NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 18780, PUBLIC_BASE_URL:'http://127.0.0.1:18780',
      DATABASE_URL: 'postgres://unused', ACCESS_TOKEN_SECRET: 'test-secret-must-be-at-least-32-bytes-long',
      REFRESH_TOKEN_TTL_DAYS: 30, ADMIN_ORIGIN: 'http://127.0.0.1:18781',
    }
    const body = JSON.stringify({ event: 'order.paid', site_order_no: 'PR1', sign: 'bad' })
    const off = await buildApp(config, { auth: {}, store: {}, payCenterEnv: {}, close: async () => {} } as never)
    const r1 = await off.inject({ method: 'POST', url: '/v1/pay/center/notify', headers: { 'content-type': 'application/json' }, payload: body })
    expect(r1.statusCode).toBe(503)
    await off.close()
    const env = { PAY_MODE: 'center', PAY_CENTER_URL: 'https://zfzx.invalid', PAY_CENTER_APP_ID: 'site-test', PAY_CENTER_SECRET: 'test-secret' }
    const on = await buildApp(config, { auth: {}, store: { pool: { query: async () => ({ rows: [] }) } }, payCenterEnv: env, close: async () => {} } as never)
    const r2 = await on.inject({ method: 'POST', url: '/v1/pay/center/notify', headers: { 'content-type': 'application/json' }, payload: body })
    expect(r2.statusCode).toBeGreaterThanOrEqual(400)
    expect(r2.statusCode).toBeLessThan(500)
    expect(r2.body).not.toContain('"code":0')
    await on.close()
  })
})

describe('GET /v1/catalog/plans', () => {
  const config: ApiConfig = {
    NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 18780, PUBLIC_BASE_URL:'http://127.0.0.1:18780',
    DATABASE_URL: 'postgres://unused', ACCESS_TOKEN_SECRET: 'test-secret-must-be-at-least-32-bytes-long',
    REFRESH_TOKEN_TTL_DAYS: 30, ADMIN_ORIGIN: 'http://127.0.0.1:18781',
  }
  const catalog = async (provider: { adapter: string; config: Record<string, string>; enabled: boolean } | null) => {
    const core = {
      auth: { publicKeyPem: 'PUBLIC-KEY' },
      store: {
        listPlans: async () => ({ items: [{ id: 'p1', name: '普通会员', maxDevices: 3 }] }),
        getCommerceSettings: async () => ({ defaultDeviceLimit: 2, activePaymentProvider: 'active', paymentMethods: ['alipay'] }),
        getProvider: async (code: string) => (code === 'active' ? provider : null),
      },
      close: async () => {},
    }
    const app = await buildApp(config, core as never)
    const res = await app.inject({ method: 'GET', url: '/v1/catalog/plans' })
    await app.close()
    expect(res.statusCode).toBe(200)
    return res.json() as { items: unknown[]; paymentMethods: string[]; freeDevices: number }
  }

  it('带上免费版设备数，付款方式按当前收款通道给（统一支付中心 = 微信）', async () => {
    const body = await catalog({ adapter: 'center', config: {}, enabled: true })
    expect(body.items).toHaveLength(1)
    expect(body.freeDevices).toBe(2)
    expect(body.paymentMethods).toEqual(['wechat'])
  })

  it('直连支付网关：仍是设置里的支付宝', async () => {
    expect((await catalog({ adapter: 'zhongzhuan', config: {}, enabled: true })).paymentMethods).toEqual(['alipay'])
    expect((await catalog(null)).paymentMethods).toEqual(['alipay'])
  })
})
