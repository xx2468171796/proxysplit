import { verify } from '@node-rs/argon2'
import { describe, expect, it } from 'vitest'
import { hashPassword } from './auth.js'

// 生产库里的密码是旧 argon2 包（node-argon2 0.44）生成的；换成 @node-rs/argon2 后必须照样能验过。
const LEGACY = '$argon2id$v=19$m=65536,t=3,p=1$LQb9OCPLPrfynBBAiTBFdg$23gHoV3BfwFC2lmWgcpSFFFIpvhsX0gLTPb/pYv9UXU'

describe('密码哈希兼容', () => {
  it('旧库生成的哈希能验过', async () => {
    expect(await verify(LEGACY, 'legacy-pass-123')).toBe(true)
    expect(await verify(LEGACY, 'wrong')).toBe(false)
  })
  it('新哈希仍是同参数的 argon2id', async () => {
    expect(await hashPassword('x')).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/)
  })
})
