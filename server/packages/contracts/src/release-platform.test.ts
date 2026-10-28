import { describe, expect, it } from 'vitest'
import { deviceSchema, releaseCreateSchema } from './index.js'

const base = { version: '1.10.9', minimumVersion: '1.9.51', sha256: 'a'.repeat(64), signature: 's'.repeat(64) }

describe('macOS 版：设备与发版按平台', () => {
  it('设备平台收 windows / macos，别的不收', () => {
    const d = { fingerprint: 'f'.repeat(64), name: 'Mac', appVersion: '1.10.9' }
    expect(deviceSchema.parse({ ...d, platform: 'macos' }).platform).toBe('macos')
    expect(deviceSchema.safeParse({ ...d, platform: 'linux' }).success).toBe(false)
  })
  it('发版默认 windows，要 .exe；macOS 要 .zip', () => {
    expect(releaseCreateSchema.parse({ ...base, url: 'https://x.cn/download/proxysplit-v1.10.9.exe' }).platform).toBe('windows')
    expect(releaseCreateSchema.safeParse({ ...base, url: 'https://x.cn/a.zip' }).success).toBe(false)
    expect(releaseCreateSchema.parse({ ...base, platform: 'macos', url: 'https://x.cn/download/ProxySplit-v1.10.9-macos-arm64.zip' }).platform).toBe('macos')
    expect(releaseCreateSchema.safeParse({ ...base, platform: 'macos', url: 'https://x.cn/a.exe' }).success).toBe(false)
    expect(releaseCreateSchema.safeParse({ ...base, url: 'http://x.cn/a.exe' }).success).toBe(false)
  })
})
