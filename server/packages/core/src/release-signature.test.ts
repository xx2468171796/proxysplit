// 登记版本前验发布签名：消息格式必须与客户端 internal/updater.SigningMessage 逐字节一致，
// 否则「服务端收下、客户端全部拒绝」——表现为所有人一直收不到更新，而后台看着一切正常。
import { existsSync, readFileSync } from 'node:fs'
import { generateKeyPairSync, sign } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { RELEASE_PUBLIC_KEY_PEM, releaseSigningMessage, verifyReleaseSignature } from './release-signature.js'
import { PgStore } from './store.js'

const pair = generateKeyPairSync('ed25519')
const pem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const release = { version: '1.12.6', sha256: 'ab'.repeat(32), url: 'https://proxysplit.zygskins.cn/download/proxysplit-v1.12.6.exe' }
const signed = (r = release, encoding: 'base64' | 'base64url' = 'base64') =>
  sign(null, Buffer.from(releaseSigningMessage(r.version, r.sha256, r.url)), pair.privateKey).toString(encoding)

describe('发布签名', () => {
  it('签名消息与客户端 updater.SigningMessage 相同（域分隔 + 三行，sha256 小写，结尾换行）', () => {
    expect(releaseSigningMessage('1.2.3', 'AB'.repeat(32), 'https://x.test/a.exe'))
      .toBe(`ProxySplit-Release-Signature-v1\nversion=1.2.3\nsha256=${'ab'.repeat(32)}\nurl=https://x.test/a.exe\n`)
  })

  it('对的签名通过（标准 base64 与 base64url 都认，和客户端一样）；版本 / 哈希 / 地址任何一个不同都不通过', () => {
    expect(verifyReleaseSignature({ ...release, signature: signed() }, pem)).toBe(true)
    expect(verifyReleaseSignature({ ...release, signature: signed(release, 'base64url') }, pem)).toBe(true)
    for (const changed of [{ version: '1.12.7' }, { sha256: 'cd'.repeat(32) }, { url: release.url.replace('.exe', '-x.exe') }]) {
      expect(verifyReleaseSignature({ ...release, ...changed, signature: signed() }, pem), JSON.stringify(changed)).toBe(false)
    }
  })

  it('别的密钥签的、长度不对的、不是 base64 的都不通过；多把公钥时任意一把验过即可（换钥过渡期）', () => {
    const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()
    expect(verifyReleaseSignature({ ...release, signature: signed() }, other)).toBe(false)
    expect(verifyReleaseSignature({ ...release, signature: Buffer.alloc(63).toString('base64') }, pem)).toBe(false)
    expect(verifyReleaseSignature({ ...release, signature: '这不是签名这不是签名这不是签名这不是签名这不是签名这不是签名' }, pem)).toBe(false)
    expect(verifyReleaseSignature({ ...release, signature: signed() }, `${other}\n${pem}`)).toBe(true)
    expect(verifyReleaseSignature({ ...release, signature: signed() }, '')).toBe(false)
  })

  it('内置公钥就是仓库里客户端打包用的那把（build/release-kit/release-public.pem）', () => {
    const file = fileURLToPath(new URL('../../../../build/release-kit/release-public.pem', import.meta.url))
    // 只在完整仓库里比（生产镜像只带 server/，那里不跑测试）
    expect(existsSync(file)).toBe(true)
    expect(RELEASE_PUBLIC_KEY_PEM.replace(/\s/g, '')).toBe(readFileSync(file, 'utf8').replace(/\s/g, ''))
  })

  it('createRelease：签名不对在写库之前就拒，客户端会拒的记录进不了 releases 表', async () => {
    const sql: string[] = []
    const store = Object.create(PgStore.prototype) as PgStore
    Object.assign(store, { pool: { query: async (text: string) => { sql.push(text); return { rows: [{ id: 'r1', version: release.version, platform: 'windows' }], rowCount: 1 } } } })
    const row = { ...release, minimumVersion: '1.9.51', mandatory: true, title: '', summary: '', changelog: '', channel: 'stable' }
    await expect(store.createRelease({ ...row, signature: signed({ ...release, version: '1.12.5' }) }, pem)).rejects.toMatchObject({ code: 'RELEASE_SIGNATURE_INVALID', status: 400 })
    expect(sql).toEqual([])
    await expect(store.createRelease({ ...row, signature: signed() }, pem)).resolves.toMatchObject({ id: 'r1' })
    expect(sql).toHaveLength(1)
  })
})
