// 发布签名校验（服务端登记版本时用）。客户端拿到 /v1/releases/latest 后用内置公钥验同一条消息
//（仓库根 internal/updater/client.go 的 SigningMessage / verifyRelease），验不过就静默不更新。
// 所以登记时先按客户端同样的规则验一遍：客户端会拒的记录不进 releases 表。
import { createPublicKey, verify } from 'node:crypto'

/**
 * 发布验签公钥 = 客户端打包时内置的那把（仓库 build/release-kit/release-public.pem；生产镜像只带 server/，所以抄在这里，
 * release-signature.test.ts 逐字节对照那份文件）。换钥：先发带新公钥的客户端，再把两把都配进 RELEASE_PUBLIC_KEY_PEM（任意一把验过即可），
 * 等老客户端淘汰后改这里。
 */
export const RELEASE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAEGm8ZMvVgc/S4mJaXYZe2BIScbnNPIS8SgmkWE8u/pI=
-----END PUBLIC KEY-----
`

/** 与客户端 updater.SigningMessage 逐字节相同；改格式必须同时换域分隔串。 */
export const releaseSigningMessage = (version: string, sha256Hex: string, url: string) =>
  `ProxySplit-Release-Signature-v1\nversion=${version}\nsha256=${sha256Hex.toLowerCase()}\nurl=${url}\n`

const ED25519_SIGNATURE_BYTES = 64
const PEM_BLOCK = /-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/g

/** 客户端的解码顺序：先标准 base64，不行再 base64url；长度必须正好 64 字节。 */
function decodeSignature(signature: string): Buffer | null {
  for (const encoding of ['base64', 'base64url'] as const) {
    const raw = Buffer.from(signature, encoding)
    // Buffer.from 对非法字符是「跳过」而不是报错：编码回去对得上才算这种编码
    if (raw.length === ED25519_SIGNATURE_BYTES && raw.toString(encoding).replace(/=+$/, '') === signature.replace(/=+$/, '')) return raw
  }
  return null
}

/** keysPem 里可以放多把公钥（多个 PEM 块），任意一把验过即通过；一把都解析不出来 = 不通过。 */
export function verifyReleaseSignature(r: { version: string; sha256: string; url: string; signature: string }, keysPem: string = RELEASE_PUBLIC_KEY_PEM): boolean {
  const signature = decodeSignature(r.signature.trim())
  if (!signature) return false
  const message = Buffer.from(releaseSigningMessage(r.version, r.sha256, r.url))
  // env 文件里放不了换行：把字面的反斜杠 + n 也当换行
  return (keysPem.replaceAll('\\n', '\n').match(PEM_BLOCK) ?? []).some(pem => {
    try { return verify(null, message, createPublicKey(pem), signature) } catch { return false }
  })
}
