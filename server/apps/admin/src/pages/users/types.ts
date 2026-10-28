// 用户列表 / 详情的接口形状（GET /v1/admin/users、/users/:id、/users/:id/cloud）。手机号服务端已打码。
export type UserRow = {
  id: string; username: string; email: string | null; phone: string | null; role: 'user' | 'admin'
  status: 'active' | 'suspended' | 'banned'; note: string | null; createdAt: string
  expiresAt: string | null; lifetime: boolean | null; planName: string | null; tier: string | null; devices: number
  hasPassword?: boolean; identities?: string[]; channel?: string | null
  fxTier?: string | null; fxEnabled?: boolean | null; inviter?: string | null; fxDirect?: number
}

export type PlanLite = { id: string; name: string; tier: string; durationDays: number | null; lifetime: boolean; maxDevices: number; active: boolean }

export type UserLicense = {
  id: string; status: string; startsAt: string; expiresAt: string; createdAt: string; source: string | null; lifetime: boolean
  planCode: string; planName: string; tier: string; maxDevices: number; features: string[]
}
export type UserDevice = {
  id: string; name: string; platform: string; appVersion: string; revoked: boolean
  firstSeenAt: string; lastSeenAt: string; activeSessions: number
}
export type UserOrder = {
  orderNo: string; planName: string; tier: string; billingCycle: string; durationDays: number | null; lifetime: boolean
  amountCents: number; currency: string; status: string; providerCode: string; providerOrderNo: string | null
  paidAt: string | null; expiresAt: string | null; createdAt: string
}
export type UserActivity = {
  action: string; targetType: string; targetId: string; ip: string; result: string
  metadata: Record<string, unknown> | null; createdAt: string
}
export type FenxiaoSummary = {
  tierCode: string | null; enabled: boolean; code: string | null; inviter: string | null; boundAt: string | null
  direct: number; team: number; paidOrders: number; earnedCents: number; availableCents: number; frozenCents: number; withdrawnCents: number
}
export type UserDetail = {
  user: {
    id: string; username: string; email: string | null; phone: string | null; role: string; status: UserRow['status']
    note: string | null; createdAt: string; updatedAt: string; trialStartedAt: string | null; trialEndsAt: string | null
  }
  stats: { activeDevices: number; paidOrders: number; paidAmountCents: number }
  fenxiao: FenxiaoSummary | null
  licenses: UserLicense[]
  devices: UserDevice[]
  orders: UserOrder[]
  activity: UserActivity[]
}
export type UserCloud = {
  sync: { version: number; size: number; deviceName: string; updatedAt: string } | null
  profiles: { id: string; name: string; size: number; deviceName: string; shared: boolean; locked: boolean; createdAt: string; updatedAt: string }[]
}

/** 当前生效的会员（详情里取最新一条 active 且未过期的）。 */
export function currentLicense(licenses: readonly UserLicense[], now = Date.now()): UserLicense | null {
  return licenses.find((l) => l.status === 'active' && (l.lifetime || new Date(l.expiresAt).getTime() > now)) ?? null
}

/** 登录方式：密码 / POWER云（中转站渠道另注明）。 */
export function loginMethods(u: Pick<UserRow, 'hasPassword' | 'identities' | 'channel'>): string[] {
  const out: string[] = []
  if (u.hasPassword !== false) out.push('密码')
  if (u.identities?.includes('powervpn')) out.push(u.channel === 'aigw' ? 'POWER云 · 中转站' : 'POWER云')
  return out
}
