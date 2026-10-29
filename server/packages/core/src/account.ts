// 账号资料与后台账号操作：公司统一账号包 zhanghao（vendor 在 ./vendor/zhanghao，tag 见其 VERSION），表就是本项目的 users。
// 会话 / 设备 / 刷新仍是 auth.ts 自己的：zhanghao 的刷新令牌重放即判泄露、全号下线，桌面端丢响应重试会被成片踢掉，
// 且不认设备绑定。所以这里只用它的账号面（封禁 / 解封 / 重置密码 / 昵称 / 强制下线 / 幂等操作流水 / 身份桥），
// 每个会让人下线的动作之后同步吊销本项目 sessions 表（zhanghao 自己只吊销它 KV 里的会话）。
import { createHash } from 'node:crypto'
import { verify } from '@node-rs/argon2'
import { AppError } from '@proxysplit/shared'
import type { createDatabase } from '@proxysplit/db'
import { createIdentityBridge, type IdentityBridge } from './vendor/zhanghao/bridge.js'
import { HTTP_STATUS_BY_CODE } from './vendor/zhanghao/http/wire.js'
import { createMemoryKv } from './vendor/zhanghao/kv/memory.js'
import type { KvLike, PasswordHasher } from './vendor/zhanghao/ports.js'
import { createZhanghao } from './vendor/zhanghao/service.js'
import type { Zhanghao, ZhanghaoEvent } from './vendor/zhanghao/service-contract.js'
import { createSqlPgZhanghaoStore } from './vendor/zhanghao/store/sql-pg.js'
import { isZhanghaoError, type AdminActionRecord, type UserRecord as ZhUser } from './vendor/zhanghao/types.js'
import { hashPassword } from './auth.js'

type Pool = ReturnType<typeof createDatabase>['pool']
/** ioredis 用到的那几个方法（core 不直接依赖 ioredis） */
export type AccountRedis = {
  get(key:string):Promise<string|null>
  set(key:string,value:string):Promise<unknown>
  set(key:string,value:string,ex:'EX',ttlSec:number):Promise<unknown>
  set(key:string,value:string,ex:'EX',ttlSec:number,nx:'NX'):Promise<string|null>
  del(key:string):Promise<unknown>
  sadd(key:string,member:string):Promise<unknown>
  srem(key:string,member:string):Promise<unknown>
  smembers(key:string):Promise<string[]>
  expire(key:string,ttlSec:number):Promise<unknown>
}
export type AccountDeps={
  /** 签 zhanghao 自己的令牌用；本项目不用它的会话，仍给一个与 access 密钥分开的派生值 */
  accessSecret:string
  redis?:AccountRedis|undefined
  revokeSessions:(userId:string)=>Promise<void>
  audit:(actor:string|null,action:string,targetId:string,meta:Record<string,unknown>)=>Promise<void>
  warn:(msg:string,detail?:Record<string,unknown>)=>void
}

export const redisKv=(r:AccountRedis):KvLike=>({
  get:k=>r.get(k),
  set:async(k,v,ttl)=>{if(ttl)await r.set(k,v,'EX',ttl);else await r.set(k,v)},
  setNx:async(k,v,ttl)=>(await r.set(k,v,'EX',ttl,'NX'))==='OK',
  del:async k=>{await r.del(k)},
  sadd:async(k,m)=>{await r.sadd(k,m)},
  srem:async(k,m)=>{await r.srem(k,m)},
  smembers:k=>r.smembers(k),
  expire:async(k,t)=>{await r.expire(k,t)},
})

/** 本项目的 argon2id 哈希；POWER云 预建号没有密码（库里 NULL，store 读成 'null'），一律验不过。 */
export const argon2Hasher:PasswordHasher={
  hash:hashPassword,
  verify:async(password,hash)=>hash.startsWith('$argon2')?verify(hash,password).catch(()=>false):false,
  owns:hash=>hash.startsWith('$argon2id$'),
}

/** zhanghao 业务错误 → 本项目 AppError（文案原样给前端） */
export function toAppError(e:unknown):unknown{
  if(!isZhanghaoError(e))return e
  const code=e.code==='USER_NOT_FOUND'?'NOT_FOUND':e.code
  return new AppError(code,e.message,HTTP_STATUS_BY_CODE[e.code]??400)
}
const guard=async<T>(run:()=>Promise<T>)=>{try{return await run()}catch(e){throw toAppError(e)}}

export type AdminCtx={operatorId:string;requestId:string}
export type AccountService={
  zh:Zhanghao
  bridge:IdentityBridge
  ban(userId:string,input:{days:number|null;reason:string},ctx:AdminCtx):Promise<ZhUser>
  unban(userId:string,input:{reason:string},ctx:AdminCtx):Promise<ZhUser>
  setNickname(userId:string,nickname:string|null,ctx:AdminCtx):Promise<ZhUser>
  resetPassword(userId:string,password:string,ctx:AdminCtx):Promise<ZhUser>
  revokeSessions(userId:string,input:{reason:string},ctx:AdminCtx):Promise<ZhUser>
  actions(userId:string,opts:{beforeId?:string;limit?:number}):Promise<AdminActionRecord[]>
}

export function createAccount(pool:Pool,deps:AccountDeps):AccountService{
  const onEvent=(ev:ZhanghaoEvent)=>{
    if(ev.type!=='admin_action')return
    const a=ev.action
    deps.audit(a.operatorId,`admin.user.${a.action}`,a.targetUserId,{requestId:a.requestId,detail:a.detail}).catch(e=>deps.warn('account audit failed',{err:(e as Error).message}))
  }
  const zh=createZhanghao({
    store:createSqlPgZhanghaoStore({query:(text,params)=>pool.query(text,params),tableNames:{users:'users',adminActions:'zh_admin_actions'}}),
    kv:deps.redis?redisKv(deps.redis):createMemoryKv(),
    secret:createHash('sha256').update('proxysplit-zhanghao-v1:'+deps.accessSecret).digest('hex'),
    keyPrefix:'proxysplit',
    hasher:argon2Hasher,
    // 与 auth.ts 的用户名规则一致：老账号里有纯数字用户名
    config:{username:{allowAllDigits:true},fallbackDisplayName:id=>`用户${id.slice(0,6)}`},
    onEvent,
    onWarn:(msg,extra)=>deps.warn(msg,extra),
  })
  // 动作写进库后再吊销本项目会话；回放（同 requestId 第二次）不重复吊销也无害。
  const kick=async(userId:string,run:()=>Promise<{user:ZhUser}>)=>{
    const r=await guard(run)
    await deps.revokeSessions(userId)
    return r.user
  }
  return {
    zh,
    bridge:createIdentityBridge(zh,{fallbackDisplayName:id=>`用户${id.slice(0,6)}`}),
    ban:(id,input,ctx)=>kick(id,()=>zh.admin.ban(id,input,ctx)),
    unban:async(id,input,ctx)=>(await guard(()=>zh.admin.unban(id,input,ctx))).user,
    setNickname:async(id,nickname,ctx)=>(await guard(()=>zh.admin.setNickname(id,nickname,ctx))).user,
    resetPassword:(id,password,ctx)=>kick(id,()=>zh.admin.resetPassword(id,password,ctx)),
    revokeSessions:(id,input,ctx)=>kick(id,()=>zh.admin.revokeSessions(id,input,ctx)),
    actions:(id,opts)=>guard(()=>zh.admin.listActions(id,opts)),
  }
}
