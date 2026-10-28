// 业务词表与格式化：金额统一按「分」转 bigint 交给 admin-ui（MoneyDisplay / formatMinorMoney），不经过浮点。
import { formatMinorMoney, type StatusTone } from '@ankotti/admin-ui'

/** 接口给的分（number / 整数字符串）→ bigint；null / 非法 → null（显示「—」）。 */
export function minor(v: number | string | bigint | null | undefined): bigint | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') return Number.isFinite(v) ? BigInt(Math.trunc(v)) : null
  return /^-?\d+$/.test(v.trim()) ? BigInt(v.trim()) : null
}

/** ¥12.34 这类文本（提示、确认框里用；表格里用 MoneyDisplay）。 */
export const money = (cents: number | string | bigint | null | undefined, currency = 'CNY') =>
  formatMinorMoney(minor(cents), { symbol: currency === 'CNY' ? '¥' : `${currency} ` })

/** 元（表单输入）→ 分，按字符串处理避免 0.1+0.2；不合法返回 null。 */
export function yuanToCents(text: string): number | null {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim())
  if (!m) return null
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'))
  return m[1] === '-' ? -cents : cents
}
export const centsToYuan = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? '' : (cents / 100).toFixed(2).replace(/\.00$/, '')

export type Tone = { label: string; tone: StatusTone }
const pick = (map: Record<string, Tone>, key: string | null | undefined): Tone =>
  (key && map[key]) || { label: key || '—', tone: 'neutral' }

export const TIER: Record<string, Tone> = {
  premium: { label: '超级会员', tone: 'brand' },
  standard: { label: '普通会员', tone: 'success' },
  trial: { label: '试用', tone: 'info' },
  free: { label: '免费', tone: 'neutral' },
}
export const tier = (t: string | null | undefined) => pick(TIER, t)

export const USER_STATUS: Record<string, Tone> = {
  active: { label: '正常', tone: 'success' },
  suspended: { label: '已暂停', tone: 'warning' },
  banned: { label: '已封禁', tone: 'danger' },
}
export const userStatus = (s: string | null | undefined) => pick(USER_STATUS, s)

export const ORDER_STATUS: Record<string, Tone> = {
  pending: { label: '待支付', tone: 'warning' },
  paid: { label: '已支付', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  closed: { label: '已关闭', tone: 'neutral' },
  refunded: { label: '已退款', tone: 'info' },
}
export const orderStatus = (s: string | null | undefined) => pick(ORDER_STATUS, s)

export const LICENSE_STATUS: Record<string, Tone> = {
  active: { label: '生效中', tone: 'success' },
  paused: { label: '已暂停', tone: 'warning' },
  revoked: { label: '已撤销', tone: 'danger' },
  expired: { label: '已过期', tone: 'neutral' },
}
export const licenseStatus = (s: string | null | undefined) => pick(LICENSE_STATUS, s)

export const CYCLE: Record<string, string> = {
  trial: '试用', month: '月付', quarter: '季付', year: '年付', lifetime: '永久', custom: '自定义',
}
export const cycle = (c: string | null | undefined) => (c && CYCLE[c]) || c || '—'

export const PLATFORM: Record<string, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android', ios: 'iOS' }
export const platform = (p: string | null | undefined) => (p && PLATFORM[p]) || p || '—'

/** 选项列表（筛选下拉用）。 */
export const options = (map: Record<string, Tone | string>) =>
  Object.entries(map).map(([value, v]) => ({ value, label: typeof v === 'string' ? v : v.label }))

/** 设备在线判断：15 分钟内活跃算在线（与服务端 dashboard 口径一致）。 */
export const ONLINE_MS = 15 * 60_000
export const isOnline = (lastSeen: string | null | undefined, now = Date.now()) =>
  !!lastSeen && now - new Date(lastSeen).getTime() < ONLINE_MS

/** 手机号再保险打码：服务端已打码（138****1234）；万一给了 11 位明文也只露前 3 后 4。 */
export function maskPhone(p: string | null | undefined): string | null {
  if (!p) return null
  return /^\d{11}$/.test(p) ? `${p.slice(0, 3)}****${p.slice(7)}` : p
}

export const bytes = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
