// 代理站（AI 中转站代理商子站）后台接口 /v1/admin/dealers…：代理商列表 / 改分成比例 / 本人账号 / 分成流水 / 复核 / 批量标记已结算。业务在 core 的 DealerAdmin。
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { dealerCommissionsQuery, dealerListQuery, dealerOwnersSchema, dealerPatchSchema, dealerReviewSchema, dealerSettleSchema, dealerSlugSchema } from '@proxysplit/contracts'
import type { DealerAdmin } from '@proxysplit/core'
import { AppError } from '@proxysplit/shared'

type Principal={userId:string;role:string}
type Deps={admin:(req:FastifyRequest)=>Promise<Principal>;dealers:DealerAdmin}

const slugParam=(req:FastifyRequest)=>{
  const r=dealerSlugSchema.safeParse((req.params as {slug?:string}).slug)
  if(!r.success)throw new AppError('NOT_FOUND','代理商不存在',404)
  return r.data
}

export function registerDealerRoutes(app:FastifyInstance,d:Deps){
  app.get('/v1/admin/dealers',async(req)=>{await d.admin(req);return d.dealers.list(dealerListQuery.parse(req.query))})
  app.patch('/v1/admin/dealers/:slug',async(req)=>{
    const p=await d.admin(req);const slug=slugParam(req);const {commissionBps}=dealerPatchSchema.parse(req.body)
    // 审计行由 DealerAdmin 在同一事务里写
    return d.dealers.setBps(slug,commissionBps,{actor:p.userId,ip:req.ip})
  })
  // 代理商本人的账号：买家与这些账号同设备 / 同注册来源时分成进待复核（审计同事务）
  app.put('/v1/admin/dealers/:slug/owners',async(req)=>{
    const p=await d.admin(req);const slug=slugParam(req)
    return d.dealers.setOwners(slug,dealerOwnersSchema.parse(req.body).usernames,{actor:p.userId,ip:req.ip})
  })
  app.get('/v1/admin/dealers/commissions',async(req)=>{await d.admin(req);return d.dealers.commissions(dealerCommissionsQuery.parse(req.query))})
  app.post('/v1/admin/dealers/commissions/settle',async(req)=>{
    const p=await d.admin(req);const input=dealerSettleSchema.parse(req.body)
    return d.dealers.settle(input.ids,input.note,{actor:p.userId,ip:req.ip})
  })
  // 待复核的分成：复核通过（进待结算）/ 作废；只动 review 的，审计同事务
  app.post('/v1/admin/dealers/commissions/review',async(req)=>{
    const p=await d.admin(req);const input=dealerReviewSchema.parse(req.body)
    return d.dealers.review(input.ids,input.action,input.note,{actor:p.userId,ip:req.ip})
  })
}
