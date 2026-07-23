import { createDatabase } from '@proxysplit/db'

export type UserRecord = { id:string; username:string; passwordHash:string; role:'user'|'admin'; status:'active'|'suspended'|'banned'; createdAt:Date }
export type Entitlement = { licenseId:string; planId:string; planName:string; maxDevices:number; features:string[]; expiresAt:Date; status:string }
export type DeviceRecord = { id:string; userId:string; fingerprintHash:string; name:string; platform:string; appVersion:string; revoked:boolean }
export type SessionRecord = { jti:string; familyId:string; userId:string; deviceId:string; tokenHash:string; consumedAt:Date|null; revokedAt:Date|null; expiresAt:Date; fingerprintHash:string }
export type ReleaseRecord = { version:string; minimumVersion:string; url:string; sha256:string; signature:string; mandatory:boolean; publishedAt:Date }

export class PgStore {
  readonly pool: ReturnType<typeof createDatabase>['pool']
  constructor(url:string) { this.pool=createDatabase(url).pool }
  async close(){ await this.pool.end() }
  async findUser(username:string):Promise<UserRecord|null>{
    const r=await this.pool.query('SELECT id,username,password_hash AS "passwordHash",role,status,created_at AS "createdAt" FROM users WHERE username=$1',[username]); return r.rows[0]??null
  }
  async findUserById(id:string):Promise<UserRecord|null>{ const r=await this.pool.query('SELECT id,username,password_hash AS "passwordHash",role,status,created_at AS "createdAt" FROM users WHERE id=$1',[id]); return r.rows[0]??null }
  async entitlement(userId:string):Promise<Entitlement|null>{
    const r=await this.pool.query(`SELECT l.id AS "licenseId",p.id AS "planId",p.name AS "planName",p.max_devices AS "maxDevices",p.features,l.expires_at AS "expiresAt",l.status
      FROM licenses l JOIN plans p ON p.id=l.plan_id WHERE l.user_id=$1 AND l.status='active' AND l.expires_at>now() ORDER BY l.expires_at DESC LIMIT 1`,[userId]); return r.rows[0]??null
  }
  async bindDevice(userId:string,fingerprintHash:string,name:string,platform:string,appVersion:string,maxDevices:number):Promise<DeviceRecord>{
    const client=await this.pool.connect(); try { await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[userId])
      const existing=await client.query('SELECT id,user_id AS "userId",fingerprint_hash AS "fingerprintHash",name,platform,app_version AS "appVersion",revoked FROM devices WHERE user_id=$1 AND fingerprint_hash=$2',[userId,fingerprintHash])
      let row:DeviceRecord
      if(existing.rows[0]){ if(existing.rows[0].revoked) throw new Error('DEVICE_REVOKED'); const r=await client.query('UPDATE devices SET name=$2,platform=$3,app_version=$4,last_seen_at=now() WHERE id=$1 RETURNING id,user_id AS "userId",fingerprint_hash AS "fingerprintHash",name,platform,app_version AS "appVersion",revoked',[existing.rows[0].id,name,platform,appVersion]); row=r.rows[0] }
      else { const count=await client.query('SELECT count(*)::int AS n FROM devices WHERE user_id=$1 AND revoked=false',[userId]); if(count.rows[0].n>=maxDevices) throw new Error('DEVICE_LIMIT'); const r=await client.query('INSERT INTO devices(user_id,fingerprint_hash,name,platform,app_version) VALUES($1,$2,$3,$4,$5) RETURNING id,user_id AS "userId",fingerprint_hash AS "fingerprintHash",name,platform,app_version AS "appVersion",revoked',[userId,fingerprintHash,name,platform,appVersion]); row=r.rows[0] }
      await client.query('COMMIT'); return row
    } catch(e){await client.query('ROLLBACK');throw e} finally{client.release()}
  }
  async touchDevice(id:string,appVersion:string){await this.pool.query('UPDATE devices SET app_version=$2,last_seen_at=now() WHERE id=$1',[id,appVersion])}
  async findDevice(id:string):Promise<DeviceRecord|null>{const r=await this.pool.query('SELECT id,user_id AS "userId",fingerprint_hash AS "fingerprintHash",name,platform,app_version AS "appVersion",revoked FROM devices WHERE id=$1',[id]);return r.rows[0]??null}
  async createSession(v:{userId:string;deviceId:string;familyId:string;jti:string;tokenHash:string;expiresAt:Date}){await this.pool.query('INSERT INTO sessions(user_id,device_id,family_id,jti,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[v.userId,v.deviceId,v.familyId,v.jti,v.tokenHash,v.expiresAt])}
  async findSession(jti:string):Promise<SessionRecord|null>{const r=await this.pool.query(`SELECT s.jti,s.family_id AS "familyId",s.user_id AS "userId",s.device_id AS "deviceId",s.token_hash AS "tokenHash",s.consumed_at AS "consumedAt",s.revoked_at AS "revokedAt",s.expires_at AS "expiresAt",d.fingerprint_hash AS "fingerprintHash" FROM sessions s JOIN devices d ON d.id=s.device_id WHERE s.jti=$1`,[jti]);return r.rows[0]??null}
  async consumeSession(jti:string){const r=await this.pool.query('UPDATE sessions SET consumed_at=now() WHERE jti=$1 AND consumed_at IS NULL AND revoked_at IS NULL RETURNING jti',[jti]);return r.rowCount===1}
  async revokeFamily(familyId:string){await this.pool.query('UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE family_id=$1',[familyId])}
  async audit(actor:string|null,action:string,targetType:string,targetId:string,ip:string,result:string,metadata:Record<string,unknown>={}){await this.pool.query('INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,ip,result,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)',[actor,action,targetType,targetId,ip,result,metadata])}
  async latestRelease():Promise<ReleaseRecord|null>{const r=await this.pool.query('SELECT version,minimum_version AS "minimumVersion",url,sha256,signature,mandatory,published_at AS "publishedAt" FROM releases ORDER BY published_at DESC LIMIT 1');return r.rows[0]??null}
  async dashboard(){const r=await this.pool.query(`SELECT (SELECT count(*)::int FROM users) users,(SELECT count(*)::int FROM licenses WHERE status='active' AND expires_at>now()) licenses,(SELECT count(*)::int FROM devices WHERE revoked=false AND last_seen_at>now()-interval '15 minutes') online,(SELECT count(*)::int FROM licenses WHERE status='active' AND expires_at BETWEEN now() AND now()+interval '7 days') expiring`);return r.rows[0]}
  async listUsers(){const r=await this.pool.query(`SELECT u.id,u.username,u.role,u.status,u.note,u.created_at AS "createdAt",l.expires_at AS "expiresAt",p.name AS "planName",(SELECT count(*)::int FROM devices d WHERE d.user_id=u.id AND d.revoked=false) AS devices FROM users u LEFT JOIN LATERAL (SELECT * FROM licenses WHERE user_id=u.id ORDER BY expires_at DESC LIMIT 1) l ON true LEFT JOIN plans p ON p.id=l.plan_id ORDER BY u.created_at DESC LIMIT 500`);return r.rows}
  async createUserWithLicense(input:{username:string;passwordHash:string;role:string;planId?:string;days:number}){const c=await this.pool.connect();try{await c.query('BEGIN');const u=await c.query('INSERT INTO users(username,password_hash,role) VALUES($1,$2,$3) RETURNING id,username,role,status',[input.username,input.passwordHash,input.role]);const p=input.planId?await c.query('SELECT id FROM plans WHERE id=$1',[input.planId]):await c.query('SELECT id FROM plans ORDER BY max_devices LIMIT 1');if(!p.rows[0])throw new Error('PLAN_NOT_FOUND');await c.query(`INSERT INTO licenses(user_id,plan_id,expires_at) VALUES($1,$2,now()+($3||' days')::interval)`,[u.rows[0].id,p.rows[0].id,input.days]);await c.query('COMMIT');return u.rows[0]}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
  async setUserStatus(id:string,status:string){const r=await this.pool.query('UPDATE users SET status=$2,updated_at=now() WHERE id=$1 RETURNING id',[id,status]);return r.rowCount===1}
  async extendLicense(userId:string,days:number){const r=await this.pool.query(`UPDATE licenses SET expires_at=greatest(expires_at,now())+($2||' days')::interval,status='active' WHERE id=(SELECT id FROM licenses WHERE user_id=$1 ORDER BY expires_at DESC LIMIT 1) RETURNING id,expires_at AS "expiresAt"`,[userId,days]);return r.rows[0]??null}
  async revokeDevice(id:string){const r=await this.pool.query('UPDATE devices SET revoked=true WHERE id=$1 RETURNING user_id AS "userId"',[id]);if(r.rows[0])await this.pool.query('UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE device_id=$1',[id]);return r.rows[0]??null}
  async listDevices(){const r=await this.pool.query('SELECT d.id,d.user_id AS "userId",u.username,d.name,d.platform,d.app_version AS "appVersion",d.revoked,d.first_seen_at AS "firstSeenAt",d.last_seen_at AS "lastSeenAt" FROM devices d JOIN users u ON u.id=d.user_id ORDER BY d.last_seen_at DESC LIMIT 1000');return r.rows}
  async listReleases(){const r=await this.pool.query('SELECT id,version,minimum_version AS "minimumVersion",url,sha256,signature,mandatory,published_at AS "publishedAt" FROM releases ORDER BY published_at DESC');return r.rows}
  async createRelease(v:{version:string;minimumVersion:string;url:string;sha256:string;signature:string;mandatory:boolean}){const r=await this.pool.query('INSERT INTO releases(version,minimum_version,url,sha256,signature,mandatory) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,version',[v.version,v.minimumVersion,v.url,v.sha256,v.signature,v.mandatory]);return r.rows[0]}
  async listAudit(){const r=await this.pool.query('SELECT a.id,a.action,a.target_type AS "targetType",a.target_id AS "targetId",a.ip,a.result,a.metadata,a.created_at AS "createdAt",u.username AS actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.created_at DESC LIMIT 1000');return r.rows}
  async bootstrapAdmin(username:string,passwordHash:string){await this.pool.query(`INSERT INTO users(username,password_hash,role,status) VALUES($1,$2,'admin','active') ON CONFLICT(username) DO NOTHING`,[username,passwordHash])}
}
