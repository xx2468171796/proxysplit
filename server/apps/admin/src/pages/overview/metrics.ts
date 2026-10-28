// 运营总览的接口形状与指标口径（指标字典见 docs/admin-rebuild.md）。纯函数，单测在 metrics.test.ts。
import { computeDelta, formatMinorMoney, type Delta } from '@ankotti/admin-ui'

export type StatsOverview = {
  asOf: string; days: number; timeZone: string
  window: { from: string; to: string; prevFrom: string }
  members: { users: number; paid: number; free: number; newPaid: { cur: number; prev: number } }
  signups: { cur: number; prev: number; daily: { date: string; value: number }[] }
  revenue: { curCents: string; prevCents: string; paidOrders: { cur: number; prev: number }; daily: { date: string; value: string }[] }
  conversion: { cur: { cohort: number; converted: number }; prev: { cohort: number; converted: number } }
  phone: { bound: number; total: number }
  cloud: { profiles: number; shared: number; locked: number; profileUsers: number; syncUsers: number }
  sms: { sent24h: number; prev24h: number; verified24h: number; byPurpose: { purpose: string; count: number }[] }
  online: { devices15m: number }
}
export type Dashboard = { users: number; licenses: number; online: number; expiring: number; pendingOrders: number; monthRevenue: number }

/** 转化率样本门槛：批次少于 30 人不判断好坏（DASHBOARDS §2.12：小样本灰显、不告警）。 */
export const MIN_COHORT = 30

/** 比率：分母为 0 返回 null（显示「—」，不是 0%）。 */
export const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null)

/** 百分比文本，一位小数；null → null。 */
export const pctText = (r: number | null): string | null => (r === null ? null : `${(r * 100).toFixed(1)}`)

/** 分（十进制字符串）→ bigint；只在算变化值时转成 number（精度损失只影响百分比第几位）。 */
export const centsBig = (s: string): bigint => (/^-?\d+$/.test(s) ? BigInt(s) : 0n)
export const yuanText = (s: string) => formatMinorMoney(centsBig(s), { symbol: '¥' })

export function countDelta(cur: number, prev: number, better: 'up' | 'down' = 'up'): Delta | null {
  return computeDelta(cur, prev, { better })
}

/** 转化率变化用百分点 pp；任何一期样本不足都不给变化值。 */
export function conversionDelta(c: StatsOverview['conversion']): Delta | null {
  const cur = ratio(c.cur.converted, c.cur.cohort), prev = ratio(c.prev.converted, c.prev.cohort)
  if (cur === null || prev === null || c.cur.cohort < MIN_COHORT || c.prev.cohort < MIN_COHORT) return null
  return computeDelta(cur * 100, prev * 100, { better: 'up', mode: 'points' })
}

export function moneyDelta(curCents: string, prevCents: string): Delta | null {
  return computeDelta(Number(centsBig(curCents)), Number(centsBig(prevCents)), { better: 'up' })
}

/** 日序列 → 图表点（北京日 00:00 的时间戳）。 */
export const toPoints = (rows: readonly { date: string; value: number | null }[]): [number, number | null][] =>
  rows.map((r) => [new Date(`${r.date}T00:00:00+08:00`).getTime(), r.value])

export const comparisonLabel = (days: number) => `比前 ${days} 天`
