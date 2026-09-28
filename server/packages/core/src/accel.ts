import { createPrivateKey, createPublicKey, sign, type KeyObject } from 'node:crypto'

// Claude Code 加速令牌：客户端内置编码端拿它去落地机中继（sub2api 仓 accel/，0.5+）鉴权。
// 格式 axt1.<base64url(载荷)>.<base64url(Ed25519 签名)>，签名覆盖 "axt1.<载荷段>"；载荷 {"sub":用户ID,"exp":unix秒}。
// 中继只持有公钥离线验签；与会员租约用不同的密钥（ACCEL_TOKEN_PRIVATE_KEY_PEM），一把泄露不影响另一把。
const PREFIX='axt1.'
const b64url=(b:Buffer)=>b.toString('base64url')

export class AccelTokens{
  private constructor(private key:KeyObject|null){}
  static fromPem(pem?:string){return new AccelTokens(pem?createPrivateKey(pem):null)}
  get enabled(){return this.key!==null}
  // 中继配置 ACCEL_USER_KEYS 要的公钥（32 字节 base64url）
  publicKeyRaw(){
    if(!this.key)return null
    const der=createPublicKey(this.key as unknown as Parameters<typeof createPublicKey>[0]).export({type:'spki',format:'der'})
    return b64url(der.subarray(der.length-32))
  }
  issue(userId:string,ttlSeconds=24*3600,now=Date.now()){
    if(!this.key)throw new Error('ACCEL_DISABLED')
    if(!/^[A-Za-z0-9_-]{1,64}$/.test(userId))throw new Error('ACCEL_BAD_SUBJECT')
    const exp=Math.floor(now/1000)+ttlSeconds
    const signed=PREFIX+b64url(Buffer.from(JSON.stringify({sub:userId,exp})))
    const token=signed+'.'+b64url(sign(null,Buffer.from(signed),this.key))
    return {token,expiresAt:new Date(exp*1000).toISOString()}
  }
}
