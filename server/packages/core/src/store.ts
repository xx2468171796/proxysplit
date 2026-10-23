import { createHash, randomBytes } from 'node:crypto'
import { createDatabase } from '@proxysplit/db'
import type { AnnouncementListQuery, AnnouncementUpsertInput, AuditListQuery, DeviceListQuery, OrderListQuery, PlanListQuery, PlanPatchInput, PlanUpsertInput, ProviderUpsertInput, RedeemListQuery, ReleaseListQuery, UserListQuery } from '@proxysplit/contracts'
import { AppError } from '@proxysplit/shared'
import { planSplit } from './split.js'
import { createProxysplitFenxiao, type ProxysplitFenxiao } from './fenxiao.js'

export type UserRecord = {
  id:string; username:string; passwordHash:string|null; role:'user'|'admin';
  status:'active'|'suspended'|'banned'; createdAt:Date;
  failedLoginCount:number; lockoutLevel:number; lockedUntil:Date|null
  /** 来源渠道：'' 自有；'aigw' 中转站客户（客户端隐藏作者联系方式） */
  channel:UserChannel
}
export type UserChannel=''|'aigw'
/** POWER云 /api/client/me 的 sources → 渠道：经 AI 编程官网登录过的就是中转站客户。 */
export const channelOfSources=(sources:readonly string[]):UserChannel=>sources.includes('aigw')?'aigw':''
export type Entitlement = {
  licenseId:string; planId:string; planCode:string; planName:string;
  tier:'trial'|'standard'|'premium'; maxDevices:number; features:string[];
  expiresAt:Date; lifetime:boolean; status:string
}
export type DeviceRecord = {
  id:string; userId:string; fingerprintHash:string; hardwareHash:string;
  name:string; platform:string; appVersion:string; revoked:boolean
}
export type SessionRecord = {
  jti:string; familyId:string; userId:string; deviceId:string; tokenHash:string;
  consumedAt:Date|null; revokedAt:Date|null; expiresAt:Date; fingerprintHash:string
}
export type ReleaseRecord = {
  version:string; minimumVersion:string; url:string; sha256:string;
  signature:string; mandatory:boolean; title:string; summary:string;
  changelog:string; channel:string; publishedAt:Date
}
export type CommerceSettings = {
  registrationEnabled:boolean; trialDays:number; trialPlanCode:string;
  defaultDeviceLimit:number; licenseLeaseMinutes:number;
  offlineGraceHours:number; activePaymentProvider:string;
  paymentMethods:Array<'alipay'>; maxAccountsPerDevice:number; maxAccountsPerIp:number
}
export type PaymentProviderRecord = {
  code:string; displayName:string; adapter:string; endpoint:string;
  merchantId:string; credentialRef:string; config:Record<string,string|number|boolean>;
  enabled:boolean
}
export type OrderRecord = {
  id:string; orderNo:string; userId:string; planId:string; planName:string;
  tier:string; billingCycle:string; durationDays:number|null; lifetime:boolean;
  amountCents:number; currency:string; status:string; providerCode:string;
  providerOrderNo:string|null; payUrl:string|null; checkoutUrl?:string|null; paidAt:Date|null;
  expiresAt:Date; createdAt:Date;
  groupId:string|null; splitIndex:number|null; splitTotal:number|null
}

const sha256=(value:string)=>createHash('sha256').update(value).digest('hex')
const orderNo=()=>`PS${new Date().toISOString().replace(/\D/g,'').slice(0,14)}${randomBytes(5).toString('hex').toUpperCase()}`
const permanentLicenseDate=()=>new Date('2999-12-31T23:59:59.000Z')
// Human-friendly redeem code, e.g. PS-7K4M-9QXA-3F2H. Excludes I/O/0/1.
const REDEEM_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const genRedeemCode=()=>{
  const b=randomBytes(12)
  let s=''
  for(let i=0;i<12;i++)s+=REDEEM_ALPHABET.charAt((b[i]??0)%REDEEM_ALPHABET.length)
  return `PS-${s.slice(0,4)}-${s.slice(4,8)}-${s.slice(8,12)}`
}
// Minimal transactional client surface (a pg PoolClient) used by the shared
// license-grant helper, to avoid a direct pg type dependency in this package.
type TxClient={ query(text:string,params?:unknown[]):Promise<{rows:any[];rowCount:number|null}> }

/** 刷新响应丢失的容忍窗口：客户端每分钟刷新一次，断网几轮也够。 */
export const REFRESH_RETRY_GRACE_MS=10*60_000

export type PresentedSession={familyId:string;tokenHash:string;consumedAt:Date|null;revokedAt:Date|null;expiresAt:Date;fingerprintHash:string}
export type SessionSuccessor={consumedAt:Date|null;revokedAt:Date|null}|null

/**
 * 判定一次刷新令牌出示：rotate = 正常轮换；retry = 上一次轮换的响应没送到客户端
 * （服务器已返回 200，客户端仍拿着旧令牌）；replay = 真的重放，整条会话作废；device = 设备不符。
 * retry 只在「同一台设备、旧令牌刚被轮换不久、它换出的新令牌从没被用过」时成立：
 * 偷令牌的人抢先用旧令牌，合法客户端下次拿新令牌来时就是 replay，照样会全部作废。
 */
export function classifyRefresh(session:PresentedSession,input:{familyId:string;tokenHash:string;fingerprintHash:string},successor:SessionSuccessor,now:Date):'rotate'|'retry'|'replay'|'device'{
  if(session.familyId!==input.familyId||session.tokenHash!==input.tokenHash||session.revokedAt||session.expiresAt<=now)return 'replay'
  if(session.consumedAt){
    const lostResponse=successor!==null&&!successor.consumedAt&&!successor.revokedAt&&
      session.fingerprintHash===input.fingerprintHash&&now.getTime()-session.consumedAt.getTime()<=REFRESH_RETRY_GRACE_MS
    return lostResponse?'retry':'replay'
  }
  return session.fingerprintHash===input.fingerprintHash?'rotate':'device'
}

export function resolvePaidLicenseGrant(
  existing:{planId:string;expiresAt:Date;lifetime:boolean}|null,
  order:{planId:string;durationDays:number|null;lifetime:boolean},
  now=new Date(),
){
  // A later fixed-term purchase must never downgrade an existing lifetime
  // entitlement or replace its lifetime plan metadata.
  if(existing?.lifetime)return {planId:existing.planId,expiresAt:existing.expiresAt,lifetime:true,changed:false}
  if(order.lifetime)return {planId:order.planId,expiresAt:permanentLicenseDate(),lifetime:true,changed:true}
  const days=Number(order.durationDays)
  if(!Number.isInteger(days)||days<1)throw new Error('ORDER_DURATION_INVALID')
  const base=existing&&existing.expiresAt>now?existing.expiresAt:now
  return {planId:order.planId,expiresAt:new Date(base.getTime()+days*86400000),lifetime:false,changed:true}
}
// refundedLicense computes the license after taking back one grant: a fixed
// term loses only its unused part (time before now is consumed; grants stacked
// after it move up); a grant that made the license lifetime reverts it to what
// it was before. null = no change.
export function refundedLicense(
  license:{expiresAt:Date;lifetime:boolean}|null,
  grant:{startAt:Date;endAt:Date|null;beforeExpiresAt:Date|null;beforeLifetime:boolean},
  now=new Date(),
):{expiresAt:Date;lifetime:boolean;removedDays:number}|null{
  if(!license)return null
  if(grant.endAt===null){
    if(!license.lifetime||grant.beforeLifetime)return null
    const back=grant.beforeExpiresAt&&grant.beforeExpiresAt>now?grant.beforeExpiresAt:now
    return {expiresAt:back,lifetime:false,removedDays:-1}
  }
  if(license.lifetime)return null // a later lifetime grant supersedes it
  const unused=Math.max(0,grant.endAt.getTime()-Math.max(now.getTime(),grant.startAt.getTime()))
  if(unused===0)return null
  return {expiresAt:new Date(license.expiresAt.getTime()-unused),lifetime:false,removedDays:Math.round(unused/86400000*10)/10}
}
export function validatePlanTerms(v:{billingCycle:string;durationDays:number|null;lifetime:boolean}){
  if(v.lifetime!==(v.billingCycle==='lifetime'))throw new AppError('PLAN_TERMS_INVALID','永久标记与套餐周期必须一致',400)
  if(!v.lifetime&&(!Number.isInteger(Number(v.durationDays))||Number(v.durationDays)<1)){
    throw new AppError('PLAN_TERMS_INVALID','非永久套餐必须设置有效天数',400)
  }
}
const settingMap:Record<keyof CommerceSettings,string>={
  registrationEnabled:'registration_enabled',
  trialDays:'trial_days',
  trialPlanCode:'trial_plan_code',
  defaultDeviceLimit:'default_device_limit',
  licenseLeaseMinutes:'license_lease_minutes',
  offlineGraceHours:'offline_grace_hours',
  activePaymentProvider:'active_payment_provider',
  paymentMethods:'payment_methods',
  maxAccountsPerDevice:'max_accounts_per_device',
  maxAccountsPerIp:'max_accounts_per_ip',
}
const settingsDefaults:CommerceSettings={
  registrationEnabled:true,trialDays:3,trialPlanCode:'trial',
  defaultDeviceLimit:3,licenseLeaseMinutes:60,offlineGraceHours:6,
  activePaymentProvider:'zhongzhuan-prod',paymentMethods:['alipay'],maxAccountsPerDevice:3,maxAccountsPerIp:3,
}

// ---- Admin list helpers: parameterized paging + whitelisted sorting ----
// Sorting never concatenates user input: `sort` is only ever used as a lookup
// key into a per-entity column map, so an unknown/injected value falls back to
// the entity default. Only paging values and filters flow in as bound params.
export type ListParams = { q?:string; limit?:number; offset?:number; sort?:string; order?:'asc'|'desc'|string }
export type ListResult<T> = { items:T[]; total:number; limit:number; offset:number }
const pageLimit=(n?:number)=>{const v=typeof n==='number'&&Number.isFinite(n)?Math.floor(n):20;return Math.min(100,Math.max(1,v))}
const pageOffset=(n?:number)=>{const v=typeof n==='number'&&Number.isFinite(n)?Math.floor(n):0;return Math.max(0,v)}
const orderClause=(sort:string|undefined,order:string|undefined,map:Record<string,string>,fallback:string)=>{
  const col=sort?map[sort]:undefined
  if(!col)return fallback
  return `${col} ${order==='asc'?'ASC':'DESC'}`
}

export class PgStore {
  readonly pool: ReturnType<typeof createDatabase>['pool']
  /** 多级分销（tuiguang/fenxiao）：注册绑上级、付款分佣、退款冲回都在本类的事务里调 */
  readonly fx: ProxysplitFenxiao
  constructor(url:string) { this.pool=createDatabase(url).pool; this.fx=createProxysplitFenxiao(this.pool) }
  async close(){ await this.pool.end() }

  async findUser(username:string):Promise<UserRecord|null>{
    const r=await this.pool.query('SELECT id,username,password_hash AS "passwordHash",role,status,created_at AS "createdAt",failed_login_count AS "failedLoginCount",lockout_level AS "lockoutLevel",locked_until AS "lockedUntil",channel FROM users WHERE username=$1',[username])
    return r.rows[0]??null
  }
  async findUserById(id:string):Promise<UserRecord|null>{
    const r=await this.pool.query('SELECT id,username,password_hash AS "passwordHash",role,status,created_at AS "createdAt",failed_login_count AS "failedLoginCount",lockout_level AS "lockoutLevel",locked_until AS "lockedUntil",channel FROM users WHERE id=$1',[id])
    return r.rows[0]??null
  }
  async entitlement(userId:string):Promise<Entitlement|null>{
    const r=await this.pool.query(`SELECT l.id AS "licenseId",p.id AS "planId",p.code AS "planCode",p.name AS "planName",p.tier,
      p.max_devices AS "maxDevices",p.features,l.expires_at AS "expiresAt",l.lifetime,l.status
      FROM licenses l JOIN plans p ON p.id=l.plan_id
      WHERE l.user_id=$1 AND l.status='active' AND l.starts_at<=now() AND l.expires_at>now()
      ORDER BY CASE p.tier WHEN 'premium' THEN 3 WHEN 'standard' THEN 2 ELSE 1 END DESC,l.lifetime DESC,l.expires_at DESC LIMIT 1`,[userId])
    return r.rows[0]??null
  }

