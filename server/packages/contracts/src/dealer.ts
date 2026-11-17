import { z } from 'zod'

// 代理站（AI 中转站代理商子站 <slug>.claude.zygskins.cn）。金额人民币分，比例万分比（3000 = 30%）。
// 不从 index.ts 引分页 schema：index 会 re-export 本文件（同 fenxiao.ts 的说明）。
export const DEALER_SLUG_RE = /^[a-z0-9-]{2,30}$/
export const dealerSlugSchema = z.string().regex(DEALER_SLUG_RE)
/** 客户端登录 / 注册 / 同步带的代理商标识：坏值当没带，绝不挡登录。 */
export const clientDealerField = dealerSlugSchema.optional().catch(undefined)

/** aigw 公开接口 GET /api/public/dealers/<slug> 的回应（裸 JSON） */
export const aigwDealerSchema = z.object({
  slug: z.string(),
  brand: z.string().max(200).default(''),
  contact: z.string().max(200).default(''),
  enabled: z.boolean(),
})

export const dealerListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})
export const dealerPatchSchema = z.object({ commissionBps: z.number().int().min(0).max(10000) })
/** 代理商本人的账号（用户名）：买家与这些账号同设备 / 同注册来源时，分成进待复核。空数组 = 清空。 */
export const dealerOwnersSchema = z.object({ usernames: z.array(z.string().trim().min(1).max(64)).max(10) })
export const dealerCommissionStatus = z.enum(['pending', 'review', 'settled', 'void'])
const instant = z.string().datetime({ offset: true })
export const dealerCommissionsQuery = z.object({
  dealer: dealerSlugSchema.optional(),
  status: dealerCommissionStatus.optional(),
  from: instant.optional(),
  to: instant.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})
export const dealerSettleSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(500),
  note: z.string().trim().max(200).default(''),
})

export type DealerListQuery = z.infer<typeof dealerListQuery>
export type DealerCommissionsQuery = z.infer<typeof dealerCommissionsQuery>
export type DealerSettleInput = z.infer<typeof dealerSettleSchema>
/** 待复核的分成：approve = 复核通过（进待结算），void = 作废。 */
export const dealerReviewSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(500),
  action: z.enum(['approve', 'void']),
  note: z.string().trim().max(200).default(''),
})
export type DealerReviewInput = z.infer<typeof dealerReviewSchema>
export type AigwDealer = z.infer<typeof aigwDealerSchema>
