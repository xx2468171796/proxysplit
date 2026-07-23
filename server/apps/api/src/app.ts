import Fastify, { type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { Redis } from 'ioredis'
import { AppError } from '@proxysplit/shared'
import { activateDeviceSchema, announcementUpsertSchema, leaseSchema, licenseExtendSchema, loginSchema, orderCreateSchema, planPatchSchema, planUpsertSchema, providerUpsertSchema, refreshSchema, registerSchema, releaseCreateSchema, settingPatchSchema, userCreateSchema, userStatusSchema } from '@proxysplit/contracts'
import { createCommercialCore, hashPassword, PaymentService, type AuthService, type PgStore } from '@proxysplit/core'
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
  app.post('/v1/auth/register',{config:{rateLimit:{max:3,timeWindow:'1 hour'}}},async(req)=>core.auth.register(registerSchema.parse(req.body),req.ip))
  app.post('/v1/auth/login',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(req)=>core.auth.login(loginSchema.parse(req.body),req.ip))
  app.post('/v1/auth/refresh',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(req)=>core.auth.rotate(refreshSchema.parse(req.body),req.ip))
  app.post('/v1/me/device/activate',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(req)=>{const p=await auth(req);if(p.deviceId!=='pending')throw new AppError('DEVICE_ALREADY_ACTIVE','当前设备已激活',409);return core.auth.activateDevice(p.userId,activateDeviceSchema.parse(req.body).device,req.ip)})
  app.post('/v1/auth/logout',async(req)=>core.auth.logout(refreshSchema.parse(req.body),req.ip))
  app.post('/v1/license/lease',async(req)=>{const p=await auth(req);const input=leaseSchema.parse(req.body);return core.auth.lease(p.userId,p.deviceId,input.deviceFingerprint,input.appVersion)})
  const payments=new PaymentService(core.store,config.PUBLIC_BASE_URL.replace(/\/$/,''))
  app.get('/v1/releases/latest',async()=>({release:await core.store.latestRelease()}))
  app.get('/v1/releases',async()=>({items:await core.store.listReleases()}))
  app.get('/v1/catalog/plans',async()=>({items:await core.store.listPlans(true),paymentMethods:(await core.store.getCommerceSettings()).paymentMethods}))
  app.get('/v1/announcements',async()=>({items:await core.store.listAnnouncements(true)}))
  app.get('/v1/me',async(req)=>{const p=await auth(req);const user=await core.store.findUserById(p.userId);return {user:user&&{id:user.id,username:user.username,status:user.status},membership:await core.store.entitlement(p.userId),devices:await core.store.listUserDevices(p.userId)}})
  app.get('/v1/me/devices',async(req)=>{const p=await auth(req);return {items:await core.store.listUserDevices(p.userId)}})
  app.delete('/v1/me/devices/:id',async(req)=>{const p=await auth(req);const id=(req.params as {id:string}).id;const row=await core.store.unbindDevice(id,p.userId);if(!row)throw new AppError('NOT_FOUND','设备不存在',404);await core.store.audit(p.userId,'user.device.unbind','device',id,req.ip,'success');return {ok:true}})
  app.get('/v1/me/orders',async(req)=>{const p=await auth(req);return {items:await core.store.listUserOrders(p.userId)}})
  app.get('/v1/me/orders/:orderNo',async(req)=>{const p=await auth(req);const row=await core.store.getOrderForUser((req.params as {orderNo:string}).orderNo,p.userId);if(!row)throw new AppError('NOT_FOUND','订单不存在',404);return row})
  app.post('/v1/orders',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(req)=>{const p=await auth(req);const input=orderCreateSchema.parse(req.body);const user=await core.store.findUserById(p.userId);if(!user)throw new AppError('NOT_FOUND','用户不存在',404);try{return await payments.createOrder(p.userId,input.planId,user.username)}catch(error){const message=(error as Error).message;if(message==='PAYMENT_UNAVAILABLE')throw new AppError('PAYMENT_UNAVAILABLE','支付通道暂不可用',503);if(message==='PLAN_NOT_AVAILABLE')throw new AppError('PLAN_NOT_AVAILABLE','套餐已下架或不在活动时间内',404);if(message==='PURCHASE_LIMIT')throw new AppError('PURCHASE_LIMIT','已达到该活动套餐的购买次数上限',409);throw error}})
  app.post('/v1/payments/zhongzhuan/notify',{config:{rateLimit:{max:120,timeWindow:'1 minute'}}},async(req,reply)=>{
    try{await payments.handleZhongzhuanCallback(req.body);return {code:0,message:'success'}}
    catch(error){app.log.error({err:error instanceof Error?error.message:'callback failed'},'payment callback rejected');const status=error instanceof AppError?error.status:500;return reply.code(status>=500?500:status).send({code:status,message:'failed'})}
  })

  app.get('/v1/admin/dashboard',async(req)=>{await admin(req);return core.store.dashboard()})
  app.get('/v1/admin/users',async(req)=>{await admin(req);return {items:await core.store.listUsers()}})
  app.get('/v1/admin/users/:id',async(req)=>{await admin(req);const row=await core.store.getUserDetail((req.params as {id:string}).id);if(!row)throw new AppError('NOT_FOUND','用户不存在',404);return row})
  app.post('/v1/admin/users',async(req)=>{const p=await admin(req);const input=userCreateSchema.parse(req.body);const passwordHash=await hashPassword(input.password);const created=await core.store.createUserWithLicense({username:input.username,role:input.role,days:input.days,passwordHash,...(input.planId?{planId:input.planId}:{})});await core.store.audit(p.userId,'admin.user.create','user',created.id,req.ip,'success');return created})
  app.patch('/v1/admin/users/:id/status',async(req)=>{const p=await admin(req);const input=userStatusSchema.parse(req.body);const id=(req.params as {id:string}).id;if(!await core.store.setUserStatus(id,input.status))throw new AppError('NOT_FOUND','Resource not found',404);await core.store.audit(p.userId,'admin.user.status','user',id,req.ip,'success',{status:input.status});return {ok:true}})
  app.post('/v1/admin/users/:id/extend',async(req)=>{const p=await admin(req);const input=licenseExtendSchema.parse(req.body);const id=(req.params as {id:string}).id;const license=await core.store.extendLicense(id,input.days);if(!license)throw new AppError('NOT_FOUND','Resource not found',404);await core.store.audit(p.userId,'admin.license.extend','user',id,req.ip,'success',{days:input.days});return license})
  app.get('/v1/admin/devices',async(req)=>{await admin(req);return {items:await core.store.listDevices()}})
  app.delete('/v1/admin/devices/:id',async(req)=>{const p=await admin(req);const id=(req.params as {id:string}).id;const row=await core.store.unbindDevice(id);if(!row)throw new AppError('NOT_FOUND','Resource not found',404);await core.store.audit(p.userId,'admin.device.unbind','device',id,req.ip,'success');return {ok:true}})
  app.get('/v1/admin/plans',async(req)=>{await admin(req);return {items:await core.store.listPlans(false)}})
  app.post('/v1/admin/plans',async(req)=>{const p=await admin(req);const input=planUpsertSchema.parse(req.body);const row=await core.store.createPlan(input);await core.store.audit(p.userId,'admin.plan.create','plan',row.id,req.ip,'success',{code:row.code});return row})
  app.patch('/v1/admin/plans/:id',async(req)=>{const p=await admin(req);const id=(req.params as {id:string}).id;const row=await core.store.updatePlan(id,planPatchSchema.parse(req.body));if(!row)throw new AppError('NOT_FOUND','套餐不存在',404);await core.store.audit(p.userId,'admin.plan.update','plan',id,req.ip,'success');return row})
  app.get('/v1/admin/settings/commerce',async(req)=>{await admin(req);return core.store.getCommerceSettings()})
  app.patch('/v1/admin/settings/commerce',async(req)=>{const p=await admin(req);const parsed=settingPatchSchema.parse(req.body);const input=Object.fromEntries(Object.entries(parsed).filter(([,v])=>v!==undefined));const row=await core.store.updateCommerceSettings(input,p.userId);await core.store.audit(p.userId,'admin.settings.commerce','settings','commerce',req.ip,'success');return row})
  app.get('/v1/admin/payment-providers',async(req)=>{await admin(req);return {items:await core.store.listProviders()}})
  app.put('/v1/admin/payment-providers/:code',async(req)=>{const p=await admin(req);const code=(req.params as {code:string}).code;const input=providerUpsertSchema.parse({...req.body as object,code});const row=await core.store.upsertProvider(input);await core.store.audit(p.userId,'admin.payment-provider.update','payment-provider',code,req.ip,'success');return row})
  app.post('/v1/admin/payment-providers/:code/activate',async(req)=>{const p=await admin(req);const code=(req.params as {code:string}).code;const provider=await core.store.getProvider(code);if(!provider||!provider.enabled)throw new AppError('PAYMENT_PROVIDER_DISABLED','支付通道未启用',409);const row=await core.store.updateCommerceSettings({activePaymentProvider:code},p.userId);await core.store.audit(p.userId,'admin.payment-provider.activate','payment-provider',code,req.ip,'success');return row})
  app.get('/v1/admin/orders',async(req)=>{await admin(req);return {items:await core.store.listOrders()}})
  app.get('/v1/admin/announcements',async(req)=>{await admin(req);return {items:await core.store.listAnnouncements(false)}})
  app.post('/v1/admin/announcements',async(req)=>{const p=await admin(req);const row=await core.store.createAnnouncement(announcementUpsertSchema.parse(req.body),p.userId);await core.store.audit(p.userId,'admin.announcement.create','announcement',row.id,req.ip,'success');return row})
  app.put('/v1/admin/announcements/:id',async(req)=>{const p=await admin(req);const id=(req.params as {id:string}).id;const row=await core.store.updateAnnouncement(id,announcementUpsertSchema.parse(req.body));if(!row)throw new AppError('NOT_FOUND','公告不存在',404);await core.store.audit(p.userId,'admin.announcement.update','announcement',id,req.ip,'success');return row})
  app.delete('/v1/admin/announcements/:id',async(req)=>{const p=await admin(req);const id=(req.params as {id:string}).id;const row=await core.store.deleteAnnouncement(id);if(!row)throw new AppError('NOT_FOUND','公告不存在',404);await core.store.audit(p.userId,'admin.announcement.delete','announcement',id,req.ip,'success');return {ok:true}})
  app.get('/v1/admin/releases',async(req)=>{await admin(req);return {items:await core.store.listReleases()}})
  app.post('/v1/admin/releases',async(req)=>{const p=await admin(req);const input=releaseCreateSchema.parse(req.body);const row=await core.store.createRelease(input);await core.store.audit(p.userId,'admin.release.create','release',row.id,req.ip,'success',{version:input.version});return row})
  app.get('/v1/admin/audit',async(req)=>{await admin(req);return {items:await core.store.listAudit()}})
  app.addHook('onClose',async()=>{if(redis)redis.disconnect();if(!provided)await core.close()})
  return app
}
