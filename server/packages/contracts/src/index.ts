import { z } from 'zod'

export const deviceSchema = z.object({
  fingerprint: z.string().min(32).max(128),
  hardwareHash: z.string().min(32).max(128).optional(),
  name: z.string().trim().min(1).max(80),
  platform: z.literal('windows'),
  appVersion: z.string().regex(/^\d+\.\d+\.\d+(?:[-+].+)?$/),
})
export const loginSchema = z.object({ username: z.string().trim().min(3).max(64), password: z.string().min(8).max(256), device: deviceSchema })
export const registerSchema = z.object({
  // 当前以邮箱作为普通用户账号；暂不启用邮箱验证码，提交即注册。
  username: z.string().trim().email().max(64),
  password: z.string().min(8).max(256),
  device: deviceSchema,
})
export const refreshSchema = z.object({ refreshToken: z.string().min(40), deviceFingerprint: z.string().min(32).max(128) })
// 已登录但设备名额满时，允许仅使用短期访问令牌在新电脑上腾出一个名额。
export const activateDeviceSchema = z.object({ device: deviceSchema })
export const leaseSchema = z.object({ deviceFingerprint: z.string().min(32).max(128), appVersion: z.string().min(5).max(40) })
export const userCreateSchema = z.object({ username: z.string().trim().min(3).max(64), password: z.string().min(10).max(256), role: z.enum(['user','admin']).default('user'), planId: z.string().uuid().optional(), days: z.number().int().min(1).max(3650).default(30) })
export const userStatusSchema = z.object({ status: z.enum(['active','suspended','banned']) })
// 管理端重置密码：与客户端注册保持一致，密码最低 8 位。
export const userPasswordSchema = z.object({ password: z.string().min(8).max(256) })
export const licenseExtendSchema = z.object({ days: z.number().int().min(1).max(3650) })
export const releaseCreateSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/), minimumVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  url: z.string().url(), sha256: z.string().regex(/^[a-f0-9]{64}$/), signature: z.string().min(32),
  mandatory: z.boolean().default(false), title:z.string().trim().max(120).default(''),
  summary:z.string().trim().max(500).default(''), changelog:z.string().trim().max(20000).default(''),
  channel:z.enum(['stable','beta']).default('stable'),
})
const planBaseSchema = z.object({
  code: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).default(''),
  tier: z.enum(['trial','standard','premium']),
  billingCycle: z.enum(['trial','month','quarter','year','lifetime','custom']),
  durationDays: z.number().int().min(1).max(36500).nullable().optional(),
  lifetime: z.boolean().default(false),
  priceCents: z.number().int().min(0).max(100_000_000),
  originalPriceCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  currency: z.literal('CNY').default('CNY'),
  maxDevices: z.number().int().min(1).max(100),
  features: z.array(z.string().trim().min(1).max(64)).max(50).default([]),
  active: z.boolean().default(false),
  public: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10000).default(100),
  badge: z.string().trim().max(30).default(''),
  saleStartsAt:z.string().datetime().nullable().optional(),
  saleEndsAt:z.string().datetime().nullable().optional(),
  purchaseLimitPerUser:z.number().int().min(1).max(10000).nullable().optional(),
})
export const planUpsertSchema = planBaseSchema.superRefine((v,ctx)=>{
  if(v.lifetime&&v.billingCycle!=='lifetime')ctx.addIssue({code:'custom',path:['billingCycle'],message:'永久套餐的周期必须为 lifetime'})
  if(!v.lifetime&&v.billingCycle!=='trial'&&!v.durationDays)ctx.addIssue({code:'custom',path:['durationDays'],message:'非永久套餐必须设置有效天数'})
})
export const planPatchSchema = planBaseSchema.partial().omit({code:true})
export const orderCreateSchema = z.object({planId:z.string().uuid()})
export const settingPatchSchema = z.object({
  registrationEnabled:z.boolean().optional(),
  trialDays:z.number().int().min(0).max(365).optional(),
  trialPlanCode:z.string().min(2).max(64).optional(),
  defaultDeviceLimit:z.number().int().min(1).max(100).optional(),
  licenseLeaseMinutes:z.number().int().min(15).max(1440).optional(),
    offlineGraceHours:z.number().int().min(0).max(72).optional(),
    activePaymentProvider:z.string().min(2).max(64).optional(),
    paymentMethods:z.array(z.enum(['alipay'])).min(1).max(1).optional(),
  })
export const providerUpsertSchema = z.object({
  code:z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  displayName:z.string().trim().min(2).max(80),
  adapter:z.enum(['zhongzhuan','manual']),
  endpoint:z.string().url().or(z.literal('')),
  merchantId:z.string().trim().max(120).default(''),
  credentialRef:z.string().regex(/^[A-Z][A-Z0-9_]{2,80}$/),
  config:z.record(z.string(),z.union([z.string(),z.number(),z.boolean()])).default({}),
  enabled:z.boolean().default(false),
})
export const announcementUpsertSchema = z.object({
  type:z.enum(['notice','maintenance','release']).default('notice'),
  title:z.string().trim().min(2).max(160),
  summary:z.string().trim().max(500).default(''),
  content:z.string().trim().min(1).max(20000),
  version:z.string().trim().max(40).default(''),
  active:z.boolean().default(true),
  pinned:z.boolean().default(false),
  startsAt:z.string().datetime().nullable().optional(),
  endsAt:z.string().datetime().nullable().optional(),
})
export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type DeviceInput = z.infer<typeof deviceSchema>
export type RefreshInput = z.infer<typeof refreshSchema>
export type ActivateDeviceInput = z.infer<typeof activateDeviceSchema>
export type UserPasswordInput = z.infer<typeof userPasswordSchema>
export type LeaseInput = z.infer<typeof leaseSchema>
export type PlanUpsertInput = z.infer<typeof planUpsertSchema>
export type PlanPatchInput = z.infer<typeof planPatchSchema>
export type ProviderUpsertInput = z.infer<typeof providerUpsertSchema>
export type AnnouncementUpsertInput = z.infer<typeof announcementUpsertSchema>
