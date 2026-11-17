// 代理商分成后台共用：类型（对应 /v1/admin/dealers*）与小工具。金额是分，比例是万分比（3000 = 30%）。
import type { Tone } from '@/lib/format'

export type Dealer = {
  slug: string; brand: string; contact: string; enabled: boolean; commissionBps: number; fetchedAt: string | null
  customers: number; grossCents: number; pendingCents: number; settledCents: number
}
export type DealerCommission = {
  id: number; dealerSlug: string; userId: string; username: string; source: string; grossCents: number; bps: number
  commissionCents: number; status: 'pending' | 'settled' | 'void'; createdAt: string; settledAt: string | null; note: string
}

export const DEALER_COMMISSION_STATUS: Record<string, Tone> = {
  pending: { label: '待结算', tone: 'warning' },
  settled: { label: '已结算', tone: 'success' },
  void: { label: '已作废', tone: 'neutral' },
}
export const toneOf = (map: Record<string, Tone>, key: string): Tone => map[key] ?? { label: key, tone: 'neutral' }
/** 万分比 → 「30%」「2.5%」 */
export const pct = (bps: number) => `${Number((bps / 100).toFixed(2))}%`
/** 「30」「2.5」（百分数）→ 万分比；非法 / 超出 0–100 返回 null */
export function parsePct(text: string): number | null {
  const t = text.trim()
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null
  const v = Math.round(Number(t) * 100)
  return v >= 0 && v <= 10000 ? v : null
}
