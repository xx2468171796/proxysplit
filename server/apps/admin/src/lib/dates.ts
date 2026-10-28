// 日期范围（YYYY-MM-DD，北京日）→ 接口用的 ISO 起止（含当天整天）。
import type { DateRangeValue } from '@ankotti/admin-ui'

export const EMPTY_RANGE: DateRangeValue = { from: '', to: '' }

export function rangeParams(r: DateRangeValue, fromKey: string, toKey: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (r.from) out[fromKey] = new Date(`${r.from}T00:00:00+08:00`).toISOString()
  if (r.to) out[toKey] = new Date(`${r.to}T23:59:59.999+08:00`).toISOString()
  return out
}

/** datetime-local 风格 YYYY-MM-DDTHH:mm（北京时间）→ ISO；空串 → null。 */
export const localToIso = (v: string): string | null => (v ? new Date(`${v}:00+08:00`).toISOString() : null)

/** ISO → YYYY-MM-DDTHH:mm（北京时间），给 DateTimePicker 回填。 */
export function isoToLocal(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(new Date(iso).getTime() + 8 * 3_600_000)
  return d.toISOString().slice(0, 16)
}
