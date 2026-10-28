// 实际权益：免费档 + 会员叠加设备数（docs/plan-2026-10-29-free-sync-phone.md「免费档」）。
// 登录、激活设备、租约、/v1/me、云同步都只认这里算出来的结果。
import type { Entitlement } from './store.js'

export type EffectiveTier = Entitlement['tier'] | 'free'
export type EffectiveEntitlement = Omit<Entitlement, 'tier'> & { tier: EffectiveTier }
export type Effective = {
  ent: EffectiveEntitlement
  /** 有会员（含试用）或管理员：能用云同步 / 云端配置。 */
  member: boolean
  freeDevices: number
  planDevices: number
  /** 绑定 / 租约时实际执行的设备上限（管理员不限）。 */
  deviceLimit: number
}

const FOREVER = new Date('2999-12-31T23:59:59.000Z')
const ADMIN: Entitlement = { licenseId: 'admin', planId: 'admin', planCode: 'admin', planName: 'Administrator', tier: 'premium', maxDevices: 10, features: ['admin'], expiresAt: FOREVER, lifetime: true, status: 'active' }

export function effective(user: { role: string }, ent: Entitlement | null, settings: { defaultDeviceLimit: number }): Effective {
  const free = Math.max(0, Math.floor(Number(settings.defaultDeviceLimit) || 0))
  if (user.role === 'admin') {
    const v = ent ?? ADMIN
    return { ent: v, member: true, freeDevices: free, planDevices: v.maxDevices, deviceLimit: Number.MAX_SAFE_INTEGER }
  }
  if (ent) {
    const maxDevices = free + ent.maxDevices
    return { ent: { ...ent, maxDevices }, member: true, freeDevices: free, planDevices: ent.maxDevices, deviceLimit: maxDevices }
  }
  return {
    ent: { licenseId: 'free', planId: 'free', planCode: 'free', planName: '免费版', tier: 'free', maxDevices: free, features: ['free'], expiresAt: FOREVER, lifetime: true, status: 'active' },
    member: false, freeDevices: free, planDevices: 0, deviceLimit: free,
  }
}

/** 云端命名配置份数：免费 0、普通（含试用）1、超级 5；管理员按超级。 */
export function profileQuota(e: Effective): number {
  if (!e.member) return 0
  return e.ent.tier === 'premium' ? 5 : 1
}

/** 登录 / /v1/me 响应里的 license 字段（老字段不变，只加 member / freeDevices / planDevices）。 */
export const licenseView = (e: Effective) => ({
  plan: e.ent.planName, planCode: e.ent.planCode, tier: e.ent.tier, expiresAt: e.ent.expiresAt, features: e.ent.features,
  maxDevices: e.ent.maxDevices, lifetime: e.ent.lifetime, member: e.member, freeDevices: e.freeDevices, planDevices: e.planDevices,
})
