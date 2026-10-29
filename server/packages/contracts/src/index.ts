import { z } from 'zod'
import { phoneSchema, smsCodeSchema } from './phone-sync.js'

// 注册：有手机号必须带验证码；没手机号（老客户端）必须有邮箱。
const phoneOrEmail=(v:{email?:string|undefined;phone?:string|undefined;code?:string|undefined},ctx:z.RefinementCtx)=>{
  if(v.phone&&!v.code)ctx.addIssue({code:'custom',path:['code'],message:'请填写短信验证码'})
  if(!v.phone&&!v.email)ctx.addIssue({code:'custom',path:['phone'],message:'请填写手机号'})
}

export const deviceSchema = z.object({
  fingerprint: z.string().min(32).max(128),
  hardwareHash: z.string().min(32).max(128).optional(),
  name: z.string().trim().min(1).max(80),
  platform: z.enum(['windows','macos']),
  appVersion: z.string().regex(/^\d+\.\d+\.\d+(?:[-+].+)?$/),
})
export const loginSchema = z.object({ username: z.string().trim().min(3).max(64), password: z.string().min(8).max(256), device: deviceSchema })
export const registerSchema = z.object({
  // 用户名是登录凭据；邮箱单独保存，当前不验证，后续可平滑开启验证。
  username: z.string().trim().min(3).max(32).refine(value=>!/[\s@]/u.test(value),'用户名不能包含空格或 @'),
  // 新客户端：手机号 + 短信验证码（邮箱可选）；已发版老客户端只带邮箱，仍接受。
  email: z.string().trim().email().max(254).optional(),
  phone: phoneSchema.optional(),
  code: smsCodeSchema.optional(),
  password: z.string().min(8).max(256),
  device: deviceSchema,
  // 邀请码（可选）：带了就在建号事务里绑上级（多级分销，坏码不挡注册）。
  ref: z.string().trim().max(16).optional(),
}).superRefine(phoneOrEmail)
// 官网注册：没有设备指纹，按 IP 限制注册数；试用在首次用客户端登录时按硬件发放。
export const webRegisterSchema = z.object({
  username: z.string().trim().min(3).max(32).refine(value=>!/[\s@]/u.test(value),'用户名不能包含空格或 @'),
  email: z.string().trim().email().max(254).optional(),
  phone: phoneSchema.optional(),
  code: smsCodeSchema.optional(),
  password: z.string().min(8).max(256),
  // 邀请码（可选）：带了就在建号事务里绑上级（多级分销，坏码不挡注册）。
  ref: z.string().trim().max(16).optional(),
}).superRefine(phoneOrEmail)
// 用户自助修改密码：需验证原密码。
export const selfPasswordSchema = z.object({
  // POWER云 建的账号没有密码：首次设密码时 currentPassword 可为空。
  currentPassword: z.string().max(256).default(''),
  newPassword: z.string().min(8).max(256),
})
export const refreshSchema = z.object({ refreshToken: z.string().min(40), deviceFingerprint: z.string().min(32).max(128) })
// 已登录但设备名额满时，允许仅使用短期访问令牌在新电脑上腾出一个名额。
// POWER云 账号登录：客户端 OAuth 拿到的面板访问令牌 + 与注册相同的设备字段。
export const powervpnLoginSchema = z.object({ accessToken: z.string().min(16).max(4096), device: deviceSchema })
// 面板 GET /api/client/me 的响应（服务端核实 POWER云 令牌时校验）。
export const powervpnMeSchema = z.object({
  id: z.union([z.string().trim().min(1).max(128), z.number().int()]).transform(String),
  username: z.string().max(256).nullish().transform((v) => v ?? ''),
  email: z.string().trim().max(320).nullish().transform((v) => (v ? v : null)),
  displayName: z.string().max(256).nullish().transform((v) => v ?? ''),
  // 关联的外部站点（面板 2026-09-30 起给；老面板没有 → 空）。含 'aigw' = 中转站客户。
  sources: z.array(z.string().max(32)).max(16).nullish().catch(null).transform((v) => v ?? []),
  // 「AI 代理套餐」最晚到期（面板 2026-09-30 起给）：null = 没有 AI 套餐；老面板不给 = undefined（不同步，保持原样）
  aiPlanExpiresAt: z.string().datetime({ offset: true }).nullable().optional().catch(undefined),
})
// 已登录客户端用 POWER云 令牌同步中转站会员时长（会员跟 AI 套餐走）
export const powervpnSyncSchema = z.object({ accessToken: z.string().min(16).max(4096) })
// 交付：按 POWER云 客户 id 预建关联账号（客户还没打开过客户端时先发会员）。
export const adminPowervpnProvisionSchema = z.object({
  // POWER云 客户 id 是 uuid，/api/client/me 给的是小写；统一成小写，免得预建的号和客户登录时对不上
  externalId: z.string().trim().pipe(z.guid()).transform((v) => v.toLowerCase()),
  email: z.string().trim().email().max(320).nullish().transform((v) => v ?? null),
  channel: z.enum(['', 'aigw']).default('aigw'),
})
export const activateDeviceSchema = z.object({ device: deviceSchema })
export const leaseSchema = z.object({ deviceFingerprint: z.string().min(32).max(128), appVersion: z.string().min(5).max(40) })
export const userCreateSchema = z.object({ username: z.string().trim().min(3).max(64), password: z.string().min(10).max(256), role: z.enum(['user','admin']).default('user'), planId: z.string().uuid().optional(), days: z.number().int().min(1).max(3650).default(30) })
export const userStatusSchema = z.object({ status: z.enum(['active','suspended','banned']) })
// 管理端重置密码：与客户端注册保持一致，密码最低 8 位。
export const userPasswordSchema = z.object({ password: z.string().min(8).max(256) })
export const licenseExtendSchema = z.object({ days: z.number().int().min(1).max(3650) })
// 后台手动发放：绑定一个套餐（决定会员等级/设备数/功能），可覆盖时长或直接永久。
export const adminGrantSchema = z.object({
  planId: z.string().uuid(),
  lifetime: z.boolean().optional(),
  durationDays: z.number().int().min(1).max(36500).nullable().optional(),
}).refine(v=>v.lifetime||v.durationDays==null||v.durationDays>=1,'时长无效')
// 兑换码/授权码：批量生成，绑定套餐 + 可覆盖时长；可选码有效期。
export const redeemCodeCreateSchema = z.object({
  planId: z.string().uuid(),
  lifetime: z.boolean().default(false),
  durationDays: z.number().int().min(1).max(36500).nullable().optional(),
  count: z.number().int().min(1).max(500).default(1),
  // 单个兑换码最多可被多少个不同账号兑换；null / 省略 = 不限次数（仅受有效期约束）。
  maxUses: z.number().int().min(1).max(1000000).nullable().optional(),
  note: z.string().trim().max(200).default(''),
  codeExpiresAt: z.string().datetime().nullable().optional(),
}).superRefine((v,ctx)=>{ if(!v.lifetime&&!v.durationDays)ctx.addIssue({code:'custom',path:['durationDays'],message:'非永久兑换码必须设置时长'}) })
// 客户端兑换：输入一段兑换码。
export const redeemSchema = z.object({ code: z.string().trim().min(4).max(64) })
// 页面浏览埋点上报：访客 UUID 由客户端生成并持久化在 localStorage。
export const trackViewSchema = z.object({
  visitorId: z.string().trim().max(64).optional(),
  path: z.string().trim().max(300).optional(),
  referer: z.string().trim().max(500).optional(),
})
// 下载统计查询窗口（管理后台）。
export const downloadStatsQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})
/** 各平台更新包后缀（客户端 updater.PackageExt）。 */
export const releaseExt = { windows: '.exe', macos: '.zip' } as const
export const releasePlatforms = ['windows','macos'] as const
export type ReleasePlatform = (typeof releasePlatforms)[number]
export const releaseCreateSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/), minimumVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  // 必须与客户端 updater.verifyRelease 一致：https 直链，Windows 以 .exe、macOS 以 .zip 结尾（见下方 refine），
  // 否则签名再正确客户端也会静默判为“更新下载地址无效”，表现为一直收不到更新。
  url: z.string().url().refine((s)=>{try{return new URL(s).protocol==='https:'}catch{return false}},'下载地址必须是 https 直链'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), signature: z.string().min(32),
  mandatory: z.boolean().default(false), title:z.string().trim().max(120).default(''),
  summary:z.string().trim().max(500).default(''), changelog:z.string().trim().max(20000).default(''),
  channel:z.enum(['stable','beta']).default('stable'),
  platform:z.enum(['windows','macos']).default('windows'),
}).refine((v)=>new URL(v.url).pathname.toLowerCase().endsWith(releaseExt[v.platform]),{message:'下载地址后缀不对：Windows 要 .exe，macOS 要 .zip',path:['url']})
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
  if(v.lifetime!==(v.billingCycle==='lifetime'))ctx.addIssue({code:'custom',path:['billingCycle'],message:'永久标记与套餐周期必须一致'})
  if(!v.lifetime&&!v.durationDays)ctx.addIssue({code:'custom',path:['durationDays'],message:'非永久套餐必须设置有效天数'})
})
export const planPatchSchema = planBaseSchema.partial().omit({code:true})
export const orderCreateSchema = z.object({planId:z.string().uuid()})
// Admin refund: the money goes back in the merchant back office; this records
// it and takes back the unused membership time.
export const orderRefundSchema = z.object({reason:z.string().trim().min(2).max(200)})
export const settingPatchSchema = z.object({
  registrationEnabled:z.boolean().optional(),
  trialDays:z.number().int().min(0).max(365).optional(),
  maxAccountsPerDevice:z.number().int().min(0).max(100).optional(),
  maxAccountsPerIp:z.number().int().min(0).max(100).optional(),
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
// ---- Admin console: shared list pagination / filtering + analytics ----
// Query params arrive as strings; coerce numbers and normalise "true"/"false".
const boolParam = z.preprocess(v=>typeof v==='string'?v==='true':v, z.boolean()).optional()
export const paginationSchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.string().trim().max(40).optional(),
  order: z.enum(['asc','desc']).optional(),
})
export const userListQuery = paginationSchema.extend({
  status: z.enum(['active','suspended','banned']).optional(),
  role: z.enum(['user','admin']).optional(),
  tier: z.enum(['trial','standard','premium']).optional(),
  membership: z.enum(['active','expired','expiring']).optional(),
  // 分销筛选：agent = 分销商 / 经销商；referred = 有上级（被推荐来的）
  fenxiao: z.enum(['agent','referred']).optional(),
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
})
export const deviceListQuery = paginationSchema.extend({
  platform: z.string().trim().max(40).optional(),
  revoked: boolParam,
  online: boolParam,
  appVersion: z.string().trim().max(40).optional(),
})
export const orderListQuery = paginationSchema.extend({
  status: z.enum(['pending','paid','closed','refunded','failed']).optional(),
  providerCode: z.string().trim().max(64).optional(),
  tier: z.enum(['trial','standard','premium']).optional(),
  billingCycle: z.enum(['trial','month','quarter','year','lifetime','custom']).optional(),
  paidFrom: z.string().datetime().optional(),
  paidTo: z.string().datetime().optional(),
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
})
export const redeemListQuery = paginationSchema.extend({
  status: z.enum(['active','disabled','used']).optional(),
  batchId: z.string().uuid().optional(),
  planId: z.string().uuid().optional(),
  lifetime: boolParam,
})
export const planListQuery = paginationSchema.extend({
  tier: z.enum(['trial','standard','premium']).optional(),
  active: boolParam,
  public: boolParam,
  billingCycle: z.enum(['trial','month','quarter','year','lifetime','custom']).optional(),
})
export const releaseListQuery = paginationSchema.extend({
  channel: z.enum(['stable','beta']).optional(),
  platform: z.enum(['windows','macos']).optional(),
  mandatory: boolParam,
})
export const auditListQuery = paginationSchema.extend({
  action: z.string().trim().max(80).optional(),
  targetType: z.string().trim().max(80).optional(),
  result: z.string().trim().max(40).optional(),
  actor: z.string().trim().max(80).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})
