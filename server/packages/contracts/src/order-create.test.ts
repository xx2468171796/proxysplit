// 下单入参：hvToken 可选（老客户端不带），带了就得是合理长度的字符串。
import { describe, expect, it } from 'vitest'
import { orderCreateSchema } from './index.js'

const planId = '44444444-4444-4444-8444-444444444444'

describe('orderCreateSchema', () => {
  it('老客户端只带 planId 仍然合法', () => {
    expect(orderCreateSchema.parse({ planId })).toEqual({ planId })
  })
  it('带上人机验证凭证', () => {
    expect(orderCreateSchema.parse({ planId, hvToken: ' tok ' })).toEqual({ planId, hvToken: 'tok' })
  })
  it('空串 / 超长凭证拒绝', () => {
    expect(orderCreateSchema.safeParse({ planId, hvToken: '' }).success).toBe(false)
    expect(orderCreateSchema.safeParse({ planId, hvToken: 'x'.repeat(513) }).success).toBe(false)
  })
})
