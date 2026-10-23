export * from './auth.js'
export * from './store.js'
export * from './payments.js'
export * from './accel.js'
export * from './fenxiao.js'
export { FenxiaoService, maskName } from './fenxiao-service.js'
import { hashPassword, AuthService, type AuthConfig } from './auth.js'
import { PgStore } from './store.js'
import { FenxiaoService } from './fenxiao-service.js'
export async function createCommercialCore(config:{databaseUrl:string;auth:AuthConfig;bootstrapAdmin?:{username:string;password:string}}){
  const store=new PgStore(config.databaseUrl)
  if(config.bootstrapAdmin?.username&&config.bootstrapAdmin.password){await store.bootstrapAdmin(config.bootstrapAdmin.username.toLowerCase(),await hashPassword(config.bootstrapAdmin.password))}
  const auth=await AuthService.create(store,config.auth)
  return {store,auth,fenxiao:new FenxiaoService(store),close:()=>store.close()}
}
