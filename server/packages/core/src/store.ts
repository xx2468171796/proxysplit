import { createHash, randomBytes } from 'node:crypto'
import { createDatabase } from '@proxysplit/db'
import type { AnnouncementUpsertInput, PlanPatchInput, PlanUpsertInput, ProviderUpsertInput } from '@proxysplit/contracts'

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
  expiresAt:Date; createdAt:Date
}

const sha256=(value:string)=>createHash('sha256').update(value).digest('hex')
const orderNo=()=>`PS${new Date().toISOString().replace(/\D/g,'').slice(0,14)}${randomBytes(5).toString('hex').toUpperCase()}`
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

  async latestRelease():Promise<ReleaseRecord|null>{
    const r=await this.pool.query('SELECT version,minimum_version AS "minimumVersion",url,sha256,signature,mandatory,title,summary,changelog,channel,published_at AS "publishedAt" FROM releases ORDER BY published_at DESC LIMIT 1')
    return r.rows[0]??null
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
  async listUsers(){
    const r=await this.pool.query(`SELECT u.id,u.username,u.email,u.role,u.status,u.note,u.created_at AS "createdAt",
      l.expires_at AS "expiresAt",l.lifetime,p.name AS "planName",p.tier,
      (SELECT count(*)::int FROM devices d WHERE d.user_id=u.id AND d.revoked=false) AS devices
      FROM users u LEFT JOIN LATERAL (
        SELECT * FROM licenses WHERE user_id=u.id AND status='active' AND expires_at>now() ORDER BY lifetime DESC,expires_at DESC LIMIT 1
      ) l ON true LEFT JOIN plans p ON p.id=l.plan_id ORDER BY u.created_at DESC LIMIT 500`)
    return r.rows
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
  async listDevices(){
    const r=await this.pool.query(`SELECT d.id,d.user_id AS "userId",u.username,d.name,d.platform,d.app_version AS "appVersion",
      d.revoked,d.first_seen_at AS "firstSeenAt",d.last_seen_at AS "lastSeenAt"
      FROM devices d JOIN users u ON u.id=d.user_id ORDER BY d.last_seen_at DESC LIMIT 1000`)
    return r.rows
  }
  async listReleases(){const r=await this.pool.query('SELECT id,version,minimum_version AS "minimumVersion",url,sha256,signature,mandatory,title,summary,changelog,channel,published_at AS "publishedAt" FROM releases ORDER BY published_at DESC');return r.rows}
  async createRelease(v:{version:string;minimumVersion:string;url:string;sha256:string;signature:string;mandatory:boolean;title:string;summary:string;changelog:string;channel:string}){
    const r=await this.pool.query('INSERT INTO releases(version,minimum_version,url,sha256,signature,mandatory,title,summary,changelog,channel) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,version',[v.version,v.minimumVersion,v.url,v.sha256,v.signature,v.mandatory,v.title,v.summary,v.changelog,v.channel])
    return r.rows[0]
  }
  async listAudit(){
    const r=await this.pool.query(`SELECT a.id,a.action,a.target_type AS "targetType",a.target_id AS "targetId",a.ip,a.result,a.metadata,
      a.created_at AS "createdAt",u.username AS actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.created_at DESC LIMIT 1000`)
    return r.rows
  }

  async listPlans(publicOnly=false){
    const where=publicOnly?`WHERE active=true AND public=true AND (sale_starts_at IS NULL OR sale_starts_at<=now()) AND (sale_ends_at IS NULL OR sale_ends_at>now())`:''
    const r=await this.pool.query(`SELECT id,code,name,description,tier,billing_cycle AS "billingCycle",duration_days AS "durationDays",
      lifetime,price_cents AS "priceCents",original_price_cents AS "originalPriceCents",currency,max_devices AS "maxDevices",features,active,public,sort_order AS "sortOrder",badge,
      sale_starts_at AS "saleStartsAt",sale_ends_at AS "saleEndsAt",purchase_limit_per_user AS "purchaseLimitPerUser",
      created_at AS "createdAt",updated_at AS "updatedAt" FROM plans ${where} ORDER BY sort_order,name`)
    return r.rows
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

  async createOrder(userId:string,planId:string):Promise<OrderRecord>{
    const settings=await this.getCommerceSettings()
    const provider=await this.getProvider(settings.activePaymentProvider)
    if(!provider||!provider.enabled)throw new Error('PAYMENT_UNAVAILABLE')
    const configuredTimeout=Number(provider.config.orderTimeoutMinutes)
    const timeoutMinutes=Number.isFinite(configuredTimeout)?Math.min(60,Math.max(5,Math.floor(configuredTimeout))):10
    const expiresAt=new Date(Date.now()+timeoutMinutes*60_000)
    const plan=(await this.pool.query(`SELECT id,name,tier,billing_cycle,duration_days,lifetime,price_cents,currency,purchase_limit_per_user
      FROM plans WHERE id=$1 AND active=true AND public=true AND (sale_starts_at IS NULL OR sale_starts_at<=now()) AND (sale_ends_at IS NULL OR sale_ends_at>now())`,[planId])).rows[0]
    if(!plan)throw new Error('PLAN_NOT_AVAILABLE')
    if(plan.purchase_limit_per_user){
      const count=await this.pool.query(`SELECT count(*)::int AS n FROM orders WHERE user_id=$1 AND plan_id=$2 AND status='paid'`,[userId,planId])
      if(count.rows[0].n>=plan.purchase_limit_per_user)throw new Error('PURCHASE_LIMIT')
    }
    const no=orderNo()
    const r=await this.pool.query(`INSERT INTO orders(order_no,user_id,plan_id,plan_name,tier,billing_cycle,duration_days,lifetime,amount_cents,currency,provider_code,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id,order_no AS "orderNo",user_id AS "userId",plan_id AS "planId",plan_name AS "planName",tier,billing_cycle AS "billingCycle",
      duration_days AS "durationDays",lifetime,amount_cents AS "amountCents",currency,status,provider_code AS "providerCode",
      provider_order_no AS "providerOrderNo",pay_url AS "payUrl",paid_at AS "paidAt",expires_at AS "expiresAt",created_at AS "createdAt"`,
      [no,userId,plan.id,plan.name,plan.tier,plan.billing_cycle,plan.duration_days,plan.lifetime,plan.price_cents,plan.currency,provider.code,expiresAt])
    return r.rows[0]
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
      pay_url AS "payUrl",paid_at AS "paidAt",expires_at AS "expiresAt",created_at AS "createdAt"
      FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`,[userId])
    return r.rows
  }
  async listPendingPaymentOrders(limit=20){
    const safeLimit=Math.min(100,Math.max(1,Math.floor(limit)))
    const r=await this.pool.query(`SELECT order_no AS "orderNo" FROM orders
      WHERE status='pending' AND created_at>now()-interval '24 hours'
      ORDER BY updated_at ASC LIMIT $1`,[safeLimit])
    return r.rows as Array<{orderNo:string}>
  }
  async listOrders(){
    const r=await this.pool.query(`SELECT o.id,o.order_no AS "orderNo",u.username,o.plan_name AS "planName",o.tier,
      o.amount_cents AS "amountCents",o.currency,o.status,o.provider_code AS "providerCode",o.provider_order_no AS "providerOrderNo",
      o.paid_at AS "paidAt",o.created_at AS "createdAt" FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 1000`)
    return r.rows
  }
  async fulfillPaidOrder(input:{providerCode:string;eventId:string;orderNo:string;amountCents:number;providerOrderNo:string;payloadHash:string}){
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
      const existing=(await client.query(`SELECT l.id,l.expires_at,l.lifetime FROM licenses l JOIN plans p ON p.id=l.plan_id
        WHERE l.user_id=$1 AND l.status='active' AND p.tier=$2 ORDER BY l.lifetime DESC,l.expires_at DESC LIMIT 1 FOR UPDATE`,
        [order.user_id,order.tier])).rows[0]
      const permanentDate=new Date('2999-12-31T23:59:59.000Z')
      if(existing){
        const base=existing.expires_at>new Date()?existing.expires_at:new Date()
        const expires=order.lifetime?permanentDate:new Date(base.getTime()+Number(order.duration_days)*86400000)
        await client.query(`UPDATE licenses SET plan_id=$2,expires_at=$3,lifetime=$4,status='active',source='order',order_id=$5 WHERE id=$1`,
          [existing.id,order.plan_id,expires,order.lifetime,order.id])
      }else{
        const expires=order.lifetime?permanentDate:new Date(Date.now()+Number(order.duration_days)*86400000)
        await client.query(`INSERT INTO licenses(user_id,plan_id,expires_at,lifetime,source,order_id)
          VALUES($1,$2,$3,$4,'order',$5)`,[order.user_id,order.plan_id,expires,order.lifetime,order.id])
      }
      await client.query(`UPDATE orders SET status='paid',provider_order_no=$2,paid_at=now(),updated_at=now() WHERE id=$1`,[order.id,input.providerOrderNo])
      await client.query(`UPDATE payment_events SET result='fulfilled' WHERE id=$1`,[event.rows[0].id])
      await client.query('COMMIT')
      return {ok:true,duplicate:false}
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }

  async listAnnouncements(publicOnly=false){
    const where=publicOnly?`WHERE active=true AND (starts_at IS NULL OR starts_at<=now()) AND (ends_at IS NULL OR ends_at>now())`:''
    const r=await this.pool.query(`SELECT id,type,title,summary,content,version,active,pinned,published_at AS "publishedAt",
      starts_at AS "startsAt",ends_at AS "endsAt",created_at AS "createdAt",updated_at AS "updatedAt"
      FROM announcements ${where} ORDER BY pinned DESC,published_at DESC LIMIT 200`)
    return r.rows
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
  async bootstrapAdmin(username:string,passwordHash:string){
    await this.pool.query(`INSERT INTO users(username,password_hash,role,status) VALUES($1,$2,'admin','active') ON CONFLICT(username) DO NOTHING`,[username,passwordHash])
  }
}
