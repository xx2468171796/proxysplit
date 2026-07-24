import { createHash, createPublicKey, randomUUID } from 'node:crypto'
import { argon2id, hash, verify } from 'argon2'
import { exportSPKI, generateKeyPair, importPKCS8, jwtVerify, SignJWT } from 'jose'
import { AppError, normalizeUsername } from '@proxysplit/shared'
import type { ActivateDeviceInput, DeviceInput, LoginInput, RefreshInput, RegisterInput } from '@proxysplit/contracts'
import type { PgStore, UserRecord } from './store.js'

const encoder=new TextEncoder()
const sha256=(value:string)=>createHash('sha256').update(value).digest('hex')
export const hashFingerprint=(value:string)=>sha256('proxysplit-device-v1:'+value)
export const hashPassword=(value:string)=>hash(value,{type:argon2id,memoryCost:65536,timeCost:3,parallelism:1})

export type AuthConfig={accessSecret:string;refreshDays:number;licensePrivateKeyPem?:string;licensePublicKeyPem?:string}
export class AuthService{
  private constructor(private store:PgStore,private cfg:AuthConfig,private privateKey:CryptoKey,readonly publicKeyPem:string){}
  static async create(store:PgStore,cfg:AuthConfig){
    let privateKey:CryptoKey, publicKeyPem=cfg.licensePublicKeyPem
    if(cfg.licensePrivateKeyPem){
      privateKey=await importPKCS8(cfg.licensePrivateKeyPem,'EdDSA')
      const derived=createPublicKey(cfg.licensePrivateKeyPem).export({type:'spki',format:'pem'}).toString()
      if(publicKeyPem&&publicKeyPem.replace(/\s/g,'')!==derived.replace(/\s/g,''))throw new Error('LICENSE_PUBLIC_KEY_PEM does not match the private key')
      publicKeyPem=derived
    }
    else {const pair=await generateKeyPair('EdDSA');privateKey=pair.privateKey;publicKeyPem=await exportSPKI(pair.publicKey)}
    return new AuthService(store,cfg,privateKey,publicKeyPem!)
  }
  private async access(user:UserRecord,deviceId:string){return new SignJWT({role:user.role,did:deviceId,typ:'access'}).setProtectedHeader({alg:'HS256'}).setSubject(user.id).setIssuedAt().setExpirationTime('15m').sign(encoder.encode(this.cfg.accessSecret))}
  private async refresh(userId:string,deviceId:string,familyId:string,jti:string){return new SignJWT({did:deviceId,fam:familyId,typ:'refresh'}).setProtectedHeader({alg:'HS256'}).setSubject(userId).setJti(jti).setIssuedAt().setExpirationTime(`${this.cfg.refreshDays}d`).sign(encoder.encode(this.cfg.accessSecret))}
  private async issue(user:UserRecord,deviceId:string,familyId:string=randomUUID()){
    const jti=randomUUID(), refreshToken=await this.refresh(user.id,deviceId,familyId,jti), expiresAt=new Date(Date.now()+this.cfg.refreshDays*86400000)
    await this.store.createSession({userId:user.id,deviceId,familyId,jti,tokenHash:sha256(refreshToken),expiresAt})
    return {accessToken:await this.access(user,deviceId),refreshToken,expiresIn:900,deviceId,user:{id:user.id,username:user.username,role:user.role}}
  }
  private license(ent:Awaited<ReturnType<PgStore['entitlement']>>|null,user:UserRecord){
    const value=ent??(user.role==='admin'?{licenseId:'admin',planId:'admin',planCode:'admin',planName:'Administrator',tier:'premium' as const,maxDevices:10,features:['admin'],expiresAt:new Date('2999-12-31'),lifetime:true,status:'active'}:null)
    return value?{plan:value.planName,planCode:value.planCode,tier:value.tier,expiresAt:value.expiresAt,features:value.features,maxDevices:value.maxDevices,lifetime:value.lifetime}:null
  }
  async register(input:RegisterInput,ip=''){
    const passwordHash=await hashPassword(input.password)
    try{
      await this.store.registerTrialUser({
        username:normalizeUsername(input.username),email:input.email.trim().toLowerCase(),passwordHash,
        hardwareHash:hashFingerprint(input.device.hardwareHash??input.device.fingerprint),ip,
      })
    }catch(error){
      const code=(error as {code?:string}).code
      const message=(error as Error).message
      if(code==='23505')throw new AppError('IDENTITY_TAKEN','用户名或邮箱已被使用',409)
      if(message==='REGISTRATION_DISABLED')throw new AppError('REGISTRATION_DISABLED','当前暂停开放注册',403)
      if(message==='TRIAL_PLAN_NOT_FOUND')throw new AppError('TRIAL_UNAVAILABLE','试用套餐暂不可用',503)
      throw error
    }
    return this.login(input,ip)
  }
  async login(input:LoginInput,ip=''){
    const user=await this.store.findUser(normalizeUsername(input.username))
    const lockedUntil=user?.lockedUntil?new Date(user.lockedUntil):null
    if(user&&lockedUntil&&lockedUntil.getTime()>Date.now()){
      const remainingMinutes=Math.max(1,Math.ceil((lockedUntil.getTime()-Date.now())/60000))
      await this.store.audit(user.id,'auth.login','user',user.id,ip,'locked',{remainingMinutes,lockoutLevel:user.lockoutLevel})
      throw new AppError('AUTH_LOCKED',`登录已锁定，请 ${remainingMinutes} 分钟后再试`,429)
    }
    const valid=user?await verify(user.passwordHash,input.password).catch(()=>false):false
    if(!user||!valid){
      const failure=user?await this.store.recordLoginFailure(user.id):null
      const failureUntil=failure?.lockedUntil?new Date(failure.lockedUntil):null
      if(user&&failureUntil&&failureUntil.getTime()>Date.now()){
        const remainingMinutes=Math.max(1,Math.ceil((failureUntil.getTime()-Date.now())/60000))
        await this.store.audit(user.id,'auth.login','user',user.id,ip,'locked',{remainingMinutes,lockoutLevel:failure.lockoutLevel})
        throw new AppError('AUTH_LOCKED',`登录已锁定，请 ${remainingMinutes} 分钟后再试`,429)
      }
      await this.store.audit(user?.id??null,'auth.login','user',user?.id??'unknown',ip,'denied')
      throw new AppError('AUTH_INVALID','Invalid username or password',401)
    }
    await this.store.recordLoginSuccess(user.id)
    if(user.status!=='active')throw new AppError('ACCOUNT_UNAVAILABLE','Account is unavailable',403)
    const entitlement=await this.store.entitlement(user.id)
    const license=this.license(entitlement,user)
    const settings=await this.store.getCommerceSettings()
    let device;try{device=await this.store.bindDevice(user.id,hashFingerprint(input.device.fingerprint),hashFingerprint(input.device.hardwareHash??input.device.fingerprint),input.device.name,input.device.platform,input.device.appVersion,license?.maxDevices??settings.defaultDeviceLimit)}catch(e){
      if((e as Error).message==='DEVICE_LIMIT'){
        // 不签发租约和刷新令牌：此令牌仅能在 15 分钟内查看/解绑本账号设备，不能启动代理。
        await this.store.audit(user.id,'auth.login.device_limit','device','pending',ip,'success')
        return {accessToken:await this.access(user,'pending'),refreshToken:'',expiresIn:900,deviceId:'',deviceLimitReached:true,license}
      }
      throw e
    }
    await this.store.audit(user.id,'auth.login','device',device.id,ip,'success')
    return {...await this.issue(user,device.id),license}
  }
  async activateDevice(userId:string,device:ActivateDeviceInput['device'],ip=''){
    const user=await this.store.findUserById(userId);if(!user||user.status!=='active')throw new AppError('ACCOUNT_UNAVAILABLE','Account is unavailable',403)
    const entitlement=await this.store.entitlement(userId),license=this.license(entitlement,user),settings=await this.store.getCommerceSettings()
    try{
      const bound=await this.store.bindDevice(userId,hashFingerprint(device.fingerprint),hashFingerprint(device.hardwareHash??device.fingerprint),device.name,device.platform,device.appVersion,license?.maxDevices??settings.defaultDeviceLimit)
      await this.store.audit(userId,'auth.device.activate','device',bound.id,ip,'success')
      return {...await this.issue(user,bound.id),license}
    }catch(error){
      if((error as Error).message==='DEVICE_LIMIT')throw new AppError('DEVICE_LIMIT','设备名额仍已满，请先解绑一台旧设备',409)
      throw error
    }
  }
  async rotate(input:RefreshInput,ip=''){
    let payload;try{({payload}=await jwtVerify(input.refreshToken,encoder.encode(this.cfg.accessSecret),{algorithms:['HS256']}))}catch{throw new AppError('REFRESH_INVALID','Session expired; sign in again',401)}
    if(payload.typ!=='refresh'||!payload.jti||!payload.fam||!payload.sub||!payload.did)throw new AppError('REFRESH_INVALID','Session expired; sign in again',401)
    const user=await this.store.findUserById(payload.sub);if(!user||user.status!=='active')throw new AppError('ACCOUNT_UNAVAILABLE','Account is unavailable',403)
    const newJti=randomUUID(),familyId=String(payload.fam),deviceId=String(payload.did)
    const refreshToken=await this.refresh(user.id,deviceId,familyId,newJti)
    const rotated=await this.store.rotateSessionAtomic({
      oldJti:String(payload.jti),familyId,oldTokenHash:sha256(input.refreshToken),fingerprintHash:hashFingerprint(input.deviceFingerprint),
      newJti,newTokenHash:sha256(refreshToken),expiresAt:new Date(Date.now()+this.cfg.refreshDays*86400000),
    })
    if(!rotated.ok){
      if(rotated.reason==='device')throw new AppError('DEVICE_MISMATCH','Device verification failed',401)
      if(rotated.reason==='invalid')throw new AppError('REFRESH_INVALID','Session expired; sign in again',401)
      throw new AppError('REFRESH_REPLAY','Credential replay detected; all sessions revoked',401)
    }
    // Rotation is already committed; an audit sink failure must not hide the
    // newly issued one-time token and strand the client with a consumed token.
    await this.store.audit(user.id,'auth.refresh','session',String(payload.jti),ip,'success').catch(()=>{})
    return {accessToken:await this.access(user,rotated.deviceId),refreshToken,expiresIn:900,deviceId:rotated.deviceId,user:{id:user.id,username:user.username,role:user.role}}
  }
  async logout(input:RefreshInput,ip=''){
    try{
      const {payload}=await jwtVerify(input.refreshToken,encoder.encode(this.cfg.accessSecret),{algorithms:['HS256']})
      if(payload.typ==='refresh'&&payload.jti&&payload.fam){
        const session=await this.store.findSession(payload.jti)
        if(session&&session.familyId===payload.fam&&session.tokenHash===sha256(input.refreshToken)){
          await this.store.revokeFamily(session.familyId)
          await this.store.audit(session.userId,'auth.logout','session',session.jti,ip,'success')
        }
      }
    }catch{/* Logout is idempotent and does not reveal token validity. */}
    return {ok:true}
  }
  async verifyAccess(token:string){
    let payload
    try{
      ({payload}=await jwtVerify(token,encoder.encode(this.cfg.accessSecret),{algorithms:['HS256']}))
      if(payload.typ!=='access'||!payload.sub||!payload.did)throw 0
    }catch{throw new AppError('ACCESS_INVALID','Authentication required',401)}
    const user=await this.store.findUserById(payload.sub)
    if(!user||user.status!=='active')throw new AppError('ACCOUNT_UNAVAILABLE','Account is unavailable',403)
    const deviceId=String(payload.did)
    if(deviceId!=='pending'){
      const device=await this.store.findDevice(deviceId)
      if(!device||device.userId!==user.id||device.revoked)throw new AppError('DEVICE_MISMATCH','Device verification failed',401)
    }
    // Role is live database state, never stale JWT input.
    return {userId:user.id,deviceId,role:user.role}
  }
  async lease(userId:string,deviceId:string,deviceFingerprint:string,appVersion:string){
    const user=await this.store.findUserById(userId);if(!user||user.status!=='active')throw new AppError('ACCOUNT_UNAVAILABLE','Account is unavailable',403)
    const ent=await this.store.entitlement(userId);if(!ent)throw new AppError('LICENSE_INACTIVE','License is missing or expired',403)
    const device=await this.store.findDevice(deviceId);if(!device||device.userId!==userId||device.revoked||device.fingerprintHash!==hashFingerprint(deviceFingerprint))throw new AppError('DEVICE_MISMATCH','Device verification failed',401)
    if(!await this.store.isDeviceWithinLimit(userId,deviceId,ent.maxDevices))throw new AppError('DEVICE_LIMIT','当前套餐设备名额已减少，请先解绑超额设备',409)
    const settings=await this.store.getCommerceSettings()
    await this.store.touchDevice(deviceId,appVersion);const release=await this.store.latestRelease();const expires=Math.min(Date.now()+settings.licenseLeaseMinutes*60000,ent.expiresAt.getTime())
    const token=await new SignJWT({typ:'license-lease',lid:ent.licenseId,did:deviceId,fph:device.fingerprintHash,plan:ent.planName,planCode:ent.planCode,tier:ent.tier,maxDevices:ent.maxDevices,features:ent.features,minVersion:release?.minimumVersion??'1.7.2',grace:settings.offlineGraceHours,entitlementExp:Math.floor(ent.expiresAt.getTime()/1000)}).setProtectedHeader({alg:'EdDSA',kid:'proxysplit-license-v1'}).setSubject(userId).setIssuedAt().setExpirationTime(Math.floor(expires/1000)).sign(this.privateKey)
    return {lease:token,expiresAt:new Date(expires).toISOString(),offlineGraceHours:settings.offlineGraceHours,entitlementExpiresAt:ent.expiresAt.toISOString(),release}
  }
}
