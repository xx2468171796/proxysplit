// 多级分销接口：推广人自己 /v1/fenxiao/*，后台 /v1/admin/fenxiao/*。业务在 core 的 FenxiaoService。
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { AppError } from '@proxysplit/shared'
import { idParam } from './params.js'
import { fenxiaoAdjustSchema, fenxiaoCommissionReviewSchema, fenxiaoCommissionsQuery, fenxiaoGrantSchema, fenxiaoMemberPatchSchema, fenxiaoMembersQuery, fenxiaoMoveSchema, fenxiaoPolicySchema, fenxiaoReviewSchema, fenxiaoTeamQuery, fenxiaoWithdrawalsQuery, fenxiaoWithdrawSchema } from '@proxysplit/contracts'
import type { FenxiaoService, PgStore } from '@proxysplit/core'

type Principal={userId:string;role:string}
type Deps={
  service:FenxiaoService; store:PgStore; publicBaseUrl:string
  auth:(req:FastifyRequest)=>Promise<Principal>; admin:(req:FastifyRequest)=>Promise<Principal>
}
const userId=(req:FastifyRequest)=>idParam(req,'用户不存在')

export function registerFenxiaoRoutes(app:FastifyInstance,d:Deps){
  const {service:s,store}=d
  const site=d.publicBaseUrl.replace(/\/+$/,'')
  // ---- 推广人 ----
  app.get('/v1/fenxiao/me',async(req)=>{
    const p=await d.auth(req);const me=await s.me(p.userId)
    return {...me,link:me.code?`${site}/?ref=${me.code}`:null}
  })
  app.get('/v1/fenxiao/team',async(req)=>{const p=await d.auth(req);return s.myTeam(p.userId,fenxiaoTeamQuery.parse(req.query))})
  app.get('/v1/fenxiao/commissions',async(req)=>{const p=await d.auth(req);return s.myCommissions(p.userId,fenxiaoTeamQuery.parse(req.query))})
  app.get('/v1/fenxiao/withdrawals',async(req)=>{const p=await d.auth(req);return s.myWithdrawals(p.userId,fenxiaoTeamQuery.parse(req.query))})
  app.post('/v1/fenxiao/withdrawals',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(req)=>{
    // 审计行由 FenxiaoService 在记账的同一事务里写（下面的调账 / 佣金复核 / 提现审核同理）
    const p=await d.auth(req);return s.withdraw(p.userId,fenxiaoWithdrawSchema.parse(req.body),req.ip)
  })
  // ---- 后台 ----
  app.get('/v1/admin/fenxiao/policy',async(req)=>{await d.admin(req);return s.getPolicy()})
  app.put('/v1/admin/fenxiao/policy',async(req)=>{
    const p=await d.admin(req);const row=await s.savePolicy(fenxiaoPolicySchema.parse(req.body),p.userId)
    await store.audit(p.userId,'admin.fenxiao.policy','settings','fenxiao_policy',req.ip,'success',{enabled:row.enabled,mode:row.mode,maxLevels:row.maxLevels})
    return row
  })
  app.get('/v1/admin/fenxiao/overview',async(req)=>{
    await d.admin(req);const days=Math.min(365,Math.max(1,Number((req.query as {days?:string}).days)||30))
    return s.overview(days)
  })
  app.get('/v1/admin/fenxiao/members',async(req)=>{await d.admin(req);return s.listMembers(fenxiaoMembersQuery.parse(req.query))})
  app.post('/v1/admin/fenxiao/members',async(req)=>{
    const p=await d.admin(req);const {username,...patch}=fenxiaoGrantSchema.parse(req.body);const row=await s.grant(username,patch,p.userId)
    await store.audit(p.userId,'admin.fenxiao.member','user',row.userId,req.ip,'success',{tierCode:row.tierCode,enabled:row.enabled})
    return row
  })
  app.patch('/v1/admin/fenxiao/members/:id',async(req)=>{
    const p=await d.admin(req);const id=userId(req);const row=await s.patchMember(id,fenxiaoMemberPatchSchema.parse(req.body),p.userId)
    await store.audit(p.userId,'admin.fenxiao.member','user',id,req.ip,'success',{tierCode:row.tierCode,enabled:row.enabled})
    return row
  })
  app.post('/v1/admin/fenxiao/members/:id/move',async(req)=>{
    const p=await d.admin(req);const id=userId(req);const input=fenxiaoMoveSchema.parse(req.body);const row=await s.move(id,input.parentUsername,p.userId)
    await store.audit(p.userId,'admin.fenxiao.move','user',id,req.ip,'success',{parent:input.parentUsername})
    return row
  })
  app.get('/v1/admin/fenxiao/commissions',async(req)=>{await d.admin(req);return s.listCommissions(fenxiaoCommissionsQuery.parse(req.query))})
  app.post('/v1/admin/fenxiao/commissions/:cid/review',async(req)=>{
    const p=await d.admin(req);const cid=(req.params as {cid:string}).cid;const input=fenxiaoCommissionReviewSchema.parse(req.body)
    return s.reviewCommission(cid,input.action,{actor:p.userId,ip:req.ip},input.note)
  })
  app.post('/v1/admin/fenxiao/adjustments',async(req)=>{
    const p=await d.admin(req);const input=fenxiaoAdjustSchema.parse(req.body)
    return s.adjust(input.username,input.amountCents,input.reason,{actor:p.userId,ip:req.ip})
  })
  app.get('/v1/admin/fenxiao/withdrawals',async(req)=>{await d.admin(req);return s.listWithdrawals(fenxiaoWithdrawalsQuery.parse(req.query))})
  app.post('/v1/admin/fenxiao/withdrawals/:wid/review',async(req)=>{
    const p=await d.admin(req);const wid=(req.params as {wid:string}).wid;const input=fenxiaoReviewSchema.parse(req.body)
    return s.review(wid,input.action,{actor:p.userId,ip:req.ip},input.note)
  })
}
