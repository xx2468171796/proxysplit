import { describe, expect, it } from 'vitest'
import { planSplit } from './split.js'

describe('planSplit', () => {
  it('does not split at or below the per-piece cap', () => {
    expect(planSplit(15.9)).toEqual({ kind: 'single' })
    expect(planSplit(143.1)).toEqual({ kind: 'single' })
    expect(planSplit(199.9)).toEqual({ kind: 'single' })
  })
  it('splits ¥299 into 199.9 + 99.1 (two payments)', () => {
    expect(planSplit(299)).toEqual({ kind: 'split', pieces: [199.9, 99.1], absorbed: 0 })
  })
  it('splits ¥233.1 into 199.9 + 33.2', () => {
    expect(planSplit(233.1)).toEqual({ kind: 'split', pieces: [199.9, 33.2], absorbed: 0 })
  })
  it('absorbs a sub-¥1 remainder instead of a tiny extra piece', () => {
    expect(planSplit(200.4)).toEqual({ kind: 'split', pieces: [199.9], absorbed: 0.5 })
  })
  it('flags amounts needing more than the max pieces', () => {
    expect(planSplit(2000)).toEqual({ kind: 'tooLarge' })
  })
})
