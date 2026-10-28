// 多级分销后台共用：类型（对应 /v1/admin/fenxiao/* 返回）与小工具。金额是分，比例是万分比。
import type { Tone } from '@/lib/format'

export type Tier = { code: string; name: string; rates: number[] }
export type PlanRule = { planId: string; excluded: boolean; multiplierBps: number }
export type Policy = {
  enabled: boolean
  mode: 'level' | 'differential'
  maxLevels: number
  openToAll: boolean
  defaultRates: number[]
  tiers: Tier[]
  totalCapBps: number
  freezeDays: number
  minBaseCents: number
  minWithdrawalCents: number
  holdAboveCents: number
  planRules: PlanRule[]
  recurringMaxOrders: number
  recurringWithinDays: number
  withdrawalFeeBps: number
  withdrawalFeeFixedCents: number
}
export type Overview = {
  boundMembers: number; agents: number; pendingWithdrawals: number; heldCommissions: number; heldCents: number
  periodCount: number; frozenCents: number; availableCents: number; withdrawingCents: number; withdrawnCents: number
  reversedCents: number; periodCommissionCents: number
}
export type Account = {
  frozenCents: number; heldCents: number; availableCents: number; withdrawingCents: number
  withdrawnCents: number; earnedCents: number; reversedCents: number
}
export type Member = {
  userId: string; username: string; parentUserId: string | null; parentUsername: string | null
  code: string | null; tierCode: string | null; tierName: string | null; enabled: boolean
  rateOverride: number[] | null; note: string | null; boundAt: string | null
  directCount: number; teamCount: number; account: Account
}
export type Commission = {
  id: string; sourceKind: string; sourceRef: string; orderNo: string | null; planName: string | null
  buyer: string; beneficiary: string; level: number; baseCents: number; rateBps: number; amountCents: number
  status: 'frozen' | 'available' | 'held' | 'reversed'; availableAt: string
  holdReason: string | null; note: string | null; reverseReason: string | null; createdAt: string
}
export type Withdrawal = {
  id: string; username: string; amountCents: number; feeCents: number; netCents: number
  status: 'pending' | 'paid' | 'rejected'; payee: { method: string; account: string; name: string }
  adminNote: string | null; createdAt: string; reviewedAt: string | null
}

export const LEVEL_NAMES = ['一级', '二级', '三级', '四级', '五级', '六级', '七级', '八级', '九级', '十级']
/** 万分比 → 「20%」「2.5%」 */
export const pct = (bps: number) => `${Number((bps / 100).toFixed(2))}%`
/** 逐级比例 → 「一级 20% · 二级 5%」 */
export const ratesText = (rates: number[] | null | undefined, mode: Policy['mode'] = 'level') => {
  if (!rates?.length) return '—'
  if (mode === 'differential') return `总比例 ${pct(rates[0] ?? 0)}`
  return rates.map((r, i) => `${LEVEL_NAMES[i] ?? `${i + 1}级`} ${pct(r)}`).join(' · ')
}
/** 「20, 5」→ [2000, 500]；最多 10 项、每项 0–100%，非法返回 null。 */
export function parseRates(text: string): number[] | null {
  const parts = text.split(/[,，\s]+/).filter(Boolean)
  if (parts.length > 10) return null
  const out = parts.map((p) => Math.round(Number(p) * 100))
  return out.every((v) => Number.isInteger(v) && v >= 0 && v <= 10000) ? out : null
}
export const ratesInput = (rates: number[] | null | undefined) => (rates ?? []).map((r) => r / 100).join(', ')

export const METHOD: Record<string, string> = { alipay: '支付宝', wechat: '微信', bank: '银行卡' }

export const COMMISSION_STATUS: Record<string, Tone> = {
  frozen: { label: '冻结中', tone: 'warning' },
  available: { label: '已到账', tone: 'success' },
  held: { label: '待复核', tone: 'danger' },
  reversed: { label: '已冲回', tone: 'neutral' },
}
export const WITHDRAWAL_STATUS: Record<string, Tone> = {
  pending: { label: '待审核', tone: 'warning' },
  paid: { label: '已打款', tone: 'success' },
  rejected: { label: '已驳回', tone: 'danger' },
}
export const toneOf = (map: Record<string, Tone>, key: string): Tone => map[key] ?? { label: key, tone: 'neutral' }