export const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})
export const redeemCodeStatusSchema = z.object({ status: z.enum(['active','disabled']) })

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type PowervpnLoginInput = z.infer<typeof powervpnLoginSchema>
export type WebRegisterInput = z.infer<typeof webRegisterSchema>
export type SelfPasswordInput = z.infer<typeof selfPasswordSchema>
export type DeviceInput = z.infer<typeof deviceSchema>
export type RefreshInput = z.infer<typeof refreshSchema>
export type ActivateDeviceInput = z.infer<typeof activateDeviceSchema>
export type UserPasswordInput = z.infer<typeof userPasswordSchema>
export type LeaseInput = z.infer<typeof leaseSchema>
export type PlanUpsertInput = z.infer<typeof planUpsertSchema>
export type PlanPatchInput = z.infer<typeof planPatchSchema>
export type ProviderUpsertInput = z.infer<typeof providerUpsertSchema>
export type AdminGrantInput = z.infer<typeof adminGrantSchema>
export type RedeemCodeCreateInput = z.infer<typeof redeemCodeCreateSchema>
export type RedeemInput = z.infer<typeof redeemSchema>
export type PaginationQuery = z.infer<typeof paginationSchema>
export type UserListQuery = z.infer<typeof userListQuery>
export type DeviceListQuery = z.infer<typeof deviceListQuery>
export type OrderListQuery = z.infer<typeof orderListQuery>
export type RedeemListQuery = z.infer<typeof redeemListQuery>
export type PlanListQuery = z.infer<typeof planListQuery>
export type ReleaseListQuery = z.infer<typeof releaseListQuery>
export type AuditListQuery = z.infer<typeof auditListQuery>
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>
export type RedeemCodeStatusInput = z.infer<typeof redeemCodeStatusSchema>
export type TrackViewInput = z.infer<typeof trackViewSchema>
export type DownloadStatsQuery = z.infer<typeof downloadStatsQuery>
export * from './fenxiao.js'
export * from './telemetry.js'
export * from './client-nodes.js'
export * from './phone-sync.js'
