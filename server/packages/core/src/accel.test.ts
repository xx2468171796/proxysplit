import { describe, expect, it } from 'vitest'
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { AccelTokens } from './accel.js'

const pem=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}).toString()

describe('AccelTokens',()=>{
  it('issues axt1 tokens the relay can verify with the raw public key',()=>{
    const t=AccelTokens.fromPem(pem)
    const {token,expiresAt}=t.issue('0b1c2d3e-aaaa-bbbb-cccc-000000000001',3600,1_000_000_000_000)
    const [prefix,payload,sig]=token.split('.')
    expect(prefix).toBe('axt1')
    expect(JSON.parse(Buffer.from(payload!,'base64url').toString())).toEqual({sub:'0b1c2d3e-aaaa-bbbb-cccc-000000000001',exp:1_000_003_600})
    expect(expiresAt).toBe(new Date(1_000_003_600_000).toISOString())
    // 中继拿 32 字节原始公钥验签：这里用同一把公钥重建 SPKI 验证
    const raw=Buffer.from(t.publicKeyRaw()!,'base64url')
    expect(raw.length).toBe(32)
    const spki=Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),raw])
    const pub=createPublicKey({key:spki,format:'der',type:'spki'})
    expect(verify(null,Buffer.from(`axt1.${payload}`),pub,Buffer.from(sig!,'base64url'))).toBe(true)
    expect(verify(null,Buffer.from(`axt1.${payload}x`),pub,Buffer.from(sig!,'base64url'))).toBe(false)
  })
  it('refuses to issue without a key or for odd subjects',()=>{
    expect(AccelTokens.fromPem().enabled).toBe(false)
    expect(()=>AccelTokens.fromPem().issue('u1')).toThrow('ACCEL_DISABLED')
    expect(()=>AccelTokens.fromPem(pem).issue('../x')).toThrow('ACCEL_BAD_SUBJECT')
  })
})