  async getCommerceSettings():Promise<CommerceSettings>{
    const r=await this.pool.query('SELECT key,value FROM system_settings WHERE key=ANY($1)',[Object.values(settingMap)])
    const byKey=new Map(r.rows.map(x=>[x.key,x.value]))
    const result={...settingsDefaults}
    for(const [field,key] of Object.entries(settingMap) as [keyof CommerceSettings,string][]){
      if(byKey.has(key))(result as Record<string,unknown>)[field]=byKey.get(key)
    }
    return result
  }
  async updateCommerceSettings(values:Partial<CommerceSettings>,actor:string){
    const client=await this.pool.connect()
    try{
      await client.query('BEGIN')
      for(const [field,value] of Object.entries(values) as [keyof CommerceSettings,unknown][]){
        const key=settingMap[field]
        if(!key)continue
        await client.query(`INSERT INTO system_settings(key,value,updated_by,updated_at) VALUES($1,$2,$3,now())
          ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=now()`,[key,JSON.stringify(value),actor])
      }
      await client.query('COMMIT')
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
    return this.getCommerceSettings()
  }

  async registerTrialUser(input:{username:string;email:string;passwordHash:string;hardwareHash:string;ip:string;ref?:string}){
    const client=await this.pool.connect()
    try{
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[input.hardwareHash])
      const settings=await client.query(`SELECT key,value FROM system_settings WHERE key IN ('registration_enabled','trial_days','trial_plan_code','max_accounts_per_device')`)
      const map=new Map(settings.rows.map(x=>[x.key,x.value]))
      if((map.get('registration_enabled')??true)!==true)throw new Error('REGISTRATION_DISABLED')
      const trialDays=Number(map.get('trial_days')??3)
      const trialPlanCode=String(map.get('trial_plan_code')??'trial')
      // 同一设备的注册账号数上限（防刷试用）。hardwareHash 由 auth.register 保证非空。
      const maxPerDevice=Number(map.get('max_accounts_per_device')??3)
      if(input.hardwareHash&&maxPerDevice>0){
        const cnt=await client.query('SELECT count(*)::int AS n FROM users WHERE registration_hardware_hash=$1',[input.hardwareHash])
        if(cnt.rows[0].n>=maxPerDevice)throw new Error('DEVICE_ACCOUNT_LIMIT')
      }
      // 同一硬件只能领取一次试用，但不能因此阻止共享电脑上的其他用户注册。
      // 已领取过试用时仍创建正常账号，只是不发放试用授权，由客户端引导购买套餐。
      const claimed=trialDays>0
        ?await client.query('SELECT 1 FROM trial_claims WHERE hardware_hash=$1',[input.hardwareHash])
        :null
      const grantTrial=trialDays>0&&!claimed?.rowCount
      const now=new Date(),trialEnds=new Date(now.getTime()+trialDays*86400000)
      const user=await client.query(`INSERT INTO users(username,email,password_hash,role,status,trial_started_at,trial_ends_at,registration_ip_hash,registration_hardware_hash)
        VALUES($1,$2,$3,'user','active',$4,$5,$6,$7) RETURNING id,username,email,role,status`,
        [input.username,input.email,input.passwordHash,grantTrial?now:null,grantTrial?trialEnds:null,sha256('proxysplit-ip-v1:'+input.ip),input.hardwareHash||''])
      if(grantTrial){
        const plan=await client.query('SELECT id FROM plans WHERE code=$1 AND active=true',[trialPlanCode])
        if(!plan.rows[0])throw new Error('TRIAL_PLAN_NOT_FOUND')
        await client.query(`INSERT INTO licenses(user_id,plan_id,starts_at,expires_at,source)
          VALUES($1,$2,$3,$4,'trial')`,[user.rows[0].id,plan.rows[0].id,now,trialEnds])
        await client.query(`INSERT INTO trial_claims(hardware_hash,user_id,expires_at,ip_hash)
          VALUES($1,$2,$3,$4)`,[input.hardwareHash,user.rows[0].id,trialEnds,sha256('proxysplit-ip-v1:'+input.ip)])
      }
      await this.bindReferrerInTx(client,user.rows[0].id,input.ref)
      await client.query('COMMIT')
      return {...user.rows[0],trialDays:grantTrial?trialDays:0,trialEndsAt:grantTrial?trialEnds:null,trialGranted:grantTrial}
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }

  // 官网注册：没有设备指纹，因此按注册来源 IP 限制账号数；不发放试用，
  // 试用留到首次用客户端登录时按硬件发放（见 claimTrialOnLogin）。
  async registerWebUser(input:{username:string;email:string;passwordHash:string;ip:string;ref?:string}){
    const ipHash=sha256('proxysplit-ip-v1:'+input.ip)
    const client=await this.pool.connect()
    try{
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`webreg:${ipHash}`])
      const settings=await client.query(`SELECT key,value FROM system_settings WHERE key IN ('registration_enabled','max_accounts_per_ip')`)
      const map=new Map(settings.rows.map(x=>[x.key,x.value]))
      if((map.get('registration_enabled')??true)!==true)throw new Error('REGISTRATION_DISABLED')
      const maxPerIp=Number(map.get('max_accounts_per_ip')??3)
      if(maxPerIp>0){
        const cnt=await client.query('SELECT count(*)::int AS n FROM users WHERE registration_ip_hash=$1',[ipHash])
        if(cnt.rows[0].n>=maxPerIp)throw new Error('IP_ACCOUNT_LIMIT')
      }
      const user=await client.query(`INSERT INTO users(username,email,password_hash,role,status,registration_ip_hash,registration_hardware_hash)
        VALUES($1,$2,$3,'user','active',$4,'') RETURNING id,username,email,role,status`,
        [input.username,input.email,input.passwordHash,ipHash])
      await this.bindReferrerInTx(client,user.rows[0].id,input.ref)
      await client.query('COMMIT')
      return user.rows[0]
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }

