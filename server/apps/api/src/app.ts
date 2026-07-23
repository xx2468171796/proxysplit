import Fastify, { type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { Redis } from 'ioredis'
import { AppError } from '@proxysplit/shared'
import { leaseSchema, licenseExtendSchema, loginSchema, refreshSchema, releaseCreateSchema, userCreateSchema, userStatusSchema } from '@proxysplit/contracts'
import { createCommercialCore, hashPassword, type AuthService, type PgStore } from '@proxysplit/core'
import type { ApiConfig } from './config.js'

type Core={auth:AuthService;store:PgStore;close:()=>Promise<void>}
const bearer=(value?:string)=>value?.startsWith('Bearer ')?value.slice(7):''
export async function buildApp(config:ApiConfig,provided?:Core){
  const core=provided??await createCommercialCore({databaseUrl:config.DATABASE_URL,auth:{accessSecret:config.ACCESS_TOKEN_SECRET,refreshDays:config.REFRESH_TOKEN_TTL_DAYS,...(config.LICENSE_PRIVATE_KEY_PEM?{licensePrivateKeyPem:config.LICENSE_PRIVATE_KEY_PEM}:{}),...(config.LICENSE_PUBLIC_KEY_PEM?{licensePublicKeyPem:config.LICENSE_PUBLIC_KEY_PEM}:{})},...(config.BOOTSTRAP_ADMIN_USERNAME&&config.BOOTSTRAP_ADMIN_PASSWORD?{bootstrapAdmin:{username:config.BOOTSTRAP_ADMIN_USERNAME,password:config.BOOTSTRAP_ADMIN_PASSWORD}}:{})})
  const app=Fastify({logger:{level:config.NODE_ENV==='test'?'silent':'info'},trustProxy:true})
  let redis:Redis|undefined
  if(config.REDIS_URL){redis=new Redis(config.REDIS_URL,{maxRetriesPerRequest:1,enableOfflineQueue:false});redis.on('error',()=>{})}
  await app.register(cors,{origin:[config.ADMIN_ORIGIN],credentials:false})
  await app.register(rateLimit,{global:false,max:10,timeWindow:'1 minute',...(redis?{redis}:{})})
  app.setErrorHandler((error,_req,reply)=>{if(error instanceof AppError)return reply.code(error.status).send({error:{code:error.code,message:error.message}});if((error as {issues?:unknown}).issues)return reply.code(400).send({error:{code:'VALIDATION_ERROR',message:'Invalid request'}});app.log.error(error);return reply.code(500).send({error:{code:'INTERNAL_ERROR',message:'Service temporarily unavailable'}})})
  const auth=async(req:FastifyRequest)=>core.auth.verifyAccess(bearer(req.headers.authorization))
  const admin=async(req:FastifyRequest)=>{const principal=await auth(req);if(principal.role!=='admin')throw new AppError('ADMIN_REQUIRED','Administrator permission required',403);return principal}

  app.get('/health',async()=>({ok:true,service:'proxysplit-commercial-api'}))
  app.get('/v1/auth/public-key',async()=>({algorithm:'Ed25519',kid:'proxysplit-license-v1',publicKeyPem:core.auth.publicKeyPem}))
  app.post('/v1/auth/login',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(req)=>core.auth.login(loginSchema.parse(req.body),req.ip))
  app.post('/v1/auth/refresh',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(req)=>core.auth.rotate(refreshSchema.parse(req.body),req.ip))
  app.post('/v1/auth/logout',async(req)=>core.auth.logout(refreshSchema.parse(req.body),req.ip))
  app.post('/v1/license/lease',async(req)=>{const p=await auth(req);const input=leaseSchema.parse(req.body);return core.auth.lease(p.userId,p.deviceId,input.deviceFingerprint,input.appVersion)})
  app.get('/v1/releases/latest',async()=>({release:await core.store.latestRelease()}))

  app.get('/v1/admin/dashboard',async(req)=>{await admin(req);return core.store.dashboard()})
  app.get('/v1/admin/users',async(req)=>{await admin(req);return {items:await core.store.listUsers()}})
  app.post('/v1/admin/users',async(req)=>{const p=await admin(req);const input=userCreateSchema.parse(req.body);const passwordHash=await hashPassword(input.password);const created=await core.store.createUserWithLicense({username:input.username,role:input.role,days:input.days,passwordHash,...(input.planId?{planId:input.planId}:{})});await core.store.audit(p.userId,'admin.user.create','user',created.id,req.ip,'success');return created})
  app.patch('/v1/admin/users/:id/status',async(req)=>{const p=await admin(req);const input=userStatusSchema.parse(req.body);const id=(req.params as {id:string}).id;if(!await core.store.setUserStatus(id,input.status))throw new AppError('NOT_FOUND','Resource not found',404);await core.store.audit(p.userId,'admin.user.status','user',id,req.ip,'success',{status:input.status});return {ok:true}})
  app.post('/v1/admin/users/:id/extend',async(req)=>{const p=await admin(req);const input=licenseExtendSchema.parse(req.body);const id=(req.params as {id:string}).id;const license=await core.store.extendLicense(id,input.days);if(!license)throw new AppError('NOT_FOUND','Resource not found',404);await core.store.audit(p.userId,'admin.license.extend','user',id,req.ip,'success',{days:input.days});return license})
  app.get('/v1/admin/devices',async(req)=>{await admin(req);return {items:await core.store.listDevices()}})
  app.delete('/v1/admin/devices/:id',async(req)=>{const p=await admin(req);const id=(req.params as {id:string}).id;const row=await core.store.revokeDevice(id);if(!row)throw new AppError('NOT_FOUND','Resource not found',404);await core.store.audit(p.userId,'admin.device.revoke','device',id,req.ip,'success');return {ok:true}})
  app.get('/v1/admin/releases',async(req)=>{await admin(req);return {items:await core.store.listReleases()}})
  app.post('/v1/admin/releases',async(req)=>{const p=await admin(req);const input=releaseCreateSchema.parse(req.body);const row=await core.store.createRelease(input);await core.store.audit(p.userId,'admin.release.create','release',row.id,req.ip,'success',{version:input.version});return row})
  app.get('/v1/admin/audit',async(req)=>{await admin(req);return {items:await core.store.listAudit()}})
  app.addHook('onClose',async()=>{if(redis)redis.disconnect();if(!provided)await core.close()})
  return app
}
