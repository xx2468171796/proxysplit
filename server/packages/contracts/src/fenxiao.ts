import { z } from 'zod'

// 多级分销（公司 SDK tuiguang/fenxiao）。金额一律人民币分（整数），比例一律万分比（500 = 5%）。
// 不从 index.ts 引分页 schema：index 会 re-export 本文件，互相 import 会在求值时撞上未初始化。
const paginationSchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})
const bps = z.number().int().min(0).max(10000)
const rates = z.array(bps).max(10)
const cents = z.number().int().min(0).max(1_000_000_00)

export const fenxiaoTierSchema = z.object({
  code: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/, '等级代码只能是小写字母数字与 - _'),
  name: z.string().trim().min(1).max(20),
  rates,
})

/** 按套餐的规则：planId = plans.id；excluded = 这个套餐不返佣；multiplierBps = 在正常比例上再乘（5000 = 减半） */
export const fenxiaoPlanRuleSchema = z.object({
  planId: z.string().uuid(),
  excluded: z.boolean().default(false),
  multiplierBps: z.number().int().min(0).max(30000).default(10000),
})

/** 后台「分销规则」。存 system_settings.fenxiao_policy；缺省 = 关。v1.9.94 起的新字段都有默认值，老配置照样能读。 */
export const fenxiaoPolicySchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['level', 'differential']),
  // 合规：最多 3 级（公司分销包默认上限，国内「三级以上」有传销风险）
  maxLevels: z.number().int().min(1).max(3),
  openToAll: z.boolean(),
  defaultRates: rates,
  tiers: z.array(fenxiaoTierSchema).max(20),
  totalCapBps: bps,
  freezeDays: z.number().int().min(0).max(365),
  minBaseCents: cents,
  minWithdrawalCents: cents.min(1),
  /** 实付超过这个金额的单，佣金先挂起待后台复核；0 = 不挂 */
  holdAboveCents: cents.default(0),
  planRules: z.array(fenxiaoPlanRuleSchema).max(100).default([]),
  /** 每个买家最多给上级返几单（0 = 不限）；绑定后多少天内的付款才返（0 = 不限） */
  recurringMaxOrders: z.number().int().min(0).max(100000).default(0),
  recurringWithinDays: z.number().int().min(0).max(36500).default(0),
  /** 提现手续费：比例（万分比）+ 固定额（分），从提现金额里扣 */
  withdrawalFeeBps: bps.default(0),
  withdrawalFeeFixedCents: cents.default(0),
}).superRefine((p, ctx) => {
  const codes = p.tiers.map(t => t.code)
  if (new Set(codes).size !== codes.length) ctx.addIssue({ code: 'custom', message: '等级代码重复', path: ['tiers'] })
  const plans = p.planRules.map(r => r.planId)
  if (new Set(plans).size !== plans.length) ctx.addIssue({ code: 'custom', message: '同一个套餐设了两条规则', path: ['planRules'] })
})

/** 后台设分销商 / 经销商：按用户名找人。tierCode=null 取消等级。 */
export const fenxiaoMemberPatchSchema = z.object({
  tierCode: z.string().trim().max(32).nullable().optional(),
  enabled: z.boolean().optional(),
  rateOverride: rates.nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
  code: z.string().trim().regex(/^[A-Za-z0-9]{4,16}$/, '邀请码只能是 4~16 位字母数字').optional(),
})
export const fenxiaoGrantSchema = fenxiaoMemberPatchSchema.extend({ username: z.string().trim().min(1).max(64) })
/** 改挂上级：parentUsername=null 摘成顶层。 */
export const fenxiaoMoveSchema = z.object({ parentUsername: z.string().trim().min(1).max(64).nullable() })

export const fenxiaoMembersQuery = paginationSchema.extend({
  agentsOnly: z.enum(['1', '0']).optional(),
  tierCode: z.string().trim().max(32).optional(),
  parentUserId: z.string().uuid().optional(),
})
export const fenxiaoCommissionsQuery = paginationSchema.extend({
  status: z.enum(['frozen', 'available', 'held', 'reversed']).optional(),
  beneficiaryUserId: z.string().uuid().optional(),
})
/** 复核挂起的佣金：approve 放行 / void 作废（必须写原因） */
export const fenxiaoCommissionReviewSchema = z.object({
  action: z.enum(['approve', 'void']),
  note: z.string().trim().max(200).optional(),
})
/** 手工调账：正数补发、负数扣减，直接进可提现；原因推广人能看到 */
export const fenxiaoAdjustSchema = z.object({
  username: z.string().trim().min(1).max(64),
  amountCents: z.number().int().min(-1_000_000_00).max(1_000_000_00).refine(v => v !== 0, '金额不能为 0'),
  reason: z.string().trim().min(1).max(200),
})
export const fenxiaoWithdrawalsQuery = paginationSchema.extend({
  status: z.enum(['pending', 'paid', 'rejected']).optional(),
})
export const fenxiaoReviewSchema = z.object({
  action: z.enum(['paid', 'rejected']),
  note: z.string().trim().max(200).optional(),
})

// 推广人自己
export const fenxiaoTeamQuery = z.object({
  level: z.coerce.number().int().min(1).max(20).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})
export const fenxiaoWithdrawSchema = z.object({
  amountCents: z.number().int().min(1).max(1_000_000_00),
  method: z.enum(['alipay', 'wechat', 'bank']),
  account: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(50),
})

export type FenxiaoPolicyInput = z.infer<typeof fenxiaoPolicySchema>
/** 后台提交的规则（新字段可省，按默认补） */
export type FenxiaoPolicyBody = z.input<typeof fenxiaoPolicySchema>
export type FenxiaoMemberPatch = z.infer<typeof fenxiaoMemberPatchSchema>
export type FenxiaoMembersQuery = z.infer<typeof fenxiaoMembersQuery>
export type FenxiaoCommissionsQuery = z.infer<typeof fenxiaoCommissionsQuery>
export type FenxiaoWithdrawalsQuery = z.infer<typeof fenxiaoWithdrawalsQuery>