  // POWER云 等外部账号：按 (provider, external_id) 找用户，没有就建一个无密码账号。
  // 用户名冲突时加数字后缀；邮箱已被别的账号占用时不带邮箱（不自动合并已有账号）。
  async findOrCreateIdentityUser(input:{provider:string;externalId:string;usernameBase:string;email:string|null;ip:string}):Promise<{user:UserRecord;created:boolean}>{
    const select='SELECT u.id,u.username,u.password_hash AS "passwordHash",u.role,u.status,u.created_at AS "createdAt",u.failed_login_count AS "failedLoginCount",u.lockout_level AS "lockoutLevel",u.locked_until AS "lockedUntil",u.channel FROM user_identities i JOIN users u ON u.id=i.user_id WHERE i.provider=$1 AND i.external_id=$2'
    const found=await this.pool.query(select,[input.provider,input.externalId])
    if(found.rows[0])return {user:found.rows[0],created:false}
    const client=await this.pool.connect()
    try{
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`identity:${input.provider}:${input.externalId}`])
      const again=await client.query(select,[input.provider,input.externalId])
      if(again.rows[0]){await client.query('COMMIT');return {user:again.rows[0],created:false}}
      let email=input.email?.trim().toLowerCase()||null
      if(email){const taken=await client.query('SELECT 1 FROM users WHERE lower(email)=$1',[email]);if(taken.rowCount)email=null}
      let username=input.usernameBase
      let n=1
      let u
      // 邮箱 / 用户名可能被并发注册抢先占用（唯一索引）：回滚到保存点后换名 / 去掉邮箱重试，绝不合并已有账号。
      for(;;){
        const taken=await client.query('SELECT 1 FROM users WHERE username=$1',[username])
        if(taken.rowCount){
          if(++n>200)throw new Error('USERNAME_EXHAUSTED')
          username=`${input.usernameBase}_${n}`
          continue
        }
        await client.query('SAVEPOINT identity_user')
        try{
          u=await client.query(`INSERT INTO users(username,email,password_hash,role,status,registration_ip_hash,registration_hardware_hash)
            VALUES($1,$2,NULL,'user','active',$3,'') RETURNING id,username,password_hash AS "passwordHash",role,status,created_at AS "createdAt",failed_login_count AS "failedLoginCount",lockout_level AS "lockoutLevel",locked_until AS "lockedUntil",channel`,
            [username,email,sha256('proxysplit-ip-v1:'+input.ip)])
          break
        }catch(e){
          const err=e as {code?:string;constraint?:string}
          if(err.code!=='23505')throw e
          await client.query('ROLLBACK TO SAVEPOINT identity_user')
          if(err.constraint==='users_email_lower_uq'&&email){email=null;continue}
          if(++n>200)throw new Error('USERNAME_EXHAUSTED')
          username=`${input.usernameBase}_${n}`
        }
      }
      await client.query('INSERT INTO user_identities(provider,external_id,user_id) VALUES($1,$2,$3)',[input.provider,input.externalId,u.rows[0].id])
      await client.query('COMMIT')
      return {user:u.rows[0],created:true}
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }

  // 渠道只升不降：'' → 'aigw'；已是 aigw 的不动（返回 false）。
  async markUserChannel(userId:string,channel:UserChannel):Promise<boolean>{
    if(!channel)return false
    const r=await this.pool.query(`UPDATE users SET channel=$2,updated_at=now() WHERE id=$1 AND channel<>$2`,[userId,channel])
    return (r.rowCount??0)>0
  }

  // 中转站客户的会员时长跟 AI 套餐走（业主 2026-09-30）：单独一行 source='aigw'（普通会员），到期时间 = POWER云
  // 「AI 代理套餐」最晚到期；不和自购 / 兑换 / 后台发的会员合并——AI 到期只有这一行到期，自己买的照常。
  // 反过来 grantWithinTx / extendLicense 也永远不碰 source='aigw' 这一行（否则买的时长会被下一次同步截掉）。
  // until 为 null 或已过期：把这一行结束在现在（不删，留账）。返回这一行现在的到期时间（没有 = null）。
  async syncAigwLicense(userId:string,until:Date|null):Promise<{changed:boolean;expiresAt:Date|null}>{
    const client=await this.pool.connect()
    try{
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`aigw-license:${userId}`])
      const plan=(await client.query(`SELECT id FROM plans WHERE code='standard-month'`)).rows[0]
      if(!plan)throw new Error('standard-month plan missing')
      const row=(await client.query(`SELECT id,status,expires_at AS "expiresAt" FROM licenses WHERE user_id=$1 AND source='aigw' ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,[userId])).rows[0] as {id:string;status:string;expiresAt:Date}|undefined
      const now=new Date()
      let changed=false,expiresAt:Date|null=row?.expiresAt??null
      if(until&&until.getTime()>now.getTime()){
        if(!row){
          await client.query(`INSERT INTO licenses(user_id,plan_id,starts_at,expires_at,source) VALUES($1,$2,$3,$4,'aigw')`,[userId,plan.id,now,until])
          changed=true
        }else if(row.status!=='active'||row.expiresAt.getTime()!==until.getTime()){
          await client.query(`UPDATE licenses SET status='active',expires_at=$2,plan_id=$3 WHERE id=$1`,[row.id,until,plan.id])
          changed=true
        }
        expiresAt=until
      }else if(row&&row.status==='active'){
        // AI 到期：这一行结束（标 expired，别再被当成可合并的有效会员）
        await client.query(`UPDATE licenses SET status='expired',expires_at=least(expires_at,$2) WHERE id=$1`,[row.id,now])
        changed=true
        expiresAt=now
      }
      await client.query('COMMIT')
      return {changed,expiresAt}
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }

  // 这个 POWER云 账号关联的是不是这个 ProxySplit 用户
  async identityOwner(provider:string,externalId:string):Promise<string|null>{
    const r=await this.pool.query('SELECT user_id FROM user_identities WHERE provider=$1 AND external_id=$2',[provider,externalId])
    return r.rows[0]?.user_id??null
  }

  // 首次用客户端登录时补发试用：官网注册的账号没有设备信息，登录时才知道硬件。
  // 仍遵守「一台设备只发一次试用」「一个账号只领一次试用」。
  async claimTrialOnLogin(userId:string,hardwareHash:string,ip:string){
    if(!hardwareHash)return null
    const client=await this.pool.connect()
    try{
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[hardwareHash])
      const settings=await client.query(`SELECT key,value FROM system_settings WHERE key IN ('trial_days','trial_plan_code')`)
      const map=new Map(settings.rows.map(x=>[x.key,x.value]))
      const trialDays=Number(map.get('trial_days')??3)
      if(!(trialDays>0)){await client.query('ROLLBACK');return null}
      const user=(await client.query('SELECT id,trial_started_at FROM users WHERE id=$1 FOR UPDATE',[userId])).rows[0]
      if(!user||user.trial_started_at){await client.query('ROLLBACK');return null}
      const claimed=await client.query('SELECT 1 FROM trial_claims WHERE hardware_hash=$1',[hardwareHash])
      if(claimed.rowCount){await client.query('ROLLBACK');return null}
      // 已有有效授权（付费/兑换）时不再发试用。
      const active=await client.query(`SELECT 1 FROM licenses WHERE user_id=$1 AND status='active' AND expires_at>now()`,[userId])
      if(active.rowCount){await client.query('ROLLBACK');return null}
      const plan=(await client.query('SELECT id FROM plans WHERE code=$1 AND active=true',[String(map.get('trial_plan_code')??'trial')])).rows[0]
      if(!plan){await client.query('ROLLBACK');return null}
      const now=new Date(),trialEnds=new Date(now.getTime()+trialDays*86400000)
      await client.query(`INSERT INTO licenses(user_id,plan_id,starts_at,expires_at,source) VALUES($1,$2,$3,$4,'trial')`,[userId,plan.id,now,trialEnds])
      await client.query(`INSERT INTO trial_claims(hardware_hash,user_id,expires_at,ip_hash) VALUES($1,$2,$3,$4)`,
        [hardwareHash,userId,trialEnds,sha256('proxysplit-ip-v1:'+ip)])
      await client.query(`UPDATE users SET trial_started_at=$2,trial_ends_at=$3 WHERE id=$1`,[userId,now,trialEnds])
      await client.query('COMMIT')
      return {trialDays,trialEndsAt:trialEnds}
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }

  async bindDevice(userId:string,fingerprintHash:string,hardwareHash:string,name:string,platform:string,appVersion:string,maxDevices:number):Promise<DeviceRecord>{
    const client=await this.pool.connect()
    try{
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[userId])
      const existing=await client.query(`SELECT id,user_id AS "userId",fingerprint_hash AS "fingerprintHash",hardware_hash AS "hardwareHash",
        name,platform,app_version AS "appVersion",revoked FROM devices WHERE user_id=$1 AND fingerprint_hash=$2 AND revoked=false`,[userId,fingerprintHash])
      let row:DeviceRecord
      if(existing.rows[0]){
        const r=await client.query(`UPDATE devices SET hardware_hash=$2,name=$3,platform=$4,app_version=$5,last_seen_at=now()
          WHERE id=$1 RETURNING id,user_id AS "userId",fingerprint_hash AS "fingerprintHash",hardware_hash AS "hardwareHash",name,platform,app_version AS "appVersion",revoked`,
          [existing.rows[0].id,hardwareHash,name,platform,appVersion])
        row=r.rows[0]
      }else{
        const count=await client.query('SELECT count(*)::int AS n FROM devices WHERE user_id=$1 AND revoked=false',[userId])
        if(count.rows[0].n>=maxDevices)throw new Error('DEVICE_LIMIT')
        const r=await client.query(`INSERT INTO devices(user_id,fingerprint_hash,hardware_hash,name,platform,app_version)
          VALUES($1,$2,$3,$4,$5,$6)
          RETURNING id,user_id AS "userId",fingerprint_hash AS "fingerprintHash",hardware_hash AS "hardwareHash",name,platform,app_version AS "appVersion",revoked`,
          [userId,fingerprintHash,hardwareHash,name,platform,appVersion])
        row=r.rows[0]
      }
      await client.query('COMMIT')
      return row
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }
  async touchDevice(id:string,appVersion:string){await this.pool.query('UPDATE devices SET app_version=$2,last_seen_at=now() WHERE id=$1 AND revoked=false',[id,appVersion])}
  async findDevice(id:string):Promise<DeviceRecord|null>{
    const r=await this.pool.query(`SELECT id,user_id AS "userId",fingerprint_hash AS "fingerprintHash",hardware_hash AS "hardwareHash",
      name,platform,app_version AS "appVersion",revoked FROM devices WHERE id=$1`,[id])
    return r.rows[0]??null
  }
  async isDeviceWithinLimit(userId:string,deviceId:string,maxDevices:number){
    const r=await this.pool.query(`SELECT EXISTS(
      SELECT 1 FROM (
        SELECT id FROM devices WHERE user_id=$1 AND revoked=false ORDER BY first_seen_at,id LIMIT $3
      ) allowed WHERE id=$2
    ) AS allowed`,[userId,deviceId,maxDevices])
    return r.rows[0]?.allowed===true
  }
  async listUserDevices(userId:string){
    const r=await this.pool.query(`SELECT id,name,platform,app_version AS "appVersion",first_seen_at AS "firstSeenAt",
      last_seen_at AS "lastSeenAt" FROM devices WHERE user_id=$1 AND revoked=false ORDER BY last_seen_at DESC`,[userId])
    return r.rows
  }
  async unbindDevice(id:string,userId?:string){
    const client=await this.pool.connect()
    try{
      await client.query('BEGIN')
      const params=userId?[id,userId]:[id]
      const where=userId?'id=$1 AND user_id=$2':'id=$1'
      const row=await client.query(`SELECT user_id AS "userId" FROM devices WHERE ${where} AND revoked=false FOR UPDATE`,params)
      if(!row.rows[0]){await client.query('ROLLBACK');return null}
      await client.query('UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE device_id=$1',[id])
      await client.query('DELETE FROM devices WHERE id=$1',[id])
      await client.query('COMMIT')
      return row.rows[0]
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }

  async createSession(v:{userId:string;deviceId:string;familyId:string;jti:string;tokenHash:string;expiresAt:Date}){
    await this.pool.query('INSERT INTO sessions(user_id,device_id,family_id,jti,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[v.userId,v.deviceId,v.familyId,v.jti,v.tokenHash,v.expiresAt])
  }
  async findSession(jti:string):Promise<SessionRecord|null>{
    const r=await this.pool.query(`SELECT s.jti,s.family_id AS "familyId",s.user_id AS "userId",s.device_id AS "deviceId",
      s.token_hash AS "tokenHash",s.consumed_at AS "consumedAt",s.revoked_at AS "revokedAt",s.expires_at AS "expiresAt",
      d.fingerprint_hash AS "fingerprintHash" FROM sessions s JOIN devices d ON d.id=s.device_id WHERE s.jti=$1`,[jti])
    return r.rows[0]??null
  }
  async consumeSession(jti:string){const r=await this.pool.query('UPDATE sessions SET consumed_at=now() WHERE jti=$1 AND consumed_at IS NULL AND revoked_at IS NULL RETURNING jti',[jti]);return r.rowCount===1}
  async revokeFamily(familyId:string){await this.pool.query('UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE family_id=$1',[familyId])}
  async rotateSessionAtomic(input:{
    oldJti:string;familyId:string;oldTokenHash:string;fingerprintHash:string;
    newJti:string;newTokenHash:string;expiresAt:Date
  }){
    const client=await this.pool.connect()
    try{
      await client.query('BEGIN')
      const session=(await client.query(`SELECT s.jti,s.family_id AS "familyId",s.user_id AS "userId",s.device_id AS "deviceId",
        s.token_hash AS "tokenHash",s.consumed_at AS "consumedAt",s.revoked_at AS "revokedAt",s.expires_at AS "expiresAt",
        d.fingerprint_hash AS "fingerprintHash" FROM sessions s JOIN devices d ON d.id=s.device_id
        WHERE s.jti=$1 FOR UPDATE OF s`,[input.oldJti])).rows[0]
      if(!session){await client.query('ROLLBACK');return {ok:false,reason:'invalid'} as const}
      // The successor of a consumed token is the session inserted by that very
      // rotation: same transaction, so created_at equals the parent's consumed_at.
      const successor=session.consumedAt?(await client.query(`SELECT jti,consumed_at AS "consumedAt",revoked_at AS "revokedAt"
        FROM sessions WHERE family_id=$1 AND jti<>$2 AND created_at=(SELECT consumed_at FROM sessions WHERE jti=$2) FOR UPDATE`,
        [session.familyId,input.oldJti])).rows[0]??null:null
      const verdict=classifyRefresh(session,{familyId:input.familyId,tokenHash:input.oldTokenHash,fingerprintHash:input.fingerprintHash},successor,new Date())
      if(verdict==='replay'){
        await client.query('UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE family_id=$1',[session.familyId])
        await client.query('COMMIT')
        return {ok:false,reason:'replay'} as const
      }
      if(verdict==='device'){
        await client.query('ROLLBACK')
        return {ok:false,reason:'device'} as const
      }
      // Lost response: the unused successor never reached the client; retire it
      // and rotate again from the token the client still holds.
      if(verdict==='retry')await client.query('UPDATE sessions SET revoked_at=now() WHERE jti=$1',[successor.jti])
      await client.query('UPDATE sessions SET consumed_at=now() WHERE jti=$1',[input.oldJti])
      await client.query(`INSERT INTO sessions(user_id,device_id,family_id,jti,token_hash,expires_at)
        VALUES($1,$2,$3,$4,$5,$6)`,[session.userId,session.deviceId,session.familyId,input.newJti,input.newTokenHash,input.expiresAt])
      await client.query('COMMIT')
      return {ok:true,userId:session.userId as string,deviceId:session.deviceId as string} as const
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }
  async recordLoginFailure(userId:string){
    const r=await this.pool.query(`UPDATE users SET
      failed_login_count=CASE WHEN failed_login_count+1>=5 THEN 0 ELSE failed_login_count+1 END,
      lockout_level=CASE WHEN failed_login_count+1>=5 THEN lockout_level+1 ELSE lockout_level END,
      locked_until=CASE WHEN failed_login_count+1>=5 THEN now()+((lockout_level+1)*5)*interval '1 minute' ELSE locked_until END,
      updated_at=now() WHERE id=$1
      RETURNING failed_login_count AS "failedLoginCount",lockout_level AS "lockoutLevel",locked_until AS "lockedUntil"`,[userId])
    return r.rows[0]??null
  }
  async recordLoginSuccess(userId:string){await this.pool.query('UPDATE users SET failed_login_count=0,locked_until=NULL,updated_at=now() WHERE id=$1',[userId])}
  async audit(actor:string|null,action:string,targetType:string,targetId:string,ip:string,result:string,metadata:Record<string,unknown>={}){
    await this.pool.query('INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,ip,result,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)',[actor,action,targetType,targetId,ip,result,metadata])
  }

  // 返回指定通道的“最新版”。按语义版本(而非发布时间)取最高，避免误发一个更旧
  // 版本号后顶替真正的最新版；channel 隔离让 beta 不会被推给稳定版客户端。
  async latestRelease(channel:'stable'|'beta'='stable'):Promise<ReleaseRecord|null>{
    const r=await this.pool.query(`SELECT version,minimum_version AS "minimumVersion",url,sha256,signature,mandatory,title,summary,changelog,channel,published_at AS "publishedAt"
      FROM releases WHERE channel=$1
      ORDER BY string_to_array(version,'.')::int[] DESC,published_at DESC LIMIT 1`,[channel])
    return r.rows[0]??null
  }
  // 是否存在该版本号的正式发布（用于下载接口过滤伪造版本，避免污染下载统计）。
  async releaseExists(version:string):Promise<boolean>{
    if(!version)return false
    const r=await this.pool.query('SELECT 1 FROM releases WHERE version=$1 LIMIT 1',[version])
    return !!r.rowCount
  }
  async dashboard(){
    const r=await this.pool.query(`SELECT
      (SELECT count(*)::int FROM users) users,
      (SELECT count(*)::int FROM licenses WHERE status='active' AND expires_at>now()) licenses,
      (SELECT count(*)::int FROM devices WHERE revoked=false AND last_seen_at>now()-interval '15 minutes') online,
      (SELECT count(*)::int FROM licenses WHERE status='active' AND expires_at BETWEEN now() AND now()+interval '7 days') expiring,
      (SELECT count(*)::int FROM orders WHERE status='pending') AS "pendingOrders",
      (SELECT coalesce(sum(amount_cents),0)::int FROM orders WHERE status='paid' AND paid_at>=date_trunc('month',now())) AS "monthRevenue"`)
    return r.rows[0]
  }
  async listUsers(params:Partial<UserListQuery>={}):Promise<ListResult<any>>{
    const conds:string[]=[];const vals:unknown[]=[];let i=1
    if(params.q){vals.push(`%${params.q}%`);conds.push(`(u.username ILIKE $${i} OR u.email ILIKE $${i} OR u.note ILIKE $${i})`);i++}
    if(params.status){vals.push(params.status);conds.push(`u.status::text=$${i}`);i++}
    if(params.role){vals.push(params.role);conds.push(`u.role::text=$${i}`);i++}
    if(params.tier){vals.push(params.tier);conds.push(`p.tier=$${i}`);i++}
    if(params.membership==='active')conds.push(`l.id IS NOT NULL`)
    else if(params.membership==='expired')conds.push(`l.id IS NULL`)
    else if(params.membership==='expiring')conds.push(`l.id IS NOT NULL AND l.lifetime=false AND l.expires_at<=now()+interval '7 days'`)
    if(params.createdFrom){vals.push(params.createdFrom);conds.push(`u.created_at>=$${i}`);i++}
    if(params.createdTo){vals.push(params.createdTo);conds.push(`u.created_at<=$${i}`);i++}
    const where=conds.length?`WHERE ${conds.join(' AND ')}`:''
    const orderBy=orderClause(params.sort,params.order,{createdAt:'u.created_at',username:'u.username',email:'u.email',status:'u.status',role:'u.role',expiresAt:'l.expires_at'},'u.created_at DESC')
    const limit=pageLimit(params.limit),offset=pageOffset(params.offset)
    vals.push(limit,offset)
    const r=await this.pool.query(`SELECT u.id,u.username,u.email,u.role,u.status,u.note,u.created_at AS "createdAt",
      l.expires_at AS "expiresAt",l.lifetime,p.name AS "planName",p.tier,
      (SELECT count(*)::int FROM devices d WHERE d.user_id=u.id AND d.revoked=false) AS devices,
      (u.password_hash IS NOT NULL) AS "hasPassword",
      coalesce((SELECT array_agg(i.provider ORDER BY i.provider) FROM user_identities i WHERE i.user_id=u.id),'{}') AS identities,u.channel,
      (count(*) OVER())::int AS "totalCount"
      FROM users u LEFT JOIN LATERAL (
        SELECT * FROM licenses WHERE user_id=u.id AND status='active' AND expires_at>now() ORDER BY lifetime DESC,expires_at DESC LIMIT 1
      ) l ON true LEFT JOIN plans p ON p.id=l.plan_id
      ${where} ORDER BY ${orderBy} LIMIT $${i} OFFSET $${i+1}`,vals)
    const total=r.rows[0]?Number(r.rows[0].totalCount):0
    const items=r.rows.map(({totalCount,...rest}:{totalCount:number})=>rest)
    return {items,total,limit,offset}
  }
  // 管理后台专用聚合视图：只返回运营必要信息，绝不返回密码、令牌、原始硬件序列号或指纹哈希。
  async getUserDetail(userId:string){
    const [user,licenses,devices,orders,activity,stats]=await Promise.all([
      this.pool.query(`SELECT id,username,email,role,status,note,created_at AS "createdAt",updated_at AS "updatedAt",
        trial_started_at AS "trialStartedAt",trial_ends_at AS "trialEndsAt" FROM users WHERE id=$1`,[userId]),
      this.pool.query(`SELECT l.id,l.status,l.starts_at AS "startsAt",l.expires_at AS "expiresAt",l.created_at AS "createdAt",
        l.source,l.lifetime,p.code AS "planCode",p.name AS "planName",p.tier,p.max_devices AS "maxDevices",p.features
        FROM licenses l JOIN plans p ON p.id=l.plan_id WHERE l.user_id=$1 ORDER BY l.expires_at DESC LIMIT 100`,[userId]),
      this.pool.query(`SELECT d.id,d.name,d.platform,d.app_version AS "appVersion",d.revoked,d.first_seen_at AS "firstSeenAt",d.last_seen_at AS "lastSeenAt",
        (SELECT count(*)::int FROM sessions s WHERE s.device_id=d.id AND s.revoked_at IS NULL AND s.expires_at>now()) AS "activeSessions"
        FROM devices d WHERE d.user_id=$1 ORDER BY d.last_seen_at DESC LIMIT 100`,[userId]),
      this.pool.query(`SELECT order_no AS "orderNo",plan_name AS "planName",tier,billing_cycle AS "billingCycle",duration_days AS "durationDays",
        lifetime,amount_cents AS "amountCents",currency,status,provider_code AS "providerCode",provider_order_no AS "providerOrderNo",
        paid_at AS "paidAt",expires_at AS "expiresAt",created_at AS "createdAt" FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`,[userId]),
      this.pool.query(`SELECT action,target_type AS "targetType",target_id AS "targetId",ip,result,metadata,created_at AS "createdAt"
        FROM audit_logs WHERE actor_user_id=$1 OR (target_type='user' AND target_id=$1::text) ORDER BY created_at DESC LIMIT 100`,[userId]),
      this.pool.query(`SELECT
        (SELECT count(*)::int FROM devices WHERE user_id=$1 AND revoked=false) AS "activeDevices",
        (SELECT count(*)::int FROM orders WHERE user_id=$1 AND status='paid') AS "paidOrders",
        (SELECT coalesce(sum(amount_cents),0)::int FROM orders WHERE user_id=$1 AND status='paid') AS "paidAmountCents"`,[userId]),
    ])
    if(!user.rows[0])return null
    return {user:user.rows[0],licenses:licenses.rows,devices:devices.rows,orders:orders.rows,activity:activity.rows,stats:stats.rows[0]}
  }
  async createUserWithLicense(input:{username:string;passwordHash:string;role:string;planId?:string;days:number}){
    const c=await this.pool.connect()
    try{
      await c.query('BEGIN')
      const u=await c.query('INSERT INTO users(username,password_hash,role) VALUES($1,$2,$3) RETURNING id,username,role,status',[input.username,input.passwordHash,input.role])
      const p=input.planId?await c.query('SELECT id FROM plans WHERE id=$1',[input.planId]):await c.query(`SELECT id FROM plans WHERE code='standard-month'`)
      if(!p.rows[0])throw new Error('PLAN_NOT_FOUND')
      await c.query(`INSERT INTO licenses(user_id,plan_id,expires_at,source) VALUES($1,$2,now()+($3||' days')::interval,'admin')`,[u.rows[0].id,p.rows[0].id,input.days])
      await c.query('COMMIT')
      return u.rows[0]
    }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
  }
  async setUserStatus(id:string,status:string){
    const r=await this.pool.query('UPDATE users SET status=$2,updated_at=now() WHERE id=$1 RETURNING id',[id,status])
    if(status!=='active')await this.pool.query('UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1',[id])
    return r.rowCount===1
  }
  async setUserPassword(id:string,passwordHash:string){
    const client=await this.pool.connect()
    try{
      await client.query('BEGIN')
      const r=await client.query('UPDATE users SET password_hash=$2,failed_login_count=0,locked_until=NULL,updated_at=now() WHERE id=$1 RETURNING id',[id,passwordHash])
      if(r.rowCount)await client.query('UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1',[id])
      await client.query('COMMIT')
      return r.rowCount===1
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }
  async extendLicense(userId:string,days:number){
    const r=await this.pool.query(`UPDATE licenses SET expires_at=greatest(expires_at,now())+($2||' days')::interval,status='active'
      WHERE id=(SELECT id FROM licenses WHERE user_id=$1 AND source<>'aigw' ORDER BY expires_at DESC LIMIT 1) RETURNING id,expires_at AS "expiresAt"`,[userId,days])
    return r.rows[0]??null
  }
  async listDevices(params:Partial<DeviceListQuery>={}):Promise<ListResult<any>>{
    const conds:string[]=[];const vals:unknown[]=[];let i=1
    if(params.q){vals.push(`%${params.q}%`);conds.push(`(d.name ILIKE $${i} OR u.username ILIKE $${i} OR d.fingerprint_hash ILIKE $${i})`);i++}
    if(params.platform){vals.push(params.platform);conds.push(`d.platform=$${i}`);i++}
    if(params.revoked!==undefined){vals.push(params.revoked);conds.push(`d.revoked=$${i}`);i++}
    if(params.online!==undefined)conds.push(params.online?`d.last_seen_at>now()-interval '15 minutes'`:`d.last_seen_at<=now()-interval '15 minutes'`)
    if(params.appVersion){vals.push(params.appVersion);conds.push(`d.app_version=$${i}`);i++}
    const where=conds.length?`WHERE ${conds.join(' AND ')}`:''
    const orderBy=orderClause(params.sort,params.order,{lastSeenAt:'d.last_seen_at',firstSeenAt:'d.first_seen_at',name:'d.name',platform:'d.platform',username:'u.username',appVersion:'d.app_version'},'d.last_seen_at DESC')
    const limit=pageLimit(params.limit),offset=pageOffset(params.offset)
    vals.push(limit,offset)
    const r=await this.pool.query(`SELECT d.id,d.user_id AS "userId",u.username,d.name,d.platform,d.app_version AS "appVersion",
      d.revoked,d.first_seen_at AS "firstSeenAt",d.last_seen_at AS "lastSeenAt",
      (count(*) OVER())::int AS "totalCount"
      FROM devices d JOIN users u ON u.id=d.user_id
      ${where} ORDER BY ${orderBy} LIMIT $${i} OFFSET $${i+1}`,vals)
    const total=r.rows[0]?Number(r.rows[0].totalCount):0
    const items=r.rows.map(({totalCount,...rest}:{totalCount:number})=>rest)
    return {items,total,limit,offset}
  }
  async listReleases(params:Partial<ReleaseListQuery>={}):Promise<ListResult<any>>{
    const conds:string[]=[];const vals:unknown[]=[];let i=1
    if(params.q){vals.push(`%${params.q}%`);conds.push(`(version ILIKE $${i} OR title ILIKE $${i} OR summary ILIKE $${i})`);i++}
    if(params.channel){vals.push(params.channel);conds.push(`channel=$${i}`);i++}
    if(params.mandatory!==undefined){vals.push(params.mandatory);conds.push(`mandatory=$${i}`);i++}
    const where=conds.length?`WHERE ${conds.join(' AND ')}`:''
    const orderBy=orderClause(params.sort,params.order,{publishedAt:'published_at',version:'version',channel:'channel'},'published_at DESC')
    const limit=pageLimit(params.limit),offset=pageOffset(params.offset)
    vals.push(limit,offset)
    const r=await this.pool.query(`SELECT id,version,minimum_version AS "minimumVersion",url,sha256,signature,mandatory,title,summary,changelog,channel,
      published_at AS "publishedAt",(count(*) OVER())::int AS "totalCount"
      FROM releases ${where} ORDER BY ${orderBy} LIMIT $${i} OFFSET $${i+1}`,vals)
    const total=r.rows[0]?Number(r.rows[0].totalCount):0
    const items=r.rows.map(({totalCount,...rest}:{totalCount:number})=>rest)
    return {items,total,limit,offset}
  }
  async createRelease(v:{version:string;minimumVersion:string;url:string;sha256:string;signature:string;mandatory:boolean;title:string;summary:string;changelog:string;channel:string}){
    const r=await this.pool.query('INSERT INTO releases(version,minimum_version,url,sha256,signature,mandatory,title,summary,changelog,channel) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,version',[v.version,v.minimumVersion,v.url,v.sha256,v.signature,v.mandatory,v.title,v.summary,v.changelog,v.channel])
    return r.rows[0]
  }
  async listAudit(params:Partial<AuditListQuery>={}):Promise<ListResult<any>>{
    const conds:string[]=[];const vals:unknown[]=[];let i=1
    if(params.q){vals.push(`%${params.q}%`);conds.push(`(a.action ILIKE $${i} OR a.target_type ILIKE $${i} OR a.target_id ILIKE $${i})`);i++}
    if(params.action){vals.push(params.action);conds.push(`a.action=$${i}`);i++}
    if(params.targetType){vals.push(params.targetType);conds.push(`a.target_type=$${i}`);i++}
    if(params.result){vals.push(params.result);conds.push(`a.result=$${i}`);i++}
    if(params.actor){vals.push(`%${params.actor}%`,params.actor);conds.push(`(u.username ILIKE $${i} OR a.actor_user_id::text=$${i+1})`);i+=2}
    if(params.from){vals.push(params.from);conds.push(`a.created_at>=$${i}`);i++}
    if(params.to){vals.push(params.to);conds.push(`a.created_at<=$${i}`);i++}
    const where=conds.length?`WHERE ${conds.join(' AND ')}`:''
    const orderBy=orderClause(params.sort,params.order,{createdAt:'a.created_at',action:'a.action',result:'a.result',targetType:'a.target_type'},'a.created_at DESC')
    const limit=pageLimit(params.limit),offset=pageOffset(params.offset)
    vals.push(limit,offset)
    const r=await this.pool.query(`SELECT a.id,a.action,a.target_type AS "targetType",a.target_id AS "targetId",a.ip,a.result,a.metadata,
      a.created_at AS "createdAt",u.username AS actor,(count(*) OVER())::int AS "totalCount"
      FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id
      ${where} ORDER BY ${orderBy} LIMIT $${i} OFFSET $${i+1}`,vals)
    const total=r.rows[0]?Number(r.rows[0].totalCount):0
    const items=r.rows.map(({totalCount,...rest}:{totalCount:number})=>rest)
    return {items,total,limit,offset}
  }

  // Serves both the public catalog (publicOnly, returns the full active set) and
  // the admin console (filtered + paged). Always returns the {items,total,...}
  // envelope; the public route reads `.items`.
  async listPlans(params:Partial<PlanListQuery>&{publicOnly?:boolean}={}):Promise<ListResult<any>>{
    const conds:string[]=[];const vals:unknown[]=[];let i=1
    if(params.publicOnly)conds.push(`active=true AND public=true AND (sale_starts_at IS NULL OR sale_starts_at<=now()) AND (sale_ends_at IS NULL OR sale_ends_at>now())`)
    if(params.q){vals.push(`%${params.q}%`);conds.push(`(code ILIKE $${i} OR name ILIKE $${i} OR description ILIKE $${i})`);i++}
    if(params.tier){vals.push(params.tier);conds.push(`tier=$${i}`);i++}
    if(params.active!==undefined){vals.push(params.active);conds.push(`active=$${i}`);i++}
    if(params.public!==undefined){vals.push(params.public);conds.push(`public=$${i}`);i++}
    if(params.billingCycle){vals.push(params.billingCycle);conds.push(`billing_cycle=$${i}`);i++}
    const where=conds.length?`WHERE ${conds.join(' AND ')}`:''
    const orderBy=orderClause(params.sort,params.order,{sortOrder:'sort_order',name:'name',priceCents:'price_cents',createdAt:'created_at',updatedAt:'updated_at',code:'code',tier:'tier'},'sort_order ASC,name ASC')
    const limit=pageLimit(params.limit),offset=pageOffset(params.offset)
    vals.push(limit,offset)
    const r=await this.pool.query(`SELECT id,code,name,description,tier,billing_cycle AS "billingCycle",duration_days AS "durationDays",
      lifetime,price_cents AS "priceCents",original_price_cents AS "originalPriceCents",currency,max_devices AS "maxDevices",features,active,public,sort_order AS "sortOrder",badge,
      sale_starts_at AS "saleStartsAt",sale_ends_at AS "saleEndsAt",purchase_limit_per_user AS "purchaseLimitPerUser",
      created_at AS "createdAt",updated_at AS "updatedAt",(count(*) OVER())::int AS "totalCount"
      FROM plans ${where} ORDER BY ${orderBy} LIMIT $${i} OFFSET $${i+1}`,vals)
    const total=r.rows[0]?Number(r.rows[0].totalCount):0
    const items=r.rows.map(({totalCount,...rest}:{totalCount:number})=>rest)
    return {items,total,limit,offset}
  }
  async createPlan(v:PlanUpsertInput){
    const r=await this.pool.query(`INSERT INTO plans(code,name,description,tier,billing_cycle,duration_days,lifetime,price_cents,original_price_cents,currency,max_devices,features,active,public,sort_order,badge,sale_starts_at,sale_ends_at,purchase_limit_per_user)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id,code`,
      [v.code,v.name,v.description,v.tier,v.billingCycle,v.durationDays??null,v.lifetime,v.priceCents,v.originalPriceCents??null,v.currency,v.maxDevices,JSON.stringify(v.features),v.active,v.public,v.sortOrder,v.badge,v.saleStartsAt??null,v.saleEndsAt??null,v.purchaseLimitPerUser??null])
    return r.rows[0]
  }
  async updatePlan(id:string,v:PlanPatchInput){
    const current=(await this.pool.query('SELECT * FROM plans WHERE id=$1',[id])).rows[0]
    if(!current)return null
    const merged={
      name:v.name??current.name,description:v.description??current.description,tier:v.tier??current.tier,
      billingCycle:v.billingCycle??current.billing_cycle,durationDays:v.durationDays===undefined?current.duration_days:v.durationDays,
      lifetime:v.lifetime??current.lifetime,priceCents:v.priceCents??current.price_cents,originalPriceCents:v.originalPriceCents===undefined?current.original_price_cents:v.originalPriceCents,currency:v.currency??current.currency,
      maxDevices:v.maxDevices??current.max_devices,features:v.features??current.features,active:v.active??current.active,
      public:v.public??current.public,sortOrder:v.sortOrder??current.sort_order,badge:v.badge??current.badge,
      saleStartsAt:v.saleStartsAt===undefined?current.sale_starts_at:v.saleStartsAt,saleEndsAt:v.saleEndsAt===undefined?current.sale_ends_at:v.saleEndsAt,
      purchaseLimitPerUser:v.purchaseLimitPerUser===undefined?current.purchase_limit_per_user:v.purchaseLimitPerUser,
    }
    validatePlanTerms(merged)
    const criticalChanged=current.tier!==merged.tier||current.billing_cycle!==merged.billingCycle||
      Number(current.duration_days)!==Number(merged.durationDays)||current.lifetime!==merged.lifetime||
      current.max_devices!==merged.maxDevices||JSON.stringify(current.features)!==JSON.stringify(merged.features)
    if(criticalChanged){
      const referenced=await this.pool.query(`SELECT EXISTS(
        SELECT 1 FROM orders WHERE plan_id=$1 UNION ALL SELECT 1 FROM licenses WHERE plan_id=$1
      ) AS used`,[id])
      if(referenced.rows[0]?.used)throw new AppError('PLAN_TERMS_IMMUTABLE','已有订单或授权的套餐不能修改等级、周期、设备数或权益，请新建套餐',409)
    }
    const r=await this.pool.query(`UPDATE plans SET name=$2,description=$3,tier=$4,billing_cycle=$5,duration_days=$6,lifetime=$7,
      price_cents=$8,original_price_cents=$9,currency=$10,max_devices=$11,features=$12,active=$13,public=$14,sort_order=$15,badge=$16,
      sale_starts_at=$17,sale_ends_at=$18,purchase_limit_per_user=$19,updated_at=now()
      WHERE id=$1 RETURNING id,code`,[id,merged.name,merged.description,merged.tier,merged.billingCycle,merged.durationDays,
      merged.lifetime,merged.priceCents,merged.originalPriceCents,merged.currency,merged.maxDevices,JSON.stringify(merged.features),merged.active,merged.public,merged.sortOrder,merged.badge,merged.saleStartsAt,merged.saleEndsAt,merged.purchaseLimitPerUser])
    return r.rows[0]??null
  }

  async listProviders(){
    const r=await this.pool.query(`SELECT code,display_name AS "displayName",adapter,endpoint,merchant_id AS "merchantId",
      credential_ref AS "credentialRef",config,enabled,updated_at AS "updatedAt" FROM payment_providers ORDER BY display_name`)
    return r.rows as PaymentProviderRecord[]
  }
  async getProvider(code:string):Promise<PaymentProviderRecord|null>{
    const r=await this.pool.query(`SELECT code,display_name AS "displayName",adapter,endpoint,merchant_id AS "merchantId",
      credential_ref AS "credentialRef",config,enabled FROM payment_providers WHERE code=$1`,[code])
    return r.rows[0]??null
  }
  async upsertProvider(v:ProviderUpsertInput){
    const r=await this.pool.query(`INSERT INTO payment_providers(code,display_name,adapter,endpoint,merchant_id,credential_ref,config,enabled)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(code) DO UPDATE SET display_name=excluded.display_name,adapter=excluded.adapter,
      endpoint=excluded.endpoint,merchant_id=excluded.merchant_id,credential_ref=excluded.credential_ref,config=excluded.config,enabled=excluded.enabled,updated_at=now()
      RETURNING code`,[v.code,v.displayName,v.adapter,v.endpoint,v.merchantId,v.credentialRef,JSON.stringify(v.config),v.enabled])
    return r.rows[0]
  }

  // Create the order(s) for a checkout. Plans whose price exceeds the split cap
  // return a group of sub-orders (paid separately); everything else returns one.
  async createOrders(userId:string,planId:string):Promise<OrderRecord[]>{
    const settings=await this.getCommerceSettings()
    const provider=await this.getProvider(settings.activePaymentProvider)
    if(!provider||!provider.enabled)throw new Error('PAYMENT_UNAVAILABLE')
    const configuredTimeout=Number(provider.config.orderTimeoutMinutes)
    const timeoutMinutes=Number.isFinite(configuredTimeout)?Math.min(60,Math.max(5,Math.floor(configuredTimeout))):10
    const expiresAt=new Date(Date.now()+timeoutMinutes*60_000)
    const client=await this.pool.connect()
    try{
      await client.query('BEGIN')
      // Serialize purchases of the same plan for one user. Without this lock,
      // two simultaneous requests can both pass a one-time purchase limit.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`purchase:${userId}:${planId}`])
      const plan=(await client.query(`SELECT id,name,tier,billing_cycle,duration_days,lifetime,price_cents,currency,purchase_limit_per_user
        FROM plans WHERE id=$1 AND active=true AND public=true AND (sale_starts_at IS NULL OR sale_starts_at<=now()) AND (sale_ends_at IS NULL OR sale_ends_at>now())`,[planId])).rows[0]
      if(!plan)throw new Error('PLAN_NOT_AVAILABLE')
      const resumed=await this.resumeSplitInTx(client,userId,planId,expiresAt)
      if(resumed){
        await client.query('COMMIT')
        return resumed
      }
      if(plan.purchase_limit_per_user){
        // A split checkout creates several sub-orders; count order GROUPS, not rows.
        const count=await client.query(`SELECT count(DISTINCT coalesce(group_id,id))::int AS n FROM orders
          WHERE user_id=$1 AND plan_id=$2 AND (status='paid' OR (status='pending' AND expires_at>now()))`,[userId,planId])
        if(count.rows[0].n>=plan.purchase_limit_per_user)throw new Error('PURCHASE_LIMIT')
      }
      const split=planSplit(plan.price_cents/100)
      if(split.kind==='tooLarge')throw new Error('AMOUNT_TOO_LARGE')
      const amounts=split.kind==='split'?split.pieces.map(p=>Math.round(p*100)):[plan.price_cents as number]
      const groupId=amounts.length>1?(await client.query('SELECT gen_random_uuid() AS id')).rows[0].id as string:null
      const ret=`RETURNING id,order_no AS "orderNo",user_id AS "userId",plan_id AS "planId",plan_name AS "planName",tier,billing_cycle AS "billingCycle",
        duration_days AS "durationDays",lifetime,amount_cents AS "amountCents",currency,status,provider_code AS "providerCode",
        provider_order_no AS "providerOrderNo",pay_url AS "payUrl",checkout_url AS "checkoutUrl",paid_at AS "paidAt",expires_at AS "expiresAt",created_at AS "createdAt",
        group_id AS "groupId",split_index AS "splitIndex",split_total AS "splitTotal"`
      const orders:OrderRecord[]=[]
      for(let i=0;i<amounts.length;i++){
        const r=await client.query(`INSERT INTO orders(order_no,user_id,plan_id,plan_name,tier,billing_cycle,duration_days,lifetime,amount_cents,currency,provider_code,expires_at,group_id,split_index,split_total)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ${ret}`,
          [orderNo(),userId,plan.id,plan.name,plan.tier,plan.billing_cycle,plan.duration_days,plan.lifetime,amounts[i],plan.currency,provider.code,expiresAt,groupId,groupId?i+1:null,groupId?amounts.length:null])
        orders.push(r.rows[0])
      }
      await client.query('COMMIT')
      return orders
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }
  // A split checkout the customer already started paying (some piece paid,
  // none refunded) is resumed instead of opening a new group: still-valid
  // pending pieces are returned as they are, expired / failed ones are closed
  // and re-issued under a new order number. Without this the paid pieces never
  // add up to a grant once the rest expire. Returns null when nothing to resume.
  private async resumeSplitInTx(client:TxClient,userId:string,planId:string,expiresAt:Date):Promise<OrderRecord[]|null>{
    const open=(await client.query(`SELECT group_id FROM orders WHERE user_id=$1 AND plan_id=$2 AND group_id IS NOT NULL AND created_at>now()-interval '30 days'
      GROUP BY group_id HAVING bool_or(status='paid') AND bool_or(status IN ('pending','failed')) AND NOT bool_or(status='refunded')
      ORDER BY max(created_at) DESC LIMIT 1`,[userId,planId])).rows[0] as {group_id:string}|undefined
    if(!open)return null
    const ret=`RETURNING id,order_no AS "orderNo",user_id AS "userId",plan_id AS "planId",plan_name AS "planName",tier,billing_cycle AS "billingCycle",
      duration_days AS "durationDays",lifetime,amount_cents AS "amountCents",currency,status,provider_code AS "providerCode",
      provider_order_no AS "providerOrderNo",pay_url AS "payUrl",checkout_url AS "checkoutUrl",paid_at AS "paidAt",expires_at AS "expiresAt",created_at AS "createdAt",
      group_id AS "groupId",split_index AS "splitIndex",split_total AS "splitTotal"`
    const pieces=(await client.query(`SELECT id,status,expires_at AS "expiresAt",pay_url AS "payUrl" FROM orders
      WHERE group_id=$1 AND status IN ('pending','failed') ORDER BY split_index FOR UPDATE`,[open.group_id])).rows as Array<{id:string;status:string;expiresAt:Date;payUrl:string|null}>
    const out:OrderRecord[]=[]
    for(const p of pieces){
      if(p.status==='pending'&&p.payUrl&&new Date(p.expiresAt).getTime()>Date.now()+60_000){
        out.push((await client.query(`UPDATE orders SET updated_at=now() WHERE id=$1 ${ret}`,[p.id])).rows[0])
        continue
      }
      await client.query(`UPDATE orders SET status='closed',updated_at=now() WHERE id=$1`,[p.id])
      out.push((await client.query(`INSERT INTO orders(order_no,user_id,plan_id,plan_name,tier,billing_cycle,duration_days,lifetime,amount_cents,currency,provider_code,expires_at,group_id,split_index,split_total)
        SELECT $2,user_id,plan_id,plan_name,tier,billing_cycle,duration_days,lifetime,amount_cents,currency,provider_code,$3,group_id,split_index,split_total
        FROM orders WHERE id=$1 ${ret}`,[p.id,orderNo(),expiresAt])).rows[0])
    }
    return out.length?out:null
  }
  async setOrderPayment(orderNoValue:string,providerOrderNo:string,payUrl:string,details:{checkoutUrl?:string|null;merchantName?:string|null}={}){
    const r=await this.pool.query(`UPDATE orders SET provider_order_no=$2,pay_url=$3,checkout_url=$4,merchant_name=$5,updated_at=now()
      WHERE order_no=$1 AND status='pending' RETURNING order_no AS "orderNo"`,[orderNoValue,providerOrderNo,payUrl,details.checkoutUrl??null,details.merchantName??null])
    return r.rows[0]??null
  }
  async failOrder(orderNoValue:string){
    await this.pool.query(`UPDATE orders SET status='failed',updated_at=now() WHERE order_no=$1 AND status='pending'`,[orderNoValue])
  }
  async getOrderForCallback(orderNoValue:string){
    const r=await this.pool.query(`SELECT order_no AS "orderNo",provider_code AS "providerCode",provider_order_no AS "providerOrderNo",
      amount_cents AS "amountCents",status FROM orders WHERE order_no=$1`,[orderNoValue])
    return r.rows[0]??null
  }
  async getOrderForUser(orderNoValue:string,userId:string){
    const r=await this.pool.query(`SELECT id,order_no AS "orderNo",plan_name AS "planName",tier,billing_cycle AS "billingCycle",
      amount_cents AS "amountCents",currency,status,provider_code AS "providerCode",provider_order_no AS "providerOrderNo",
      pay_url AS "payUrl",checkout_url AS "checkoutUrl",paid_at AS "paidAt",expires_at AS "expiresAt",created_at AS "createdAt"
      FROM orders WHERE order_no=$1 AND user_id=$2`,[orderNoValue,userId])
    return r.rows[0]??null
  }
  async listUserOrders(userId:string){
    const r=await this.pool.query(`SELECT order_no AS "orderNo",plan_name AS "planName",amount_cents AS "amountCents",currency,status,
      pay_url AS "payUrl",checkout_url AS "checkoutUrl",paid_at AS "paidAt",expires_at AS "expiresAt",created_at AS "createdAt",
      group_id AS "groupId",split_index AS "splitIndex",split_total AS "splitTotal"
      FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`,[userId])
    return r.rows
  }
  async listPendingPaymentOrders(limit=20){
    const safeLimit=Math.min(100,Math.max(1,Math.floor(limit)))
    const r=await this.pool.query(`SELECT order_no AS "orderNo" FROM orders
      WHERE created_at>now()-interval '7 days'
        AND ((status='pending' AND created_at<now()-interval '20 seconds')
          OR (status IN ('failed','closed') AND pay_url IS NOT NULL AND updated_at<now()-interval '5 minutes'))
      ORDER BY updated_at ASC LIMIT $1`,[safeLimit])
    return r.rows as Array<{orderNo:string}>
  }
  async touchPaymentReconciliation(orderNoValue:string){
    await this.pool.query(`UPDATE orders SET updated_at=now() WHERE order_no=$1 AND status IN ('pending','failed','closed')`,[orderNoValue])
  }
  async listOrders(params:Partial<OrderListQuery>={}):Promise<ListResult<any>&{amountSum:number}>{
    const conds:string[]=[];const vals:unknown[]=[];let i=1
    if(params.q){vals.push(`%${params.q}%`);conds.push(`(o.order_no ILIKE $${i} OR o.plan_name ILIKE $${i} OR u.username ILIKE $${i})`);i++}
    if(params.status){vals.push(params.status);conds.push(`o.status=$${i}`);i++}
    if(params.providerCode){vals.push(params.providerCode);conds.push(`o.provider_code=$${i}`);i++}
    if(params.tier){vals.push(params.tier);conds.push(`o.tier=$${i}`);i++}
    if(params.billingCycle){vals.push(params.billingCycle);conds.push(`o.billing_cycle=$${i}`);i++}
    if(params.paidFrom){vals.push(params.paidFrom);conds.push(`o.paid_at>=$${i}`);i++}
    if(params.paidTo){vals.push(params.paidTo);conds.push(`o.paid_at<=$${i}`);i++}
    if(params.createdFrom){vals.push(params.createdFrom);conds.push(`o.created_at>=$${i}`);i++}
    if(params.createdTo){vals.push(params.createdTo);conds.push(`o.created_at<=$${i}`);i++}
    const where=conds.length?`WHERE ${conds.join(' AND ')}`:''
    const orderBy=orderClause(params.sort,params.order,{createdAt:'o.created_at',paidAt:'o.paid_at',amountCents:'o.amount_cents',status:'o.status',username:'u.username',orderNo:'o.order_no'},'o.created_at DESC')
    const limit=pageLimit(params.limit),offset=pageOffset(params.offset)
    vals.push(limit,offset)
    // Window aggregates run over the full filtered set (before LIMIT), so total
    // and amountSum reflect every matched order, not just the current page.
    const r=await this.pool.query(`SELECT o.id,o.order_no AS "orderNo",u.username,o.plan_name AS "planName",o.tier,o.billing_cycle AS "billingCycle",
      o.amount_cents AS "amountCents",o.currency,o.status,o.provider_code AS "providerCode",o.provider_order_no AS "providerOrderNo",
      o.paid_at AS "paidAt",o.created_at AS "createdAt",
      (count(*) OVER())::int AS "totalCount",
      (coalesce(sum(o.amount_cents) FILTER (WHERE o.status='paid') OVER(),0))::bigint AS "amountSumAll"
      FROM orders o JOIN users u ON u.id=o.user_id
      ${where} ORDER BY ${orderBy} LIMIT $${i} OFFSET $${i+1}`,vals)
    const total=r.rows[0]?Number(r.rows[0].totalCount):0
    const amountSum=r.rows[0]?Number(r.rows[0].amountSumAll):0
    const items=r.rows.map(({totalCount,amountSumAll,...rest}:{totalCount:number;amountSumAll:number})=>rest)
    return {items,total,limit,offset,amountSum}
  }
  async fulfillPaidOrder(input:{providerCode:string;eventId:string;orderNo:string;amountCents:number;providerOrderNo:string;payloadHash:string;paidAt?:Date}){
    const client=await this.pool.connect()
    try{
      await client.query('BEGIN')
      const event=await client.query(`INSERT INTO payment_events(provider_code,event_id,order_no,payload_hash,verified,result)
        VALUES($1,$2,$3,$4,true,'processing') ON CONFLICT(provider_code,event_id) DO NOTHING RETURNING id`,
        [input.providerCode,input.eventId,input.orderNo,input.payloadHash])
      if(!event.rows[0]){
        await client.query('ROLLBACK')
        return {ok:true,duplicate:true}
      }
      const order=(await client.query('SELECT * FROM orders WHERE order_no=$1 FOR UPDATE',[input.orderNo])).rows[0]
      if(!order||order.provider_code!==input.providerCode||order.amount_cents!==input.amountCents)throw new Error('PAYMENT_ORDER_MISMATCH')
      if(order.status==='paid'){
        await client.query(`UPDATE payment_events SET result='duplicate-paid' WHERE id=$1`,[event.rows[0].id])
        await client.query('COMMIT')
        return {ok:true,duplicate:true}
      }
      // A gateway may accept payment while our create/query response is lost and
      // the local order is marked failed. A cryptographically verified PAID
      // callback/query must still grant what the customer paid for.
      // 'closed' = a split piece re-issued under a new number whose old QR was
      // still paid: the money is real, so it counts for that piece.
      const payable=order.status==='pending'||order.status==='failed'||(order.status==='closed'&&!!order.group_id)
      if(!payable)throw new Error('ORDER_NOT_PAYABLE')
      if(order.provider_order_no&&order.provider_order_no!==input.providerOrderNo)throw new Error('PROVIDER_ORDER_MISMATCH')
      if(order.group_id){
        const allPaid=await this.payGroupPieceInTx(client,order,input.providerCode,input.providerOrderNo,input.paidAt??new Date())
        await client.query(`UPDATE payment_events SET result='fulfilled' WHERE id=$1`,[event.rows[0].id])
        await client.query('COMMIT')
        return {ok:true,duplicate:false,groupAllPaid:allPaid}
      }
      // Same shared grant as split groups and manual confirmation: it locks the
      // user+tier slot, merges remaining trial time and records the ledger row.
      await this.grantWithinTx(client,{userId:order.user_id,planId:order.plan_id,durationDays:order.duration_days,lifetime:order.lifetime,source:'order',orderId:order.id})
      await client.query(`UPDATE orders SET status='paid',provider_order_no=$2,paid_at=$3,updated_at=now() WHERE id=$1`,
        [order.id,input.providerOrderNo,input.paidAt??new Date()])
      await client.query(`UPDATE payment_events SET result='fulfilled' WHERE id=$1`,[event.rows[0].id])
      await client.query('COMMIT')
      return {ok:true,duplicate:false}
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }

  // Split sub-order: mark THIS piece paid; grant the plan once, when every live
  // piece of the group is paid ('closed' = replaced by a re-issued piece). A
  // group-level event guards concurrent last payments against a double grant.
  // Used by gateway callbacks/queries and by manual admin confirmation alike.
  private async payGroupPieceInTx(client:TxClient,order:{id:string;group_id:string;order_no:string;user_id:string;plan_id:string;duration_days:number|null;lifetime:boolean},
    providerCode:string,providerOrderNo:string,paidAt:Date):Promise<boolean>{
    await client.query(`UPDATE orders SET status='paid',provider_order_no=$2,paid_at=$3,updated_at=now() WHERE id=$1`,[order.id,providerOrderNo,paidAt])
    // This piece is covered now: an unpaid stand-in for the same slot is no longer needed.
    await client.query(`UPDATE orders SET status='closed',updated_at=now() WHERE group_id=$1 AND split_index=(SELECT split_index FROM orders WHERE id=$2)
      AND id<>$2 AND status IN ('pending','failed')`,[order.group_id,order.id])
    const siblings=(await client.query(`SELECT status FROM orders WHERE group_id=$1 AND status<>'closed' FOR UPDATE`,[order.group_id])).rows as Array<{status:string}>
    const allPaid=siblings.length>0&&siblings.every(s=>s.status==='paid')
    if(allPaid){
      const groupEvent=await client.query(`INSERT INTO payment_events(provider_code,event_id,order_no,payload_hash,verified,result)
        VALUES($1,$2,$3,'group',true,'fulfilled') ON CONFLICT(provider_code,event_id) DO NOTHING RETURNING id`,
        [providerCode,`group:${order.group_id}`,order.order_no])
      if(groupEvent.rows[0]){
        await this.grantWithinTx(client,{userId:order.user_id,planId:order.plan_id,durationDays:order.duration_days,lifetime:order.lifetime,source:'order',orderId:order.id})
      }
    }
    return allPaid
  }

  // Shared license grant used by paid orders, manual admin grants and redeem
  // codes. Must run inside an open transaction. Locks the user+tier slot, then
  // stacks onto any existing active license via resolvePaidLicenseGrant (never
  // downgrades a lifetime entitlement).
  private async grantWithinTx(client:TxClient,opts:{userId:string;planId:string;durationDays:number|null;lifetime:boolean;source:string;orderId?:string|null}){
    const plan=(await client.query('SELECT id,tier,duration_days,lifetime FROM plans WHERE id=$1',[opts.planId])).rows[0]
    if(!plan)throw new AppError('PLAN_NOT_FOUND','套餐不存在',404)
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`license:${opts.userId}:${plan.tier}`])
    const existing=(await client.query(`SELECT l.id,l.plan_id AS "planId",l.expires_at AS "expiresAt",l.lifetime FROM licenses l JOIN plans p ON p.id=l.plan_id
      WHERE l.user_id=$1 AND l.status='active' AND p.tier=$2 AND l.source<>'aigw' ORDER BY l.lifetime DESC,l.expires_at DESC LIMIT 1 FOR UPDATE`,
      [opts.userId,plan.tier])).rows[0]
    const lifetime=opts.lifetime||!!plan.lifetime
    const durationDays=lifetime?null:(opts.durationDays??plan.duration_days)
    const grant=resolvePaidLicenseGrant(existing?{planId:existing.planId,expiresAt:existing.expiresAt,lifetime:existing.lifetime}:null,
      {planId:opts.planId,durationDays,lifetime})
    // 试用叠加：购买正式会员（非试用套餐）时，把剩余试用时长加到会员到期，
    // 并把试用授权消费掉，避免白白损失试用天数或试用/会员并存。
    if(plan.tier!=='trial'){
      const trial=(await client.query(`SELECT l.id,l.expires_at AS "expiresAt" FROM licenses l JOIN plans p ON p.id=l.plan_id
        WHERE l.user_id=$1 AND l.status='active' AND p.tier='trial' AND l.expires_at>now() ORDER BY l.expires_at DESC LIMIT 1 FOR UPDATE`,[opts.userId])).rows[0]
      if(trial){
        if(!grant.lifetime){
          const remainingMs=new Date(trial.expiresAt).getTime()-Date.now()
          if(remainingMs>0)grant.expiresAt=new Date(grant.expiresAt.getTime()+remainingMs)
        }
        await client.query(`UPDATE licenses SET status='expired' WHERE id=$1`,[trial.id])
      }
    }
    let licenseId:string
    if(existing){
      if(grant.changed)await client.query(`UPDATE licenses SET plan_id=$2,expires_at=$3,lifetime=$4,status='active',source=$5,order_id=$6 WHERE id=$1`,
        [existing.id,grant.planId,grant.expiresAt,grant.lifetime,opts.source,opts.orderId??null])
      licenseId=existing.id
    }else{
      licenseId=(await client.query(`INSERT INTO licenses(user_id,plan_id,expires_at,lifetime,source,order_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [opts.userId,grant.planId,grant.expiresAt,grant.lifetime,opts.source,opts.orderId??null])).rows[0].id
    }
    // Ledger: the stretch of the timeline this grant added (see 0011_license_ledger.sql).
    const now=new Date()
    const before=existing?new Date(existing.expiresAt):null
    const start=before&&!existing.lifetime&&before>now?before:now
    const end=existing?.lifetime?start:(grant.lifetime?null:grant.expiresAt)
    await client.query(`INSERT INTO license_grants(user_id,license_id,tier,source,order_id,group_id,start_at,end_at,before_expires_at,before_lifetime)
      VALUES($1,$2,$3,$4,$5::uuid,(SELECT group_id FROM orders WHERE id=$5::uuid),$6,$7,$8,$9)`,
      [opts.userId,licenseId,plan.tier,opts.source,opts.orderId??null,start,end,before,!!existing?.lifetime])
    if(opts.source==='order'&&opts.orderId)await this.settleCommissionInTx(client,opts.orderId)
    return grant
  }

  // 注册带邀请码：在建号事务里绑上级。坏码 / 停用的码 / 绑定出错都不挡注册（保存点隔离，只记日志）。
  private async bindReferrerInTx(client:TxClient,userId:string,ref:string|undefined){
    if(!ref?.trim())return
    await client.query('SAVEPOINT fenxiao_bind')
    try{
      await this.fx.bind({userId:String(userId),code:ref,tx:client})
      await client.query('RELEASE SAVEPOINT fenxiao_bind')
    }catch(e){
      await client.query('ROLLBACK TO SAVEPOINT fenxiao_bind')
      console.error('[fenxiao] bind failed',{userId,error:(e as Error).message})
    }
  }

  // 付款发货那一刻给上级链分佣（与发货同事务）。来源 = 拆单组 id（整组一次）或订单 id；基数 = 实付分。
  // 放在保存点里：分佣出任何错都只记日志、不让客户的付款发货失败。
  private async settleCommissionInTx(client:TxClient,orderId:string){
    const o=(await client.query(`SELECT o.user_id,coalesce(o.group_id::text,o.id::text) AS ref,
        CASE WHEN o.group_id IS NULL THEN o.amount_cents
          ELSE (SELECT coalesce(sum(g.amount_cents),0) FROM orders g WHERE g.group_id=o.group_id AND (g.status='paid' OR g.id=o.id)) END AS base
      FROM orders o WHERE o.id=$1`,[orderId])).rows[0]
    if(!o)return
    await client.query('SAVEPOINT fenxiao_settle')
    try{
      await this.fx.settle({buyerUserId:String(o.user_id),sourceRef:o.ref,baseAmount:BigInt(o.base),tx:client})
      await client.query('RELEASE SAVEPOINT fenxiao_settle')
    }catch(e){
      await client.query('ROLLBACK TO SAVEPOINT fenxiao_settle')
      console.error('[fenxiao] settle failed',{orderId,error:(e as Error).message})
    }
  }

  // Refund a paid order (the whole group for a split checkout): mark it
  // refunded and take back only the part of its time that is not used yet.
  // The money itself is refunded in the merchant's back office. Orders paid
  // before the ledger existed are marked refunded without touching the license.
  async refundOrder(orderNoValue:string,reason:string){
    const client=await this.pool.connect()
    try{
      await client.query('BEGIN')
      const order=(await client.query('SELECT id,user_id,tier,status,group_id FROM orders WHERE order_no=$1 FOR UPDATE',[orderNoValue])).rows[0]
      if(!order)throw new AppError('NOT_FOUND','订单不存在',404)
      if(order.status!=='paid')throw new AppError('ORDER_NOT_REFUNDABLE','只有已支付的订单可以退款',409)
      const ids:string[]=order.group_id
        ?(await client.query('SELECT id FROM orders WHERE group_id=$1 FOR UPDATE',[order.group_id])).rows.map((r:{id:string})=>r.id)
        :[order.id]
      await client.query(`UPDATE orders SET status='refunded',refunded_at=now(),refund_reason=$2,updated_at=now() WHERE id=ANY($1::uuid[]) AND status='paid'`,[ids,reason])
      // 退款同事务冲回上级佣金（已提现的会变欠款，后台分销页可见）。
      await this.fx.reverse({sourceRef:String(order.group_id??order.id),reason:`订单退款：${reason}`,tx:client})
      const ledger=(await client.query(`SELECT id,license_id AS "licenseId",start_at AS "startAt",end_at AS "endAt",before_expires_at AS "beforeExpiresAt",before_lifetime AS "beforeLifetime"
        FROM license_grants WHERE order_id=ANY($1::uuid[]) AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,[ids])).rows[0]
      if(!ledger?.licenseId){
        await client.query('COMMIT')
        return {ok:true,orders:ids.length,licenseAdjusted:false}
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`license:${order.user_id}:${order.tier}`])
      const lic=(await client.query('SELECT id,expires_at AS "expiresAt",lifetime FROM licenses WHERE id=$1 FOR UPDATE',[ledger.licenseId])).rows[0]
      const change=refundedLicense(lic?{expiresAt:new Date(lic.expiresAt),lifetime:lic.lifetime}:null,{
        startAt:new Date(ledger.startAt),endAt:ledger.endAt?new Date(ledger.endAt):null,
        beforeExpiresAt:ledger.beforeExpiresAt?new Date(ledger.beforeExpiresAt):null,beforeLifetime:ledger.beforeLifetime,
      })
      if(lic&&change)await client.query('UPDATE licenses SET expires_at=$2,lifetime=$3 WHERE id=$1',[lic.id,change.expiresAt,change.lifetime])
      await client.query('UPDATE license_grants SET revoked_at=now(),revoke_reason=$2 WHERE id=$1',[ledger.id,reason])
      await client.query('COMMIT')
      return {ok:true,orders:ids.length,licenseAdjusted:true,removedDays:change?change.removedDays:0,
        expiresAt:change?change.expiresAt:lic?.expiresAt??null,lifetime:change?change.lifetime:!!lic?.lifetime}
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }

  // 后台手动给用户发放/续期一个套餐（等级由 planId 决定，时长可覆盖或永久）。
  async adminGrantLicense(userId:string,opts:{planId:string;durationDays?:number|null;lifetime?:boolean}){
    const client=await this.pool.connect()
    try{
      await client.query('BEGIN')
      const user=(await client.query('SELECT id FROM users WHERE id=$1',[userId])).rows[0]
      if(!user)throw new AppError('NOT_FOUND','用户不存在',404)
      const grant=await this.grantWithinTx(client,{userId,planId:opts.planId,durationDays:opts.durationDays??null,lifetime:!!opts.lifetime,source:'admin'})
      await client.query('COMMIT')
      return {ok:true,...grant}
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }

  // 后台手动确认订单发货：把未支付/失败订单直接标记为已支付并发放权益，无需网关回调。
  async confirmOrderManually(orderNoValue:string){
    const client=await this.pool.connect()
    try{
      await client.query('BEGIN')
      const order=(await client.query('SELECT * FROM orders WHERE order_no=$1 FOR UPDATE',[orderNoValue])).rows[0]
      if(!order){await client.query('ROLLBACK');throw new AppError('NOT_FOUND','订单不存在',404)}
      if(order.status==='paid'){await client.query('ROLLBACK');return {ok:true,duplicate:true}}
      if(order.status!=='pending'&&order.status!=='failed'){await client.query('ROLLBACK');throw new AppError('ORDER_NOT_PAYABLE','订单当前状态不可发货',409)}
      await client.query(`INSERT INTO payment_events(provider_code,event_id,order_no,payload_hash,verified,result)
        VALUES($1,$2,$3,'manual',true,'manual') ON CONFLICT(provider_code,event_id) DO NOTHING`,
        [order.provider_code,`manual:${order.order_no}`,order.order_no])
      if(order.group_id){
        // One piece of a split checkout: confirm just this piece; the plan is
        // granted once the whole group is paid (same path as gateway payments).
        const allPaid=await this.payGroupPieceInTx(client,order,order.provider_code,order.provider_order_no??'MANUAL',new Date())
        await client.query('COMMIT')
        return {ok:true,duplicate:false,groupAllPaid:allPaid}
      }
      const grant=await this.grantWithinTx(client,{userId:order.user_id,planId:order.plan_id,durationDays:order.duration_days,lifetime:order.lifetime,source:'order',orderId:order.id})
      await client.query(`UPDATE orders SET status='paid',provider_order_no=COALESCE(provider_order_no,'MANUAL'),paid_at=now(),updated_at=now() WHERE id=$1`,[order.id])
      await client.query('COMMIT')
      return {ok:true,duplicate:false,...grant}
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }

  // 批量生成兑换码。返回本批生成的明码（仅此一次可见）。
  // maxUses：单个码最多可被多少个不同账号兑换（null = 不限次数）。
  async createRedeemCodes(opts:{planId:string;durationDays:number|null;lifetime:boolean;count:number;maxUses?:number|null;note:string;codeExpiresAt?:Date|null},actor:string){
    const plan=(await this.pool.query('SELECT id FROM plans WHERE id=$1',[opts.planId])).rows[0]
    if(!plan)throw new AppError('PLAN_NOT_FOUND','套餐不存在',404)
    const maxUses=opts.maxUses==null?null:Math.max(1,Math.floor(opts.maxUses))
    const client=await this.pool.connect()
    try{
      await client.query('BEGIN')
      const batchId=(await client.query('SELECT gen_random_uuid() AS id')).rows[0].id
      const codes:string[]=[]
      for(let i=0;i<opts.count;i++){
        let inserted=false
        for(let attempt=0;attempt<5&&!inserted;attempt++){
          const code=genRedeemCode()
          try{
            await client.query(`INSERT INTO redeem_codes(code,plan_id,duration_days,lifetime,note,batch_id,code_expires_at,max_uses,created_by)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[code,opts.planId,opts.lifetime?null:opts.durationDays,opts.lifetime,opts.note,batchId,opts.codeExpiresAt??null,maxUses,actor])
            codes.push(code);inserted=true
          }catch(err){ if((err as {code?:string}).code!=='23505')throw err }
        }
        if(!inserted)throw new Error('REDEEM_CODE_GEN_FAILED')
      }
      await client.query('COMMIT')
      return {batchId,codes}
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }

  async listRedeemCodes(params:Partial<RedeemListQuery>={}):Promise<ListResult<any>>{
    const conds:string[]=[];const vals:unknown[]=[];let i=1
    if(params.q){vals.push(`%${params.q}%`);conds.push(`(rc.code ILIKE $${i} OR rc.note ILIKE $${i})`);i++}
    if(params.status){vals.push(params.status);conds.push(`rc.status=$${i}`);i++}
    if(params.batchId){vals.push(params.batchId);conds.push(`rc.batch_id=$${i}`);i++}
    if(params.planId){vals.push(params.planId);conds.push(`rc.plan_id=$${i}`);i++}
    if(params.lifetime!==undefined){vals.push(params.lifetime);conds.push(`rc.lifetime=$${i}`);i++}
    const where=conds.length?`WHERE ${conds.join(' AND ')}`:''
    const orderBy=orderClause(params.sort,params.order,{createdAt:'rc.created_at',code:'rc.code',status:'rc.status',redeemedAt:'rc.redeemed_at',codeExpiresAt:'rc.code_expires_at'},'rc.created_at DESC')
    const limit=pageLimit(params.limit),offset=pageOffset(params.offset)
    vals.push(limit,offset)
    const r=await this.pool.query(`SELECT rc.id,rc.code,rc.status,rc.duration_days AS "durationDays",rc.lifetime,rc.note,rc.batch_id AS "batchId",
      rc.code_expires_at AS "codeExpiresAt",rc.redeemed_at AS "redeemedAt",rc.created_at AS "createdAt",
      rc.max_uses AS "maxUses",rc.used_count AS "usedCount",
      p.name AS "planName",p.tier,u.username AS "redeemedBy",(count(*) OVER())::int AS "totalCount"
      FROM redeem_codes rc JOIN plans p ON p.id=rc.plan_id LEFT JOIN users u ON u.id=rc.redeemed_by
      ${where} ORDER BY ${orderBy} LIMIT $${i} OFFSET $${i+1}`,vals)
    const total=r.rows[0]?Number(r.rows[0].totalCount):0
    const items=r.rows.map(({totalCount,...rest}:{totalCount:number})=>rest)
    return {items,total,limit,offset}
  }

  async setRedeemCodeStatus(id:string,status:'active'|'disabled'){
    const r=await this.pool.query(`UPDATE redeem_codes SET status=$2 WHERE id=$1 AND status IN ('active','disabled') RETURNING id`,[id,status])
    return r.rows[0]??null
  }

  // 客户端兑换：一码可被 max_uses 个不同账号兑换（null=不限）。同一账号对同一码
  // 只能兑换一次（redeem_redemptions 唯一约束保证幂等，杜绝旧版“重复兑换翻倍”）。
  async redeemCode(userId:string,codeInput:string){
    const code=codeInput.trim().toUpperCase()
    const client=await this.pool.connect()
    try{
      await client.query('BEGIN')
      // 锁住整条码，串行化并发兑换，保证 used_count 计数与名额判断准确。
      const rc=(await client.query('SELECT * FROM redeem_codes WHERE code=$1 FOR UPDATE',[code])).rows[0]
      if(!rc){await client.query('ROLLBACK');throw new AppError('REDEEM_NOT_FOUND','兑换码无效',404)}
      if(rc.status==='disabled'){await client.query('ROLLBACK');throw new AppError('REDEEM_UNAVAILABLE','兑换码已停用',409)}
      if(rc.code_expires_at&&new Date(rc.code_expires_at).getTime()<Date.now()){await client.query('ROLLBACK');throw new AppError('REDEEM_EXPIRED','兑换码已过期',409)}
      const maxUses:number|null=rc.max_uses==null?null:Number(rc.max_uses)
      const usedCount=Number(rc.used_count)||0
      // 名额用尽（末次成功兑换时 status 已置 used，这里是双保险）。
      if(rc.status==='used'||(maxUses!=null&&usedCount>=maxUses)){
        await client.query('ROLLBACK')
        throw new AppError('REDEEM_EXHAUSTED','兑换码已被领完',409)
      }
      // 幂等闸门：同一账号重复兑换同一码时唯一约束冲突 → 不再二次发放。
      const claim=await client.query(`INSERT INTO redeem_redemptions(code_id,user_id) VALUES($1,$2)
        ON CONFLICT (code_id,user_id) DO NOTHING RETURNING id`,[rc.id,userId])
      if(!claim.rowCount){await client.query('ROLLBACK');throw new AppError('REDEEM_ALREADY','你已经兑换过这个兑换码了',409)}
      const grant=await this.grantWithinTx(client,{userId,planId:rc.plan_id,durationDays:rc.duration_days,lifetime:rc.lifetime,source:'redeem'})
      const nextUsed=usedCount+1
      const nowUsedUp=maxUses!=null&&nextUsed>=maxUses
      await client.query(`UPDATE redeem_codes SET used_count=$2,status=$3,redeemed_by=$4,redeemed_at=now() WHERE id=$1`,
        [rc.id,nextUsed,nowUsedUp?'used':'active',userId])
      await client.query('COMMIT')
      return {ok:true,...grant}
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }

  // 记录一次下载/浏览事件。IP 仅存盐值哈希，不落原始地址。
  async recordDownloadEvent(ev:{kind:'download'|'view';file?:string;version?:string;ip?:string;visitorId?:string;userAgent?:string;referer?:string;path?:string}){
    const ipHash=ev.ip?sha256('proxysplit-dl-ip-v1:'+ev.ip):''
    await this.pool.query(`INSERT INTO download_events(kind,file,version,ip_hash,visitor_id,user_agent,referer,path)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [ev.kind,(ev.file??'').slice(0,200),(ev.version??'').slice(0,40),ipHash,(ev.visitorId??'').slice(0,64),
       (ev.userAgent??'').slice(0,500),(ev.referer??'').slice(0,500),(ev.path??'').slice(0,300)])
  }

  // 下载/浏览统计：总量、去重(独立IP/独立访客)、按日趋势、版本与来源分布。
  async downloadStats(range:{from:Date;to:Date}){
    const day=(col:string)=>`to_char(date_trunc('day',${col} AT TIME ZONE 'Asia/Shanghai'),'YYYY-MM-DD')`
    const win:[Date,Date]=[range.from,range.to]
    const [totals,daily,versions,referers,recent]=await Promise.all([
      this.pool.query(`SELECT kind,
          count(*)::int AS total,
          count(DISTINCT NULLIF(ip_hash,''))::int AS "uniqueIps",
          count(DISTINCT NULLIF(visitor_id,''))::int AS "uniqueVisitors"
        FROM download_events WHERE created_at>=$1 AND created_at<$2 GROUP BY kind`,win),
      this.pool.query(`SELECT ${day('created_at')} AS date,
          count(*) FILTER(WHERE kind='download')::int AS downloads,
          count(*) FILTER(WHERE kind='view')::int AS views,
          count(DISTINCT NULLIF(ip_hash,'')) FILTER(WHERE kind='download')::int AS "downloadIps"
        FROM download_events WHERE created_at>=$1 AND created_at<$2 GROUP BY 1 ORDER BY 1`,win),
      this.pool.query(`SELECT version,count(*)::int AS total,count(DISTINCT NULLIF(ip_hash,''))::int AS "uniqueIps"
        FROM download_events WHERE kind='download' AND created_at>=$1 AND created_at<$2 AND version<>'' GROUP BY version ORDER BY total DESC LIMIT 20`,win),
      this.pool.query(`SELECT COALESCE(NULLIF(split_part(regexp_replace(referer,'^https?://',''),'/',1),''),'直接访问') AS source,count(*)::int AS total
        FROM download_events WHERE created_at>=$1 AND created_at<$2 GROUP BY 1 ORDER BY total DESC LIMIT 15`,win),
      this.pool.query(`SELECT kind,file,version,referer,created_at AS "createdAt"
        FROM download_events WHERE created_at>=$1 AND created_at<$2 ORDER BY created_at DESC LIMIT 50`,win),
    ])
    const n=(v:unknown)=>Number(v)||0
    const dl=totals.rows.find(r=>r.kind==='download')
    const vw=totals.rows.find(r=>r.kind==='view')
    return {
      summary:{
        downloads:n(dl?.total),downloadUniqueIps:n(dl?.uniqueIps),downloadUniqueVisitors:n(dl?.uniqueVisitors),
        views:n(vw?.total),viewUniqueIps:n(vw?.uniqueIps),viewUniqueVisitors:n(vw?.uniqueVisitors),
      },
      daily:daily.rows.map(r=>({date:r.date,downloads:r.downloads,views:r.views,downloadIps:r.downloadIps})),
      versions:versions.rows.map(r=>({version:r.version,total:r.total,uniqueIps:r.uniqueIps})),
      referers:referers.rows.map(r=>({source:r.source,total:r.total})),
      recent:recent.rows.map(r=>({kind:r.kind,file:r.file,version:r.version,referer:r.referer,createdAt:r.createdAt})),
    }
  }

  async listAnnouncements(params:Partial<AnnouncementListQuery>&{publicOnly?:boolean}={}):Promise<ListResult<any>>{
    const conds:string[]=[];const vals:unknown[]=[];let i=1
    if(params.publicOnly)conds.push(`active=true AND (starts_at IS NULL OR starts_at<=now()) AND (ends_at IS NULL OR ends_at>now())`)
    if(params.q){vals.push(`%${params.q}%`);conds.push(`(title ILIKE $${i} OR summary ILIKE $${i} OR content ILIKE $${i})`);i++}
    if(params.type){vals.push(params.type);conds.push(`type=$${i}`);i++}
    if(params.active!==undefined){vals.push(params.active);conds.push(`active=$${i}`);i++}
    if(params.pinned!==undefined){vals.push(params.pinned);conds.push(`pinned=$${i}`);i++}
    const where=conds.length?`WHERE ${conds.join(' AND ')}`:''
    const orderBy=orderClause(params.sort,params.order,{publishedAt:'published_at',createdAt:'created_at',title:'title',type:'type'},'pinned DESC,published_at DESC')
    const limit=pageLimit(params.limit),offset=pageOffset(params.offset)
    vals.push(limit,offset)
    const r=await this.pool.query(`SELECT id,type,title,summary,content,version,active,pinned,published_at AS "publishedAt",
      starts_at AS "startsAt",ends_at AS "endsAt",created_at AS "createdAt",updated_at AS "updatedAt",(count(*) OVER())::int AS "totalCount"
      FROM announcements ${where} ORDER BY ${orderBy} LIMIT $${i} OFFSET $${i+1}`,vals)
    const total=r.rows[0]?Number(r.rows[0].totalCount):0
    const items=r.rows.map(({totalCount,...rest}:{totalCount:number})=>rest)
    return {items,total,limit,offset}
  }
  async createAnnouncement(v:AnnouncementUpsertInput,actor:string){
    const r=await this.pool.query(`INSERT INTO announcements(type,title,summary,content,version,active,pinned,starts_at,ends_at,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [v.type,v.title,v.summary,v.content,v.version,v.active,v.pinned,v.startsAt??null,v.endsAt??null,actor])
    return r.rows[0]
  }
  async updateAnnouncement(id:string,v:AnnouncementUpsertInput){
    const r=await this.pool.query(`UPDATE announcements SET type=$2,title=$3,summary=$4,content=$5,version=$6,active=$7,pinned=$8,
      starts_at=$9,ends_at=$10,updated_at=now() WHERE id=$1 RETURNING id`,
      [id,v.type,v.title,v.summary,v.content,v.version,v.active,v.pinned,v.startsAt??null,v.endsAt??null])
    return r.rows[0]??null
  }
  async deleteAnnouncement(id:string){const r=await this.pool.query('DELETE FROM announcements WHERE id=$1 RETURNING id',[id]);return r.rows[0]??null}

  // Hard-delete a user. licenses/devices/sessions/trial_claims cascade; audit /
  // announcement / settings references are nulled to preserve history. A user
  // still referenced by financial orders (no cascade) surfaces as 'referenced'.
  async deleteUser(id:string):Promise<{ok:true}|{ok:false;reason:'not_found'|'last_admin'|'referenced'}>{
    const client=await this.pool.connect()
    try{
      await client.query('BEGIN')
      const u=(await client.query('SELECT id,role FROM users WHERE id=$1 FOR UPDATE',[id])).rows[0]
      if(!u){await client.query('ROLLBACK');return {ok:false,reason:'not_found'}}
      if(u.role==='admin'){
        const n=(await client.query(`SELECT count(*)::int AS n FROM users WHERE role='admin'`)).rows[0].n
        if(n<=1){await client.query('ROLLBACK');return {ok:false,reason:'last_admin'}}
      }
      await client.query('UPDATE audit_logs SET actor_user_id=NULL WHERE actor_user_id=$1',[id])
      await client.query('UPDATE announcements SET created_by=NULL WHERE created_by=$1',[id])
      await client.query('UPDATE system_settings SET updated_by=NULL WHERE updated_by=$1',[id])
      try{
        await client.query('DELETE FROM users WHERE id=$1',[id])
      }catch(err){
        if((err as {code?:string}).code==='23503'){await client.query('ROLLBACK');return {ok:false,reason:'referenced'}}
        throw err
      }
      await client.query('COMMIT')
      return {ok:true}
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }
  // Physically deleting a plan is only safe when nothing references it; otherwise
  // callers should deactivate (active=false) instead.
  async deletePlan(id:string):Promise<{ok:true}|{ok:false;reason:'not_found'|'referenced'}>{
    const exists=(await this.pool.query('SELECT 1 FROM plans WHERE id=$1',[id])).rows[0]
    if(!exists)return {ok:false,reason:'not_found'}
    const ref=(await this.pool.query(`SELECT EXISTS(
      SELECT 1 FROM orders WHERE plan_id=$1
      UNION ALL SELECT 1 FROM licenses WHERE plan_id=$1
      UNION ALL SELECT 1 FROM redeem_codes WHERE plan_id=$1
    ) AS used`,[id])).rows[0]
    if(ref?.used)return {ok:false,reason:'referenced'}
    await this.pool.query('DELETE FROM plans WHERE id=$1',[id])
    return {ok:true}
  }
  async deleteRedeemCode(id:string):Promise<{ok:true}|{ok:false;reason:'not_found'|'used'}>{
    const row=(await this.pool.query('SELECT status,used_count FROM redeem_codes WHERE id=$1',[id])).rows[0]
    if(!row)return {ok:false,reason:'not_found'}
    // 多人复用码被部分兑换后 status 仍为 'active'，必须按实际消费拦截，否则删除会
    // 通过 redeem_redemptions 的 ON DELETE CASCADE 抹掉已产生的兑换台账。
    if(row.status==='used'||Number(row.used_count)>0)return {ok:false,reason:'used'}
    await this.pool.query(`DELETE FROM redeem_codes WHERE id=$1 AND status<>'used' AND used_count=0`,[id])
    return {ok:true}
  }
  async deleteRelease(id:string){const r=await this.pool.query('DELETE FROM releases WHERE id=$1 RETURNING id',[id]);return r.rows[0]??null}

  // Dashboard chart bundle. Amounts in cents; day buckets use Asia/Shanghai wall
  // time so a purchase near local midnight lands on the expected calendar day.
  async analytics(range:{from:Date;to:Date}){
    const day=(col:string)=>`to_char(date_trunc('day',${col} AT TIME ZONE 'Asia/Shanghai'),'YYYY-MM-DD')`
    const win:[Date,Date]=[range.from,range.to]
    const [rev,signup,ordersD,orderStat,memTier,newDev,platform,redeem,audit]=await Promise.all([
      this.pool.query(`SELECT ${day('paid_at')} AS date,coalesce(sum(amount_cents),0)::bigint AS "amountCents",count(*)::int AS orders
        FROM orders WHERE status='paid' AND paid_at>=$1 AND paid_at<$2 GROUP BY 1 ORDER BY 1`,win),
      this.pool.query(`SELECT ${day('created_at')} AS date,count(*)::int AS count
        FROM users WHERE created_at>=$1 AND created_at<$2 GROUP BY 1 ORDER BY 1`,win),
      this.pool.query(`SELECT ${day('created_at')} AS date,count(*)::int AS created,count(*) FILTER(WHERE status='paid')::int AS paid
        FROM orders WHERE created_at>=$1 AND created_at<$2 GROUP BY 1 ORDER BY 1`,win),
      this.pool.query(`SELECT status,count(*)::int AS count,coalesce(sum(amount_cents),0)::bigint AS "amountCents"
        FROM orders WHERE created_at>=$1 AND created_at<$2 GROUP BY status ORDER BY status`,win),
      this.pool.query(`SELECT p.tier,count(*)::int AS count FROM licenses l JOIN plans p ON p.id=l.plan_id
        WHERE l.status='active' AND l.expires_at>now() GROUP BY p.tier ORDER BY p.tier`),
      this.pool.query(`SELECT ${day('first_seen_at')} AS date,count(*)::int AS count
        FROM devices WHERE first_seen_at>=$1 AND first_seen_at<$2 GROUP BY 1 ORDER BY 1`,win),
      this.pool.query(`SELECT platform,count(*)::int AS count FROM devices WHERE revoked=false GROUP BY platform ORDER BY count DESC`),
      this.pool.query(`SELECT status,count(*)::int AS count FROM redeem_codes GROUP BY status ORDER BY status`),
      this.pool.query(`SELECT ${day('created_at')} AS date,count(*)::int AS count
        FROM audit_logs WHERE created_at>=$1 AND created_at<$2 GROUP BY 1 ORDER BY 1`,win),
    ])
    const n=(v:unknown)=>Number(v)
    return {
      revenueDaily:rev.rows.map(r=>({date:r.date,amountCents:n(r.amountCents),orders:r.orders})),
      signupsDaily:signup.rows.map(r=>({date:r.date,count:r.count})),
      ordersDaily:ordersD.rows.map(r=>({date:r.date,created:r.created,paid:r.paid})),
      orderStatus:orderStat.rows.map(r=>({status:r.status,count:r.count,amountCents:n(r.amountCents)})),
      membershipTier:memTier.rows.map(r=>({tier:r.tier,count:r.count})),
      newDevicesDaily:newDev.rows.map(r=>({date:r.date,count:r.count})),
      platformDist:platform.rows.map(r=>({platform:r.platform,count:r.count})),
      redeemStatus:redeem.rows.map(r=>({status:r.status,count:r.count})),
      auditDaily:audit.rows.map(r=>({date:r.date,count:r.count})),
    }
  }
  async bootstrapAdmin(username:string,passwordHash:string){
    await this.pool.query(`INSERT INTO users(username,password_hash,role,status) VALUES($1,$2,'admin','active') ON CONFLICT(username) DO NOTHING`,[username,passwordHash])
  }
}
