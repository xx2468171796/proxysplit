import { describe, expect, it } from 'vitest'
import { adminPowervpnProvisionSchema } from './index.js'

// Zod 4 的 uuid() 只认 RFC 9562（版本位 1–8、变体位 89ab）；POWER云 客户 id 只保证 8-4-4-4-12 十六进制，用 guid 保持 Zod 3 的宽松。
describe('Zod 4 升级兼容', () => {
  it('POWER云 客户 id 不按 RFC 版本位卡', () => {
    const r = adminPowervpnProvisionSchema.parse({ externalId: 'ABCDEF12-3456-7890-ABCD-EF1234567890' })
    expect(r.externalId).toBe('abcdef12-3456-7890-abcd-ef1234567890')
  })
})
