import { createHash, createPublicKey, randomUUID } from 'node:crypto'
import { Algorithm, hash, verify } from '@node-rs/argon2'
import { exportSPKI, generateKeyPair, importPKCS8, jwtVerify, SignJWT } from 'jose'
import { AppError, normalizePhone, normalizeUsername } from '@proxysplit/shared'
import type { ActivateDeviceInput, BindPhoneInput, DeviceInput, LoginInput, PasswordResetInput, PowervpnLoginInput, RefreshInput, RegisterInput, SelfPasswordInput, WebRegisterInput } from '@proxysplit/contracts'
import { powervpnMeSchema } from '@proxysplit/contracts'
import { channelOfSources, type PgStore, type UserChannel, type UserRecord } from './store.js'
import { effective, licenseView } from './entitlement.js'
import { PhoneAuth, yunpianSender } from './phone-auth.js'

const encoder=new TextEncoder()
const sha256=(value:string)=>createHash('sha256').update(value).digest('hex')
export const hashFingerprint=(value:string)=>sha256('proxysplit-device-v1:'+value)
export const hashPassword=(value:string)=>hash(value,{algorithm:Algorithm.Argon2id,memoryCost:65536,timeCost:3,parallelism:1})

export type PowervpnIdentity={id:string;username:string;email:string|null;displayName:string;sources:string[];aiPlanExpiresAt?:string|null|undefined}
// 面板 GET /api/client/me 核实令牌；令牌只放请求头，绝不写日志。
export type PowervpnConfig={baseUrl:string;timeoutMs?:number;fetch?:typeof fetch}
// 短信：配了 apiKey 走云片；没配时开发环境把验证码打到日志，生产返回 503 SMS_UNAVAILABLE。
export type SmsConfig={apiKey?:string|undefined;tplId:string;production:boolean;showDevCode?:boolean;log?:(msg:string)=>void;fetch?:typeof fetch}
export type AuthConfig={accessSecret:string;refreshDays:number;licensePrivateKeyPem?:string;licensePublicKeyPem?:string;powervpn?:PowervpnConfig;sms?:SmsConfig}
const userView=(user:UserRecord)=>({id:user.id,username:user.username,role:user.role,channel:user.channel??'',phoneBound:!!user.phone})
const phoneTaken=()=>new AppError('PHONE_TAKEN','该手机号已被其他账号使用',409)
// 没有匹配账号时也跑一次 argon2 校验，响应时间不泄露账号是否存在。
let dummyHash:Promise<string>|null=null
const dummyVerify=async(password:string)=>{dummyHash??=hashPassword(randomUUID());await verify(await dummyHash,password).catch(()=>false)}
const takenError=(error:unknown)=>(error as {constraint?:string}).constraint==='users_phone_uq'
  ?new AppError('PHONE_TAKEN','该手机号已被其他账号使用',409):new AppError('IDENTITY_TAKEN','用户名或邮箱已被使用',409)
