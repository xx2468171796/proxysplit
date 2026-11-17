// 后台权限闸门：普通管理员动不了管理员账号（含超管），也不能新建管理员。
import { describe, expect, it, vi } from 'vitest'
import { buildApp } from './app.js'
import { createAdminGuard } from './admin-guard.js'
import type { ApiConfig } from './config.js'

const config: ApiConfig = {
  NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 18780, PUBLIC_BASE_URL: 'http://127.0.0.1:18780',
  DATABASE_URL: 'postgres://unused', ACCESS_TOKEN_SECRET: 'test-secret-must-be-at-least-32-bytes-long',
  REFRESH_TOKEN_TTL_DAYS: 30, ADMIN_ORIGIN: 'http://127.0.0.1:18781',
}
const ids = {
  root: '11111111-1111-4111-8111-111111111111', staff: '22222222-2222-4222-8222-222222222222',
  otherAdmin: '33333333-3333-4333-8333-333333333333', customer: '44444444-4444-4444-8444-444444444444',
  plan: '55555555-5555-4555-8555-555555555555', device: '66666666-6666-4666-8666-666666666666',
}
const users: Record<string, { id: string; username: string; role: string; status: string }> = {
  [ids.root]: { id: ids.root, username: 'admin', role: 'admin', status: 'active' },
  [ids.staff]: { id: ids.staff, username: 'staff', role: 'admin', status: 'active' },
  [ids.otherAdmin]: { id: ids.otherAdmin, username: 'ops', role: 'admin', status: 'active' },
  [ids.customer]: { id: ids.customer, username: 'alice', role: 'user', status: 'active' },
}

async function appAs(operator: string) {
  const store = {
    findUserById: async (id: string) => users[id] ?? null,
    findDevice: async (id: string) => (id === ids.device ? { id, userId: ids.root } : null),
    setUserStatus: vi.fn(async () => true), extendLicense: vi.fn(async () => ({ id: 'lic' })), deleteUser: vi.fn(async () => ({ ok: true })),
    adminGrantLicense: vi.fn(async () => ({ ok: true })), createUserWithLicense: vi.fn(async () => ({ id: 'new' })), unbindDevice: vi.fn(async () => ({ userId: ids.root })),
    audit: vi.fn(async () => undefined),
  }
  const core = { auth: { verifyAccess: async () => ({ userId: operator, deviceId: 'd', role: 'admin' }) }, store, close: async () => {} }
  const app = await buildApp(config, core as never)
  const call = (method: 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: { authorization: 'Bearer t' }, ...(payload ? { payload } : {}) })
  return { app, store, call }
}
const password = 'a-long-enough-password'
/** 每个会改动目标账号的后台接口（:id 换成目标）。 */
const mutations = (id: string): Array<['POST' | 'PATCH' | 'DELETE', string, object?]> => [
  ['PATCH', `/v1/admin/users/${id}/password`, { password }],
  ['PATCH', `/v1/admin/users/${id}/status`, { status: 'suspended' }],
  ['POST', `/v1/admin/users/${id}/extend`, { days: 30 }],
  ['POST', `/v1/admin/users/${id}/grant`, { planId: ids.plan, durationDays: 30 }],
  ['DELETE', `/v1/admin/users/${id}`],
  ['POST', `/v1/admin/users/${id}/ban`, { days: 1, reason: 'test reason' }],
  ['POST', `/v1/admin/users/${id}/unban`, { reason: 'test reason' }],
  ['POST', `/v1/admin/users/${id}/nickname`, { nickname: 'x' }],
  ['POST', `/v1/admin/users/${id}/revoke-sessions`, { reason: 'test reason' }],
]

