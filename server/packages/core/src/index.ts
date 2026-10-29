export * from './auth.js'
export * from './store.js'
export * from './payments.js'
export * from './accel.js'
export * from './fenxiao.js'
export { FenxiaoService, maskName } from './fenxiao-service.js'
export { TelemetryStore, clampTs, lastStart, pgJson, type Db as TelemetryDb } from './telemetry-store.js'
export { TelemetryQuery, logWindow, matchLines } from './telemetry-query.js'
export { ClientNodesStore, LinkCipher, diffInventory, sha256Hex } from './client-nodes-store.js'
export { ClientNodesQuery, type RevealResult } from './client-nodes-query.js'
export * from './entitlement.js'
export * from './phone-auth.js'
export * from './notify.js'
export * from './notify-events.js'
export * from './config-sync.js'
export * from './config-profiles.js'
import { hashPassword, AuthService, type AuthConfig } from './auth.js'
import { PgStore } from './store.js'
import { FenxiaoService } from './fenxiao-service.js'
export async function createCommercialCore(config:{databaseUrl:string;auth:AuthConfig;bootstrapAdmin?:{username:string;password:string}}){
  const store=new PgStore(config.databaseUrl)
  if(config.bootstrapAdmin?.username&&config.bootstrapAdmin.password){await store.bootstrapAdmin(config.bootstrapAdmin.username.toLowerCase(),await hashPassword(config.bootstrapAdmin.password))}
  const auth=await AuthService.create(store,config.auth)
  return {store,auth,fenxiao:new FenxiaoService(store),close:()=>store.close()}
}
