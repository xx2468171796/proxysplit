// 代理站（AI 中转站代理商子站）后台接口 /v1/admin/dealers…：代理商列表 / 改分成比例 / 分成流水 / 批量标记已结算。业务在 core 的 DealerAdmin。
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { dealerCommissionsQuery, dealerListQuery, dealerPatchSchema, dealerSettleSchema, dealerSlugSchema } from '@proxysplit/contracts'
import type { DealerAdmin, PgStore } from '@proxysplit/core'
import { AppError } from '@proxysplit/shared'

type Principal={userId:string;role:string}
type Deps={admin:(req:FastifyRequest)=>Promise<Principal>;dealers:DealerAdmin;store:Pick<PgStore,'audit'>}

const slugParam=(req:FastifyRequest)=>{
  const r=dealerSlugSchema.safeParse((req.params as {slug?:string}).slug)
  if(!r.success)throw new AppError('NOT_FOUND','代理商不存在',404)
  return r.data
}

export function registerDealerRoutes(app:FastifyInstance,d:Deps){
  app.get('/v1/admin/dealers',async(req)=>{await d.admin(req);return d.dealers.list(dealerListQuery.parse(req.query))})
  app.patch('/v1/admin/dealers/:slug',async(req)=>{
    const p=await d.admin(req);const slug=slugParam(req);const {commissionBps}=dealerPatchSchema.parse(req.body)
    const row=await d.dealers.setBps(slug,commissionBps)
    await d.store.audit(p.userId,'admin.dealer.bps','dealer',slug,req.ip,'success',{commissionBps})
    return row
  })
  app.get('/v1/admin/dealers/commissions',async(req)=>{await d.admin(req);return d.dealers.commissions(dealerCommissionsQuery.parse(req.query))})
  app.post('/v1/admin/dealers/commissions/settle',async(req)=>{
    const p=await d.admin(req);const input=dealerSettleSchema.parse(req.body)
    const r=await d.dealers.settle(input.ids,input.note)
    await d.store.audit(p.userId,'admin.dealer.settle','dealer-commission',r.ids.join(',').slice(0,200),req.ip,'success',{settled:r.settled,ids:r.ids,commissionCents:r.commissionCents,dealers:r.dealers,note:input.note})
    return r
  })
}