describe('后台权限：动管理员账号要超级管理员', () => {
  it('普通管理员对超管 / 其他管理员的每个写接口都是 403，业务代码没被调用', async () => {
    const t = await appAs(ids.staff)
    for (const target of [ids.root, ids.otherAdmin]) {
      for (const [method, url, payload] of mutations(target)) {
        const r = await t.call(method, url, payload)
        expect(r.statusCode, `${method} ${url}`).toBe(403)
        expect(r.json(), url).toMatchObject({ error: { code: 'SUPER_ADMIN_REQUIRED' } })
      }
    }
    expect((await t.call('DELETE', `/v1/admin/devices/${ids.device}`)).statusCode).toBe(403)
    for (const fn of [t.store.setUserStatus, t.store.extendLicense, t.store.deleteUser, t.store.adminGrantLicense, t.store.unbindDevice]) expect(fn).not.toHaveBeenCalled()
    await t.app.close()
  })

  it('普通管理员不能新建管理员，建普通用户照常', async () => {
    const t = await appAs(ids.staff)
    const asAdmin = await t.call('POST', '/v1/admin/users', { username: 'newadmin', password, role: 'admin' })
    expect(asAdmin.statusCode).toBe(403)
    expect(t.store.createUserWithLicense).not.toHaveBeenCalled()
    expect((await t.call('POST', '/v1/admin/users', { username: 'newuser', password, role: 'user' })).statusCode).toBe(200)
    await t.app.close()
  })

  // 后台建号是注册之外唯一能定用户名的入口：像手机号的用户名在这里也拒（登录框会和别人的手机号撞）。
  it('后台也不能建手机号形状的用户名', async () => {
    const t = await appAs(ids.root)
    for (const username of ['13900139000', '+8613900139000']) {
      const r = await t.call('POST', '/v1/admin/users', { username, password, role: 'user' })
      expect(r.statusCode, username).toBe(400)
      expect(r.json()).toMatchObject({ error: { code: 'USERNAME_IS_PHONE' } })
    }
    expect(t.store.createUserWithLicense).not.toHaveBeenCalled()
    await t.app.close()
  })

  it('普通管理员管普通用户照常；超管可以动管理员、建管理员', async () => {
    const staff = await appAs(ids.staff)
    expect((await staff.call('PATCH', `/v1/admin/users/${ids.customer}/status`, { status: 'suspended' })).statusCode).toBe(200)
    expect((await staff.call('POST', `/v1/admin/users/${ids.customer}/extend`, { days: 30 })).statusCode).toBe(200)
    await staff.app.close()
    const root = await appAs(ids.root)
    expect((await root.call('PATCH', `/v1/admin/users/${ids.otherAdmin}/status`, { status: 'suspended' })).statusCode).toBe(200)
    expect((await root.call('POST', '/v1/admin/users', { username: 'newadmin', password, role: 'admin' })).statusCode).toBe(200)
    expect((await root.call('DELETE', `/v1/admin/devices/${ids.device}`)).statusCode).toBe(200)
    await root.app.close()
  })
})

// 公司员工标记决定谁的节点清单会被收进来：只有超级管理员能改，改动由 store 同事务写审计。
describe('公司员工开关', () => {
  it('超管能开关；普通管理员 403；用户详情带上「我能不能改」', async () => {
    const root = await appAs(ids.root)
    const setUserStaff = vi.fn(async (id: string, staff: boolean) => (id === ids.customer ? { id, staff } : null))
    Object.assign(root.store, { setUserStaff, getUserDetail: async () => ({ user: { id: ids.customer, staff: false } }) })
    const on = await root.call('PATCH', `/v1/admin/users/${ids.customer}/staff`, { staff: true })
    expect(on.statusCode).toBe(200)
    expect(on.json()).toEqual({ id: ids.customer, staff: true })
    expect(setUserStaff).toHaveBeenCalledWith(ids.customer, true, { actor: ids.root, ip: expect.any(String) })
    expect((await root.call('PATCH', `/v1/admin/users/${ids.customer}/staff`, { staff: 'yes' })).statusCode).toBe(400)
    expect((await root.call('PATCH', `/v1/admin/users/${ids.plan}/staff`, { staff: true })).statusCode).toBe(404)
    const detail = await root.app.inject({ method: 'GET', url: `/v1/admin/users/${ids.customer}`, headers: { authorization: 'Bearer t' } })
    expect(detail.json()).toMatchObject({ user: { staff: false }, viewer: { superAdmin: true } })
    await root.app.close()

    const staff = await appAs(ids.staff)
    const blocked = vi.fn(async () => ({ id: ids.customer, staff: true }))
    Object.assign(staff.store, { setUserStaff: blocked, getUserDetail: async () => ({ user: { id: ids.customer, staff: false } }) })
    const denied = await staff.call('PATCH', `/v1/admin/users/${ids.customer}/staff`, { staff: true })
    expect(denied.statusCode).toBe(403)
    expect(denied.json()).toMatchObject({ error: { code: 'SUPER_ADMIN_REQUIRED' } })
    expect(blocked).not.toHaveBeenCalled()
    const seen = await staff.app.inject({ method: 'GET', url: `/v1/admin/users/${ids.customer}`, headers: { authorization: 'Bearer t' } })
    expect(seen.json()).toMatchObject({ viewer: { superAdmin: false } })
    await staff.app.close()
  })
})

describe('超管名单', () => {
  it('SUPER_ADMIN_USERNAMES 配成空串 / 全是空白：按默认的 admin（否则没有任何人能管理管理员账号）', async () => {
    for (const value of ['', ' , ']) {
      const guard = createAdminGuard({ findUser: async id => users[id] ?? null, superAdminUsernames: value })
      expect(await guard.isSuperAdmin({ userId: ids.root, role: 'admin' })).toBe(true)
      expect(await guard.isSuperAdmin({ userId: ids.staff, role: 'admin' })).toBe(false)
    }
    const custom = createAdminGuard({ findUser: async id => users[id] ?? null, superAdminUsernames: 'Ops, boss' })
    expect(await custom.isSuperAdmin({ userId: ids.otherAdmin, role: 'admin' })).toBe(true)
    expect(await custom.isSuperAdmin({ userId: ids.root, role: 'admin' })).toBe(false)
  })
})