export async function fetchPowervpnIdentity(cfg:PowervpnConfig,accessToken:string):Promise<PowervpnIdentity>{
  const doFetch=cfg.fetch??fetch
  let res:Response
  try{
    res=await doFetch(cfg.baseUrl.replace(/\/$/,'')+'/api/client/me',{headers:{authorization:`Bearer ${accessToken}`,accept:'application/json'},signal:AbortSignal.timeout(cfg.timeoutMs??8000)})
  }catch{throw new AppError('POWERVPN_UNAVAILABLE','暂时连不上 POWER云，请稍后再试',503)}
  if(res.status===401||res.status===403)throw new AppError('POWERVPN_TOKEN_INVALID','POWER云 登录已失效，请重新登录',401)
  if(!res.ok)throw new AppError('POWERVPN_UNAVAILABLE','暂时连不上 POWER云，请稍后再试',503)
  const parsed=powervpnMeSchema.safeParse(await res.json().catch(()=>null))
  if(!parsed.success)throw new AppError('POWERVPN_UNAVAILABLE','POWER云 返回的账号信息无效',502)
  return parsed.data
}
// 用户名 pv_<面板 id 前 8 位>（只保留字母数字）
export const powervpnUsernameBase=(externalId:string)=>'pv_'+(externalId.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,8)||'user')
export class AuthService{
  readonly phone:PhoneAuth
  private constructor(private store:PgStore,private cfg:AuthConfig,private privateKey:CryptoKey,readonly publicKeyPem:string){
    const sms=cfg.sms
    this.phone=new PhoneAuth(store.pool,{sender:sms?.apiKey?yunpianSender({apiKey:sms.apiKey,tplId:sms.tplId,...(sms.fetch?{fetch:sms.fetch}:{})}):null,production:sms?.production??false,showDevCode:sms?.showDevCode===true,...(sms?.log?{log:sms.log}:{})})
  }
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
    return {accessToken:await this.access(user,deviceId),refreshToken,expiresIn:900,deviceId,user:userView(user)}
  }
  /** 实际权益（免费档 / 会员叠加设备数），见 entitlement.ts。 */
  private async effectiveOf(user:UserRecord){return effective(user,await this.store.entitlement(user.id),await this.store.getCommerceSettings())}
  async effectiveFor(userId:string){
    const user=await this.store.findUserById(userId);if(!user||user.status!=='active')throw new AppError('ACCOUNT_UNAVAILABLE','Account is unavailable',403)
    return this.effectiveOf(user)
  }
  /** 注册前查撞号：手机号不能是别人的手机号或用户名；像手机号的用户名不能是别人的手机号。 */
  private async assertIdentityFree(username:string,phone:string|undefined){
    if(phone&&await this.phone.phoneTaken(phone))throw phoneTaken()
    const asPhone=normalizePhone(username)
    if(asPhone&&await this.phone.phoneOwner(asPhone))throw new AppError('IDENTITY_TAKEN','用户名或邮箱已被使用',409)
  }
  async register(input:RegisterInput,ip=''){
    await this.assertIdentityFree(input.username,input.phone)
    const codeId=input.phone&&input.code?await this.phone.verify(input.phone,'register',input.code):null
    const passwordHash=await hashPassword(input.password)
    try{
      await this.store.registerTrialUser({
        username:normalizeUsername(input.username),email:input.email?.trim().toLowerCase()||null,phone:input.phone??null,passwordHash,
        hardwareHash:hashFingerprint(input.device.hardwareHash??input.device.fingerprint),ip,...(input.ref?{ref:input.ref}:{}),
      })
    }catch(error){
      const code=(error as {code?:string}).code
      const message=(error as Error).message
      if(code==='23505')throw takenError(error)
      if(message==='REGISTRATION_DISABLED')throw new AppError('REGISTRATION_DISABLED','当前暂停开放注册',403)
      if(message==='DEVICE_ACCOUNT_LIMIT')throw new AppError('DEVICE_ACCOUNT_LIMIT','该设备注册的账号已达上限，请使用已有账号登录',429)
      if(message==='TRIAL_PLAN_NOT_FOUND')throw new AppError('TRIAL_UNAVAILABLE','试用套餐暂不可用',503)
      throw error
    }
    if(codeId)await this.phone.consume(codeId)
    return this.login(input,ip)
  }
  // 官网注册：只建账号，不绑定设备、不发试用（试用在首次客户端登录时发放）。
  async registerWeb(input:WebRegisterInput,ip=''){
    await this.assertIdentityFree(input.username,input.phone)
    const codeId=input.phone&&input.code?await this.phone.verify(input.phone,'register',input.code):null
    const passwordHash=await hashPassword(input.password)
    try{
      const user=await this.store.registerWebUser({
        username:normalizeUsername(input.username),email:input.email?.trim().toLowerCase()||null,phone:input.phone??null,passwordHash,ip,...(input.ref?{ref:input.ref}:{}),
      })
      if(codeId)await this.phone.consume(codeId)
      await this.store.audit(user.id,'auth.register.web','user',user.id,ip,'success')
      return {ok:true,username:user.username}
    }catch(error){
      const code=(error as {code?:string}).code
      const message=(error as Error).message
      if(code==='23505')throw takenError(error)
      if(message==='REGISTRATION_DISABLED')throw new AppError('REGISTRATION_DISABLED','当前暂停开放注册',403)
      if(message==='IP_ACCOUNT_LIMIT')throw new AppError('IP_ACCOUNT_LIMIT','当前网络注册的账号已达上限，请直接登录或联系客服',429)
      throw error
    }
  }
  // 用户自助改密：校验原密码后更新，并撤销该账号其它会话。
  async changeOwnPassword(userId:string,input:SelfPasswordInput,ip=''){
    const user=await this.store.findUserById(userId)
    if(!user)throw new AppError('NOT_FOUND','用户不存在',404)
    // POWER云 建的账号没有密码：首次设置不校验原密码（已通过登录会话认证）。
    const valid=!user.passwordHash||await verify(user.passwordHash,input.currentPassword).catch(()=>false)
    if(!valid){
      await this.store.audit(userId,'user.password','user',userId,ip,'denied')
      throw new AppError('PASSWORD_INVALID','原密码不正确',401)
    }
    if(input.currentPassword===input.newPassword)throw new AppError('PASSWORD_SAME','新密码不能与原密码相同',400)
    await this.store.setUserPassword(userId,await hashPassword(input.newPassword))
    await this.store.audit(userId,'user.password','user',userId,ip,'success')
    return {ok:true}
  }
  // 短信找回密码：每号每北京日 1 次，改密同时吊销全部会话（phone-auth.ts）。
  async resetPasswordByPhone(input:PasswordResetInput,ip=''){
    const r=await this.phone.resetPassword(input.phone,input.code,await hashPassword(input.password))
    await this.store.audit(r.userId,'auth.password.reset','user',r.userId,ip,'success')
    return {ok:true}
  }
  // 已登录用户补绑 / 换绑手机号：已有手机号时换绑要当前登录密码（POWER云 建的无密码账号除外）。
  async bindPhone(userId:string,input:BindPhoneInput){
    const user=await this.store.findUserById(userId)
    if(!user||user.status!=='active')throw new AppError('ACCOUNT_UNAVAILABLE','Account is unavailable',403)
    if(user.phone&&user.passwordHash){
      const ok=!!input.currentPassword&&await verify(user.passwordHash,input.currentPassword).catch(()=>false)
      if(!ok)throw new AppError('PASSWORD_INVALID','当前登录密码不正确',401)
    }
    return this.phone.bindPhone(userId,input.phone,input.code)
  }
  // 登录框接受用户名或手机号（含 +86）：像手机号先按手机号查，再按用户名查（兼容数字用户名）；两个都在时按顺序试密码。
  private async loginCandidates(name:string){
    const phone=normalizePhone(name)
    const byPhone=phone?await this.store.findUserByPhone(phone):null
    const byName=await this.store.findUser(normalizeUsername(name))
    return [byPhone,byName].filter((u,i,a):u is UserRecord=>!!u&&a.findIndex(x=>x?.id===u.id)===i)
  }
  private async findLoginUser(name:string,password:string){
    const candidates=await this.loginCandidates(name)
    if(!candidates.length){await dummyVerify(password);return null}
    for(const u of candidates){
      const locked=u.lockedUntil&&new Date(u.lockedUntil).getTime()>Date.now()
      if(u.passwordHash&&!locked&&await verify(u.passwordHash,password).catch(()=>false))return {user:u,valid:true}
    }
    return {user:candidates[0]!,valid:false}
  }
  async login(input:LoginInput,ip=''){
    const found=await this.findLoginUser(input.username,input.password),user=found?.user??null
    const lockedUntil=user?.lockedUntil?new Date(user.lockedUntil):null
    if(user&&!found?.valid&&lockedUntil&&lockedUntil.getTime()>Date.now()){
      const remainingMinutes=Math.max(1,Math.ceil((lockedUntil.getTime()-Date.now())/60000))
      await this.store.audit(user.id,'auth.login','user',user.id,ip,'locked',{remainingMinutes,lockoutLevel:user.lockoutLevel})
      throw new AppError('AUTH_LOCKED',`登录已锁定，请 ${remainingMinutes} 分钟后再试`,429)
    }
    if(user&&!found?.valid&&!user.passwordHash){
      await this.store.audit(user.id,'auth.login','user',user.id,ip,'denied',{reason:'no_password'})
      throw new AppError('PASSWORD_NOT_SET','该账号是用 POWER云 登录创建的，还没有设置密码，请点「用 POWER云 账号登录」',401)
    }
    const valid=found?.valid===true
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
    return this.completeLogin(user,input.device,ip,'auth.login')
  }
  // 交付用：客户还没打开过客户端时，管理员按 POWER云 客户 id 先建好关联账号（之后客户用 POWER云 登录就是这个号），好先发会员。
  async provisionPowervpnUser(input:{externalId:string;email:string|null;channel:UserChannel},ip=''){
    let result
    try{result=await this.store.findOrCreateIdentityUser({provider:'powervpn',externalId:input.externalId,usernameBase:powervpnUsernameBase(input.externalId),email:input.email,ip})}
    catch(e){if((e as Error).message==='USERNAME_EXHAUSTED')throw new AppError('IDENTITY_TAKEN','无法为该 POWER云 账号分配用户名',409);throw e}
    if(await this.store.markUserChannel(result.user.id,input.channel))result.user.channel=input.channel
    return {id:result.user.id,username:result.user.username,channel:result.user.channel,created:result.created}
  }
  // 中转站会员同步：面板给了 aiPlanExpiresAt 才同步（老面板不给 = 不动）。失败不挡登录。
  private async syncAigwMembership(userId:string,identity:PowervpnIdentity,ip:string){
    if(identity.aiPlanExpiresAt===undefined)return null
    try{
      const r=await this.store.syncAigwLicense(userId,identity.aiPlanExpiresAt?new Date(identity.aiPlanExpiresAt):null)
      if(r.changed)await this.store.audit(userId,'license.aigw.sync','user',userId,ip,'success',{expiresAt:r.expiresAt?.toISOString()??null})
      return r
    }catch(e){
      // 不挡登录，但要看得见（比如 standard-month 套餐被删了会一直同步失败）
      await this.store.audit(userId,'license.aigw.sync','user',userId,ip,'failure',{error:(e as Error).message}).catch(()=>{})
      return null
    }
  }
  // 已登录的客户端定期用 POWER云 令牌同步：令牌对应的 POWER云 账号必须就是这个 ProxySplit 用户关联的那个。
  async syncPowervpn(userId:string,accessToken:string,ip=''){
    if(!this.cfg.powervpn)throw new AppError('POWERVPN_DISABLED','POWER云 登录未开放',503)
    const identity=await fetchPowervpnIdentity(this.cfg.powervpn,accessToken)
    if(await this.store.identityOwner('powervpn',identity.id)!==userId)throw new AppError('IDENTITY_MISMATCH','POWER云 账号与当前登录账号不一致，请重新登录',403)
    const channel=channelOfSources(identity.sources)
    if(await this.store.markUserChannel(userId,channel))await this.store.audit(userId,'auth.channel','user',userId,ip,'success',{channel})
    const r=await this.syncAigwMembership(userId,identity,ip)
    const user=await this.store.findUserById(userId)
    const license=user?licenseView(await this.effectiveOf(user)):null
    return {channel:user?.channel??'',aiPlanExpiresAt:r?.expiresAt?.toISOString()??null,license}
  }
  // POWER云 账号登录：面板核实令牌 → 找 / 建用户 → 与 login() 相同的会话 + 设备数逻辑。不送授权。
  async loginPowervpn(input:PowervpnLoginInput,ip=''){
    if(!this.cfg.powervpn)throw new AppError('POWERVPN_DISABLED','POWER云 登录未开放',503)
    const identity=await fetchPowervpnIdentity(this.cfg.powervpn,input.accessToken)
    let result
    try{result=await this.store.findOrCreateIdentityUser({provider:'powervpn',externalId:identity.id,usernameBase:powervpnUsernameBase(identity.id),email:identity.email,ip})}
    catch(e){if((e as Error).message==='USERNAME_EXHAUSTED')throw new AppError('IDENTITY_TAKEN','无法为该 POWER云 账号分配用户名，请联系客服',409);throw e}
    const {user,created}=result
    if(created)await this.store.audit(user.id,'auth.register.powervpn','user',user.id,ip,'success')
    // 经 AI 编程官网登录过的 POWER云 客户 = 中转站客户：记渠道，客户端据此隐藏作者联系方式。
    const channel=channelOfSources(identity.sources)
    if(await this.store.markUserChannel(user.id,channel)){user.channel=channel;await this.store.audit(user.id,'auth.channel','user',user.id,ip,'success',{channel})}
    // 会员跟 AI 套餐走：在发试用、签租约之前同步（有 AI 套餐就不浪费这台电脑的一次试用）
    await this.syncAigwMembership(user.id,identity,ip)
    if(user.status!=='active')throw new AppError('ACCOUNT_UNAVAILABLE','Account is unavailable',403)
    return this.completeLogin(user,input.device,ip,'auth.login.powervpn')
  }
  private async completeLogin(user:UserRecord,inputDevice:DeviceInput,ip:string,action:string){
    // 官网注册的账号在这里补发试用：注册时没有设备信息，首次客户端登录才知道硬件。
    // 内部已做「一机一次 / 一号一次 / 已有权益不发」判断，失败不阻断登录。
    try{await this.store.claimTrialOnLogin(user.id,hashFingerprint(inputDevice.hardwareHash??inputDevice.fingerprint),ip)}catch{/* 发放试用失败绝不能挡住登录 */}
    // 设备上限 = 免费名额 + 套餐设备数；管理员不限（控制台和发版自动化共用一个号）。
    const eff=await this.effectiveOf(user),license=licenseView(eff),deviceLimit=eff.deviceLimit
    // 不签发租约和刷新令牌：此令牌仅能在 15 分钟内查看/解绑本账号设备，不能启动代理。
    const pending=async()=>{
      await this.store.audit(user.id,'auth.login.device_limit','device','pending',ip,'success')
      return {accessToken:await this.access(user,'pending'),refreshToken:'',expiresIn:900,deviceId:'',deviceLimitReached:true,license,user:userView(user)}
    }
    let device;try{device=await this.store.bindDevice(user.id,hashFingerprint(inputDevice.fingerprint),hashFingerprint(inputDevice.hardwareHash??inputDevice.fingerprint),inputDevice.name,inputDevice.platform,inputDevice.appVersion,deviceLimit)}catch(e){
      if((e as Error).message==='DEVICE_LIMIT')return pending()
      throw e
    }
    // 本机已绑定但名额减少（会员到期等）后排在名额之外：与名额已满同一回应，老客户端（v1.10.x）也能进解绑页，
    // 不会拿到会话后在租约 409 时清状态卡死。租约的 409 仍保留作兜底。
    if(!await this.store.isDeviceWithinLimit(user.id,device.id,deviceLimit))return pending()
    await this.store.audit(user.id,action,'device',device.id,ip,'success')
    return {...await this.issue(user,device.id),license}
  }
  async activateDevice(userId:string,device:ActivateDeviceInput['device'],ip=''){
    const user=await this.store.findUserById(userId);if(!user||user.status!=='active')throw new AppError('ACCOUNT_UNAVAILABLE','Account is unavailable',403)
    const eff=await this.effectiveOf(user),license=licenseView(eff),deviceLimit=eff.deviceLimit
    try{
      const bound=await this.store.bindDevice(userId,hashFingerprint(device.fingerprint),hashFingerprint(device.hardwareHash??device.fingerprint),device.name,device.platform,device.appVersion,deviceLimit)
      // 已绑定但排在名额外：和名额已满一样回 409，不签会话。
      if(!await this.store.isDeviceWithinLimit(userId,bound.id,deviceLimit))throw new Error('DEVICE_LIMIT')
      await this.store.audit(userId,'auth.device.activate','device',bound.id,ip,'success')
      return {...await this.issue(user,bound.id),license}
    }catch(error){
      if((error as Error).message==='DEVICE_LIMIT')throw new AppError('DEVICE_LIMIT','设备名额仍已满，请先解绑一台旧设备',409)
      throw error
    }
  }
  async rotate(input:RefreshInput,ip=''){
    let payload;try{({payload}=await jwtVerify(input.refreshToken,encoder.encode(this.cfg.accessSecret),{algorithms:['HS256']}))}catch{throw new AppError('REFRESH_INVALID','登录已过期，请重新登录',401)}
    if(payload.typ!=='refresh'||!payload.jti||!payload.fam||!payload.sub||!payload.did)throw new AppError('REFRESH_INVALID','登录已过期，请重新登录',401)
    const user=await this.store.findUserById(payload.sub);if(!user||user.status!=='active')throw new AppError('ACCOUNT_UNAVAILABLE','Account is unavailable',403)
    const newJti=randomUUID(),familyId=String(payload.fam),deviceId=String(payload.did)
    const refreshToken=await this.refresh(user.id,deviceId,familyId,newJti)
    const rotated=await this.store.rotateSessionAtomic({
      oldJti:String(payload.jti),familyId,oldTokenHash:sha256(input.refreshToken),fingerprintHash:hashFingerprint(input.deviceFingerprint),
      newJti,newTokenHash:sha256(refreshToken),expiresAt:new Date(Date.now()+this.cfg.refreshDays*86400000),
    })
    if(!rotated.ok){
      if(rotated.reason==='device')throw new AppError('DEVICE_MISMATCH','Device verification failed',401)
      if(rotated.reason==='invalid')throw new AppError('REFRESH_INVALID','登录已过期，请重新登录',401)
      throw new AppError('REFRESH_REPLAY','登录状态已失效（检测到旧凭据被再次使用），请重新登录',401)
    }
    // Rotation is already committed; an audit sink failure must not hide the
    // newly issued one-time token and strand the client with a consumed token.
    await this.store.audit(user.id,'auth.refresh','session',String(payload.jti),ip,'success').catch(()=>{})
    return {accessToken:await this.access(user,rotated.deviceId),refreshToken,expiresIn:900,deviceId:rotated.deviceId,user:userView(user)}
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
    // 免费用户也签租约（tier='free'）；只有超出设备名额才拒绝。
    const eff=await this.effectiveOf(user),ent=eff.ent
    const device=await this.store.findDevice(deviceId);if(!device||device.userId!==userId||device.revoked||device.fingerprintHash!==hashFingerprint(deviceFingerprint))throw new AppError('DEVICE_MISMATCH','Device verification failed',401)
    if(!await this.store.isDeviceWithinLimit(userId,deviceId,eff.deviceLimit))throw new AppError('DEVICE_LIMIT','当前套餐设备名额已减少，请先解绑超额设备',409)
    const settings=await this.store.getCommerceSettings()
    await this.store.touchDevice(deviceId,appVersion);const release=await this.store.latestRelease();const expires=Math.min(Date.now()+settings.licenseLeaseMinutes*60000,ent.expiresAt.getTime())
    const token=await new SignJWT({typ:'license-lease',lid:ent.licenseId,did:deviceId,fph:device.fingerprintHash,plan:ent.planName,planCode:ent.planCode,tier:ent.tier,maxDevices:ent.maxDevices,features:ent.features,minVersion:release?.minimumVersion??'1.7.2',grace:settings.offlineGraceHours,entitlementExp:Math.floor(ent.expiresAt.getTime()/1000)}).setProtectedHeader({alg:'EdDSA',kid:'proxysplit-license-v1'}).setSubject(userId).setIssuedAt().setExpirationTime(Math.floor(expires/1000)).sign(this.privateKey)
    return {lease:token,expiresAt:new Date(expires).toISOString(),offlineGraceHours:settings.offlineGraceHours,entitlementExpiresAt:ent.expiresAt.toISOString(),release}
  }
}
