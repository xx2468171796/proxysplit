import { createHash, createPublicKey, randomUUID } from 'node:crypto'
import { argon2id, hash, verify } from 'argon2'
import { exportSPKI, generateKeyPair, importPKCS8, jwtVerify, SignJWT } from 'jose'
import { AppError, normalizeUsername } from '@proxysplit/shared'
import type { DeviceInput, LoginInput, RefreshInput, RegisterInput } from '@proxysplit/contracts'
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
  async register(input:RegisterInput,ip=''){
    const passwordHash=await hashPassword(input.password)
    try{
      await this.store.registerTrialUser({
        username:normalizeUsername(input.username),passwordHash,
        hardwareHash:hashFingerprint(input.device.hardwareHash??input.device.fingerprint),ip,
      })
    }catch(error){
      const code=(error as {code?:string}).code
      const message=(error as Error).message
      if(code==='23505')throw new AppError('USERNAME_TAKEN','用户名已存在',409)
      if(message==='REGISTRATION_DISABLED')throw new AppError('REGISTRATION_DISABLED','当前暂停开放注册',403)
      if(message==='TRIAL_ALREADY_CLAIMED')throw new AppError('TRIAL_ALREADY_CLAIMED','本机已经领取过免费试用，请登录原账号或购买套餐',409)
      if(message==='TRIAL_PLAN_NOT_FOUND')throw new AppError('TRIAL_UNAVAILABLE','试用套餐暂不可用',503)
      throw error
    }
    return this.login(input,ip)
  }
  async login(input:LoginInput,ip=''){
    const user=await this.store.findUser(normalizeUsername(input.username)); const valid=user?await verify(user.passwordHash,input.password).catch(()=>false):false
    if(!user||!valid){await this.store.audit(null,'auth.login','user','unknown',ip,'denied');throw new AppError('AUTH_INVALID','Invalid username or password',401)}
    if(user.status!=='active')throw new AppError('ACCOUNT_UNAVAILABLE','Account is unavailable',403)
    const entitlement=await this.store.entitlement(user.id)
    const ent=entitlement??(user.role==='admin'?{licenseId:'admin',planId:'admin',planCode:'admin',planName:'Administrator',tier:'premium' as const,maxDevices:10,features:['admin'],expiresAt:new Date('2999-12-31'),lifetime:true,status:'active'}:null)
    const settings=await this.store.getCommerceSettings()
    let device;try{device=await this.store.bindDevice(user.id,hashFingerprint(input.device.fingerprint),hashFingerprint(input.device.hardwareHash??input.device.fingerprint),input.device.name,input.device.platform,input.device.appVersion,ent?.maxDevices??settings.defaultDeviceLimit)}catch(e){if((e as Error).message==='DEVICE_LIMIT')throw new AppError('DEVICE_LIMIT','设备数量已达到当前套餐上限，请先解绑旧设备或升级套餐',403);throw e}
    await this.store.audit(user.id,'auth.login','device',device.id,ip,'success')
    return {...await this.issue(user,device.id),license:ent?{plan:ent.planName,planCode:ent.planCode,tier:ent.tier,expiresAt:ent.expiresAt,features:ent.features,maxDevices:ent.maxDevices,lifetime:ent.lifetime}:null}
  }
  async rotate(input:RefreshInput,ip=''){
    let payload;try{({payload}=await jwtVerify(input.refreshToken,encoder.encode(this.cfg.accessSecret),{algorithms:['HS256']}))}catch{throw new AppError('REFRESH_INVALID','Session expired; sign in again',401)}
    if(payload.typ!=='refresh'||!payload.jti||!payload.fam||!payload.sub||!payload.did)throw new AppError('REFRESH_INVALID','Session expired; sign in again',401)
    const session=await this.store.findSession(payload.jti);if(!session||session.familyId!==payload.fam||session.tokenHash!==sha256(input.refreshToken)||session.consumedAt||session.revokedAt||session.expiresAt<=new Date()){
      if(session)await this.store.revokeFamily(session.familyId);throw new AppError('REFRESH_REPLAY','Credential replay detected; all sessions revoked',401)
    }
    if(session.fingerprintHash!==hashFingerprint(input.deviceFingerprint))throw new AppError('DEVICE_MISMATCH','Device verification failed',401)
    if(!await this.store.consumeSession(session.jti)){await this.store.revokeFamily(session.familyId);throw new AppError('REFRESH_REPLAY','Credential replay detected; all sessions revoked',401)}
    const user=await this.store.findUserById(session.userId);if(!user||user.status!=='active')throw new AppError('ACCOUNT_UNAVAILABLE','Account is unavailable',403)
    await this.store.audit(user.id,'auth.refresh','session',session.jti,ip,'success')
    return this.issue(user,session.deviceId,session.familyId)
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
  async verifyAccess(token:string){try{const {payload}=await jwtVerify(token,encoder.encode(this.cfg.accessSecret),{algorithms:['HS256']});if(payload.typ!=='access'||!payload.sub||!payload.did)throw 0;return {userId:payload.sub,deviceId:String(payload.did),role:String(payload.role)}}catch{throw new AppError('ACCESS_INVALID','Authentication required',401)}}
  async lease(userId:string,deviceId:string,deviceFingerprint:string,appVersion:string){
    const user=await this.store.findUserById(userId);if(!user||user.status!=='active')throw new AppError('ACCOUNT_UNAVAILABLE','Account is unavailable',403)
    const ent=await this.store.entitlement(userId);if(!ent)throw new AppError('LICENSE_INACTIVE','License is missing or expired',403)
    const device=await this.store.findDevice(deviceId);if(!device||device.userId!==userId||device.revoked||device.fingerprintHash!==hashFingerprint(deviceFingerprint))throw new AppError('DEVICE_MISMATCH','Device verification failed',401)
    const settings=await this.store.getCommerceSettings()
    await this.store.touchDevice(deviceId,appVersion);const release=await this.store.latestRelease();const expires=Math.min(Date.now()+settings.licenseLeaseMinutes*60000,ent.expiresAt.getTime())
    const token=await new SignJWT({typ:'license-lease',lid:ent.licenseId,did:deviceId,fph:device.fingerprintHash,plan:ent.planName,planCode:ent.planCode,tier:ent.tier,maxDevices:ent.maxDevices,features:ent.features,minVersion:release?.minimumVersion??'1.7.2',grace:settings.offlineGraceHours,entitlementExp:Math.floor(ent.expiresAt.getTime()/1000)}).setProtectedHeader({alg:'EdDSA',kid:'proxysplit-license-v1'}).setSubject(userId).setIssuedAt().setExpirationTime(Math.floor(expires/1000)).sign(this.privateKey)
    return {lease:token,expiresAt:new Date(expires).toISOString(),offlineGraceHours:settings.offlineGraceHours,entitlementExpiresAt:ent.expiresAt.toISOString(),release}
  }
}
