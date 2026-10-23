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

/** 后台「分销规则」。存 system_settings.fenxiao_policy；缺省 = 关。 */
export const fenxiaoPolicySchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['level', 'differential']),
  maxLevels: z.number().int().min(1).max(10),
  openToAll: z.boolean(),
  defaultRates: rates,
  tiers: z.array(fenxiaoTierSchema).max(20),
  totalCapBps: bps,
  freezeDays: z.number().int().min(0).max(365),
  minBaseCents: cents,
  minWithdrawalCents: cents.min(1),
}).superRefine((p, ctx) => {
  const codes = p.tiers.map(t => t.code)
  if (new Set(codes).size !== codes.length) ctx.addIssue({ code: 'custom', message: '等级代码重复', path: ['tiers'] })
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
  status: z.enum(['frozen', 'available', 'reversed']).optional(),
  beneficiaryUserId: z.string().uuid().optional(),
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
export type FenxiaoMemberPatch = z.infer<typeof fenxiaoMemberPatchSchema>
export type FenxiaoMembersQuery = z.infer<typeof fenxiaoMembersQuery>
export type FenxiaoCommissionsQuery = z.infer<typeof fenxiaoCommissionsQuery>
export type FenxiaoWithdrawalsQuery = z.infer<typeof fenxiaoWithdrawalsQuery>
