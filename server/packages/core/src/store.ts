import { createHash, randomBytes } from 'node:crypto'
import { createDatabase } from '@proxysplit/db'
import type { AnnouncementListQuery, AnnouncementUpsertInput, AuditListQuery, DeviceListQuery, OrderListQuery, PlanListQuery, PlanPatchInput, PlanUpsertInput, ProviderUpsertInput, RedeemListQuery, ReleaseListQuery, UserListQuery } from '@proxysplit/contracts'
import { AppError } from '@proxysplit/shared'
import { planSplit } from './split.js'

export type UserRecord = {
  id:string; username:string; passwordHash:string; role:'user'|'admin';
  status:'active'|'suspended'|'banned'; createdAt:Date;
  failedLoginCount:number; lockoutLevel:number; lockedUntil:Date|null
}
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
  paymentMethods:Array<'alipay'>
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
  providerOrderNo:string|null; payUrl:string|null; paidAt:Date|null;
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
}
const settingsDefaults:CommerceSettings={
  registrationEnabled:true,trialDays:3,trialPlanCode:'trial',
  defaultDeviceLimit:3,licenseLeaseMinutes:60,offlineGraceHours:6,
  activePaymentProvider:'zhongzhuan-prod',paymentMethods:['alipay'],
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
  constructor(url:string) { this.pool=createDatabase(url).pool }
  async close(){ await this.pool.end() }

  async findUser(username:string):Promise<UserRecord|null>{
    const r=await this.pool.query('SELECT id,username,password_hash AS "passwordHash",role,status,created_at AS "createdAt",failed_login_count AS "failedLoginCount",lockout_level AS "lockoutLevel",locked_until AS "lockedUntil" FROM users WHERE username=$1',[username])
    return r.rows[0]??null
  }
  async findUserById(id:string):Promise<UserRecord|null>{
    const r=await this.pool.query('SELECT id,username,password_hash AS "passwordHash",role,status,created_at AS "createdAt",failed_login_count AS "failedLoginCount",lockout_level AS "lockoutLevel",locked_until AS "lockedUntil" FROM users WHERE id=$1',[id])
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

  async registerTrialUser(input:{username:string;email:string;passwordHash:string;hardwareHash:string;ip:string}){
    const client=await this.pool.connect()
    try{
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[input.hardwareHash])
      const settings=await client.query(`SELECT key,value FROM system_settings WHERE key IN ('registration_enabled','trial_days','trial_plan_code')`)
      const map=new Map(settings.rows.map(x=>[x.key,x.value]))
      if((map.get('registration_enabled')??true)!==true)throw new Error('REGISTRATION_DISABLED')
      const trialDays=Number(map.get('trial_days')??3)
      const trialPlanCode=String(map.get('trial_plan_code')??'trial')
      // 同一硬件只能领取一次试用，但不能因此阻止共享电脑上的其他用户注册。
      // 已领取过试用时仍创建正常账号，只是不发放试用授权，由客户端引导购买套餐。
      const claimed=trialDays>0
        ?await client.query('SELECT 1 FROM trial_claims WHERE hardware_hash=$1',[input.hardwareHash])
        :null
      const grantTrial=trialDays>0&&!claimed?.rowCount
      const now=new Date(),trialEnds=new Date(now.getTime()+trialDays*86400000)
      const user=await client.query(`INSERT INTO users(username,email,password_hash,role,status,trial_started_at,trial_ends_at,registration_ip_hash)
        VALUES($1,$2,$3,'user','active',$4,$5,$6) RETURNING id,username,email,role,status`,
        [input.username,input.email,input.passwordHash,grantTrial?now:null,grantTrial?trialEnds:null,sha256('proxysplit-ip-v1:'+input.ip)])
      if(grantTrial){
        const plan=await client.query('SELECT id FROM plans WHERE code=$1 AND active=true',[trialPlanCode])
        if(!plan.rows[0])throw new Error('TRIAL_PLAN_NOT_FOUND')
        await client.query(`INSERT INTO licenses(user_id,plan_id,starts_at,expires_at,source)
          VALUES($1,$2,$3,$4,'trial')`,[user.rows[0].id,plan.rows[0].id,now,trialEnds])
        await client.query(`INSERT INTO trial_claims(hardware_hash,user_id,expires_at,ip_hash)
          VALUES($1,$2,$3,$4)`,[input.hardwareHash,user.rows[0].id,trialEnds,sha256('proxysplit-ip-v1:'+input.ip)])
      }
      await client.query('COMMIT')
      return {...user.rows[0],trialDays:grantTrial?trialDays:0,trialEndsAt:grantTrial?trialEnds:null,trialGranted:grantTrial}
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
      const replay=session.familyId!==input.familyId||session.tokenHash!==input.oldTokenHash||
        session.consumedAt||session.revokedAt||session.expiresAt<=new Date()
      if(replay){
        await client.query('UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE family_id=$1',[session.familyId])
        await client.query('COMMIT')
        return {ok:false,reason:'replay'} as const
      }
      if(session.fingerprintHash!==input.fingerprintHash){
        await client.query('ROLLBACK')
        return {ok:false,reason:'device'} as const
      }
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
      WHERE id=(SELECT id FROM licenses WHERE user_id=$1 ORDER BY expires_at DESC LIMIT 1) RETURNING id,expires_at AS "expiresAt"`,[userId,days])
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
        provider_order_no AS "providerOrderNo",pay_url AS "payUrl",paid_at AS "paidAt",expires_at AS "expiresAt",created_at AS "createdAt",
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
  async setOrderPayment(orderNoValue:string,providerOrderNo:string,payUrl:string){
    const r=await this.pool.query(`UPDATE orders SET provider_order_no=$2,pay_url=$3,updated_at=now()
      WHERE order_no=$1 AND status='pending' RETURNING order_no AS "orderNo"`,[orderNoValue,providerOrderNo,payUrl])
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
      pay_url AS "payUrl",paid_at AS "paidAt",expires_at AS "expiresAt",created_at AS "createdAt"
      FROM orders WHERE order_no=$1 AND user_id=$2`,[orderNoValue,userId])
    return r.rows[0]??null
  }
  async listUserOrders(userId:string){
    const r=await this.pool.query(`SELECT order_no AS "orderNo",plan_name AS "planName",amount_cents AS "amountCents",currency,status,
      pay_url AS "payUrl",paid_at AS "paidAt",expires_at AS "expiresAt",created_at AS "createdAt",
      group_id AS "groupId",split_index AS "splitIndex",split_total AS "splitTotal"
      FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`,[userId])
    return r.rows
  }
  async listPendingPaymentOrders(limit=20){
    const safeLimit=Math.min(100,Math.max(1,Math.floor(limit)))
    const r=await this.pool.query(`SELECT order_no AS "orderNo" FROM orders
      WHERE created_at>now()-interval '7 days'
        AND ((status='pending' AND created_at<now()-interval '20 seconds')
          OR (status='failed' AND updated_at<now()-interval '5 minutes'))
      ORDER BY updated_at ASC LIMIT $1`,[safeLimit])
    return r.rows as Array<{orderNo:string}>
  }
  async touchPaymentReconciliation(orderNoValue:string){
    await this.pool.query(`UPDATE orders SET updated_at=now() WHERE order_no=$1 AND status IN ('pending','failed')`,[orderNoValue])
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
      if(order.status!=='pending'&&order.status!=='failed')throw new Error('ORDER_NOT_PAYABLE')
      if(order.provider_order_no&&order.provider_order_no!==input.providerOrderNo)throw new Error('PROVIDER_ORDER_MISMATCH')
      if(order.group_id){
        // Split sub-order: mark THIS sub-order paid; grant the plan once, when
        // every sub-order in the group is paid (guarded by a group-level event
        // so concurrent last-payments cannot double-grant).
        await client.query(`UPDATE orders SET status='paid',provider_order_no=$2,paid_at=$3,updated_at=now() WHERE id=$1`,
          [order.id,input.providerOrderNo,input.paidAt??new Date()])
        const siblings=(await client.query(`SELECT status FROM orders WHERE group_id=$1 FOR UPDATE`,[order.group_id])).rows as Array<{status:string}>
        const allPaid=siblings.length>0&&siblings.every(s=>s.status==='paid')
        if(allPaid){
          const groupEvent=await client.query(`INSERT INTO payment_events(provider_code,event_id,order_no,payload_hash,verified,result)
            VALUES($1,$2,$3,'group',true,'fulfilled') ON CONFLICT(provider_code,event_id) DO NOTHING RETURNING id`,
            [input.providerCode,`group:${order.group_id}`,order.order_no])
          if(groupEvent.rows[0]){
            await this.grantWithinTx(client,{userId:order.user_id,planId:order.plan_id,durationDays:order.duration_days,lifetime:order.lifetime,source:'order',orderId:order.id})
          }
        }
        await client.query(`UPDATE payment_events SET result='fulfilled' WHERE id=$1`,[event.rows[0].id])
        await client.query('COMMIT')
        return {ok:true,duplicate:false,groupAllPaid:allPaid}
      }
      // Lock the logical user+tier slot before checking whether a license row
      // exists. FOR UPDATE cannot lock an absent row, so without this lock two
      // first payments can insert parallel 30-day licenses and lose one term.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`license:${order.user_id}:${order.tier}`])
      const existing=(await client.query(`SELECT l.id,l.plan_id,l.expires_at,l.lifetime FROM licenses l JOIN plans p ON p.id=l.plan_id
        WHERE l.user_id=$1 AND l.status='active' AND p.tier=$2 ORDER BY l.lifetime DESC,l.expires_at DESC LIMIT 1 FOR UPDATE`,
        [order.user_id,order.tier])).rows[0]
      const grant=resolvePaidLicenseGrant(existing?{
        planId:existing.plan_id,expiresAt:existing.expires_at,lifetime:existing.lifetime,
      }:null,{
        planId:order.plan_id,durationDays:order.duration_days,lifetime:order.lifetime,
      })
      if(existing){
        if(grant.changed)await client.query(`UPDATE licenses SET plan_id=$2,expires_at=$3,lifetime=$4,status='active',source='order',order_id=$5 WHERE id=$1`,
          [existing.id,grant.planId,grant.expiresAt,grant.lifetime,order.id])
      }else{
        await client.query(`INSERT INTO licenses(user_id,plan_id,expires_at,lifetime,source,order_id)
          VALUES($1,$2,$3,$4,'order',$5)`,[order.user_id,grant.planId,grant.expiresAt,grant.lifetime,order.id])
      }
      await client.query(`UPDATE orders SET status='paid',provider_order_no=$2,paid_at=$3,updated_at=now() WHERE id=$1`,
        [order.id,input.providerOrderNo,input.paidAt??new Date()])
      await client.query(`UPDATE payment_events SET result='fulfilled' WHERE id=$1`,[event.rows[0].id])
      await client.query('COMMIT')
      return {ok:true,duplicate:false}
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
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
      WHERE l.user_id=$1 AND l.status='active' AND p.tier=$2 ORDER BY l.lifetime DESC,l.expires_at DESC LIMIT 1 FOR UPDATE`,
      [opts.userId,plan.tier])).rows[0]
    const lifetime=opts.lifetime||!!plan.lifetime
    const durationDays=lifetime?null:(opts.durationDays??plan.duration_days)
    const grant=resolvePaidLicenseGrant(existing?{planId:existing.planId,expiresAt:existing.expiresAt,lifetime:existing.lifetime}:null,
      {planId:opts.planId,durationDays,lifetime})
    if(existing){
      if(grant.changed)await client.query(`UPDATE licenses SET plan_id=$2,expires_at=$3,lifetime=$4,status='active',source=$5,order_id=$6 WHERE id=$1`,
        [existing.id,grant.planId,grant.expiresAt,grant.lifetime,opts.source,opts.orderId??null])
    }else{
      await client.query(`INSERT INTO licenses(user_id,plan_id,expires_at,lifetime,source,order_id) VALUES($1,$2,$3,$4,$5,$6)`,
        [opts.userId,grant.planId,grant.expiresAt,grant.lifetime,opts.source,opts.orderId??null])
    }
    return grant
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
