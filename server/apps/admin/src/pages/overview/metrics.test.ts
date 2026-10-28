import { describe, expect, it } from 'vitest'
import { centsBig, conversionDelta, pctText, ratio, toPoints } from './metrics'
import { yuanToCents } from '@/lib/format'

describe('overview metrics', () => {
  it('returns null instead of 0 for empty denominators', () => {
    expect(ratio(3, 0)).toBeNull()
    expect(pctText(null)).toBeNull()
    expect(pctText(ratio(1, 3))).toBe('33.3')
  })
  it('keeps cents exact beyond 2^53', () => {
    expect(centsBig('9007199254740993')).toBe(9007199254740993n)
    expect(centsBig('x')).toBe(0n)
  })
  it('skips conversion delta for small cohorts and uses points otherwise', () => {
    expect(conversionDelta({ cur: { cohort: 10, converted: 2 }, prev: { cohort: 100, converted: 5 } })).toBeNull()
    const d = conversionDelta({ cur: { cohort: 100, converted: 10 }, prev: { cohort: 100, converted: 5 } })
    expect(d?.text).toMatch(/pp/)
  })
  it('maps Beijing days to midnight timestamps', () => {
    expect(toPoints([{ date: '2026-10-29', value: 1 }])[0]?.[0]).toBe(Date.parse('2026-10-28T16:00:00Z'))
  })
  it('parses yuan without float drift', () => {
    expect(yuanToCents('0.3')).toBe(30)
    expect(yuanToCents('-12.05')).toBe(-1205)
    expect(yuanToCents('1.234')).toBeNull()
  })
})
