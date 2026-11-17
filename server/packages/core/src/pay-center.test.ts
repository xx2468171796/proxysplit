// 统一支付中心适配器：用 SDK 自带的 createMockCenter（内存版 zhifu-service，签名回调与真服务一致）。
import { describe, expect, it, vi } from 'vitest'
import { PaymentService } from './payments.js'
import { createCenterPay, createCenterPayFromEnv } from './pay-center.js'
import type { Queryable } from './pay-center-book.js'
import type { PgStore } from './store.js'
import { createMockCenter } from './vendor/zhifu/center/mock.js'

const provider={code:'zhifu-center',displayName:'统一支付中心',adapter:'center',endpoint:'https://zfzx.invalid',merchantId:'',credentialRef:'PAY_CENTER',config:{},enabled:true}
const order={id:'order-id',orderNo:'PS20261117000001AB',userId:'user-1',planId:'plan-id',planName:'超级会员年卡',tier:'premium',billingCycle:'year',durationDays:365,lifetime:false,
  amountCents:29900,currency:'CNY',status:'pending',providerCode:provider.code,providerOrderNo:null,payUrl:null,paidAt:null,expiresAt:new Date(Date.now()+600000),createdAt:new Date(),
  groupId:null,splitIndex:null,splitTotal:null}

/** 只认 pay-center-book.ts 用到的几条 SQL 的内存库。 */
function memoryDb(){
  const orders=new Map<string,Record<string,unknown>>(),notifies=new Set<string>()
  const db:Queryable={async query(sql,v=[]){
    const s=sql.replace(/\s+/g,' ').trim()
    if(s.startsWith('INSERT INTO pay_center_orders')){
      if(orders.has(String(v[0])))throw new Error('duplicate key')
      orders.set(String(v[0]),{site_order_no:v[0],order_no:v[1],user_id:v[2],amount_cents:v[3],meta:JSON.parse(String(v[4])),discarded:null,created_at:Date.now()})
      return {rows:[],rowCount:1}
    }
    if(s.startsWith('SELECT site_order_no,user_id,amount_cents,meta FROM pay_center_orders WHERE site_order_no')){const r=orders.get(String(v[0]));return {rows:r?[r]:[]}}
    if(s.startsWith('SELECT site_order_no,user_id,amount_cents,meta FROM pay_center_orders WHERE order_no')){
      const r=[...orders.values()].filter(x=>x.order_no===v[0]&&x.discarded===null).reverse();return {rows:r.slice(0,1)}
    }
    if(s.startsWith('UPDATE pay_center_orders SET discarded')){const r=orders.get(String(v[0]));if(r&&r.discarded===null)r.discarded=v[1];return {rows:[]}}
    if(s.startsWith('INSERT INTO pay_center_notifies')){const fresh=!notifies.has(String(v[0]));notifies.add(String(v[0]));return {rows:fresh?[{}]:[],rowCount:fresh?1:0}}
    if(s.startsWith('SELECT 1 FROM pay_center_notifies')){const n=notifies.has(String(v[0]))?1:0;return {rows:n?[{}]:[],rowCount:n}}
    if(s.startsWith('DELETE FROM pay_center_notifies')){notifies.delete(String(v[0]));return {rows:[]}}
    throw new Error(`unexpected SQL: ${s}`)
  }}
  return {db,orders,notifies}
}

function setup(){
  const mock=createMockCenter({appId:'site-test',secret:'test-secret'})
  const {db,orders}=memoryDb()
  const store={
    createOrders:vi.fn(async()=>[order]),getProvider:async()=>provider,failOrder:vi.fn(async()=>undefined),
    setOrderPayment:vi.fn(async()=>({orderNo:order.orderNo})),getOrderForUser:async()=>({...order}),
    getOrderForCallback:async()=>({orderNo:order.orderNo,providerCode:provider.code,providerOrderNo:null,amountCents:order.amountCents,status:'pending'}),
    fulfillPaidOrder:vi.fn(async()=>({ok:true,duplicate:false})),
  }
  const paid:string[]=[]
  const service=new PaymentService(store as unknown as PgStore,'https://site.invalid',()=>undefined,async no=>{paid.push(no)},
    fulfil=>createCenterPay({appId:'site-test',secret:'test-secret',client:mock.client,db,onPaid:fulfil,log:()=>undefined}))
  return {mock,orders,store,service,paid}
}

describe('统一支付中心适配器',()=>{
  it('一笔本地订单建一笔中心单，二维码与中心单号写回本地订单',async()=>{
    const {store,service,orders}=setup()
    const r=await service.createOrder('user-1','plan-id','alice',{clientIp:'1.2.3.4',userAgent:'Go-http-client/1.1'})
    expect(r.split).toBe(false)
    expect(r.orders).toHaveLength(1)
    const [book]=[...orders.values()]
    expect(book?.order_no).toBe(order.orderNo)
    expect(String(book?.site_order_no)).toMatch(/^PR[0-9A-F]{24}$/)
    expect(r.order?.providerOrderNo).toBe(book?.site_order_no)
    expect(r.order?.payUrl).toBeTruthy()
    expect(store.setOrderPayment).toHaveBeenCalledWith(order.orderNo,book?.site_order_no,r.order?.payUrl,expect.objectContaining({merchantName:null}))
    expect(store.failOrder).not.toHaveBeenCalled()
  })

  it('签名回调落到 fulfillPaidOrder 一次；同一回调重放不再发放',async()=>{
    const {mock,store,service,orders,paid}=setup()
    await service.createOrder('user-1','plan-id','alice')
    const siteOrderNo=String([...orders.values()][0]?.site_order_no)
    const raw=mock.pay((await mock.client.query({siteOrderNo})).order_no)
    const first=await service.handleCenterNotify(raw)
    expect(first.status).toBe(200)
    expect(JSON.parse(first.body)).toEqual({code:0})
    expect(store.fulfillPaidOrder).toHaveBeenCalledTimes(1)
    expect(store.fulfillPaidOrder).toHaveBeenCalledWith(expect.objectContaining({
      providerCode:'zhifu-center',eventId:`center:${siteOrderNo}`,orderNo:order.orderNo,amountCents:29900,providerOrderNo:siteOrderNo,
    }))
    expect(paid).toEqual([order.orderNo])
    const replay=await service.handleCenterNotify(raw)
    expect(replay.status).toBe(200)
    expect(store.fulfillPaidOrder).toHaveBeenCalledTimes(1)
  })

  it('回调用户与订单簿不符：不发放、不回 2xx（中心会重试并报警）',async()=>{
    const {mock,store,service,orders}=setup()
    await service.createOrder('user-1','plan-id','alice')
    const row=[...orders.values()][0]!
    row.user_id='someone-else'
    const reply=await service.handleCenterNotify(mock.pay((await mock.client.query({siteOrderNo:String(row.site_order_no)})).order_no))
    expect(reply.status).toBeGreaterThanOrEqual(400)
    expect(store.fulfillPaidOrder).not.toHaveBeenCalled()
  })

  it('篡改过的回调验签失败',async()=>{
    const {mock,store,service,orders}=setup()
    await service.createOrder('user-1','plan-id','alice')
    const raw=mock.pay((await mock.client.query({siteOrderNo:String([...orders.values()][0]?.site_order_no)})).order_no).replace('29900','1')
    const reply=await service.handleCenterNotify(raw)
    expect(reply.status).toBeGreaterThanOrEqual(400)
    expect(store.fulfillPaidOrder).not.toHaveBeenCalled()
  })

  it('中心拒单：中文原因原样给客户端，本地订单标失败',async()=>{
    const {mock,store,service}=setup()
    mock.failNext('COOLDOWN','下单太频繁，请 30 秒后再试',{retry_after_sec:30})
    await expect(service.createOrder('user-1','plan-id','alice')).rejects.toMatchObject({code:'PAY_COOLDOWN',status:429,message:'下单太频繁，请 30 秒后再试'})
    expect(store.failOrder).toHaveBeenCalledWith(order.orderNo)
    mock.failNext('COLLECTION_OFF','充值通道维护中，请联系客服充值')
    await expect(service.createOrder('user-1','plan-id','alice')).rejects.toMatchObject({code:'PAY_COLLECTION_OFF',status:503})
  })

  it('查单只做展示：中心已取消 → 本地标失败；不从查单入账',async()=>{
    const {mock,store,service,orders}=setup()
    await service.createOrder('user-1','plan-id','alice')
    const siteOrderNo=String([...orders.values()][0]?.site_order_no)
    await mock.client.cancel({siteOrderNo})
    const r=await service.syncOrder(order.orderNo)
    expect(r).toMatchObject({status:'cancelled',changed:true})
    expect(store.failOrder).toHaveBeenCalledWith(order.orderNo)
    expect(store.fulfillPaidOrder).not.toHaveBeenCalled()
  })

  it('env 不全不接中心；center 通道下单报未配置',async()=>{
    const {db}=memoryDb()
    expect(createCenterPayFromEnv({PAY_MODE:'center',PAY_CENTER_URL:'https://zfzx.invalid'},db,async()=>undefined)).toBeNull()
    expect(createCenterPayFromEnv({PAY_CENTER_URL:'https://x',PAY_CENTER_APP_ID:'a',PAY_CENTER_SECRET:'s'},db,async()=>undefined)).toBeNull()
    const store={createOrders:async()=>[order],getProvider:async()=>provider,failOrder:vi.fn(async()=>undefined)}
    const service=new PaymentService(store as unknown as PgStore,'https://site.invalid',()=>undefined,undefined,()=>null)
    await expect(service.createOrder('user-1','plan-id','alice')).rejects.toMatchObject({code:'PAYMENT_UNAVAILABLE'})
    expect(store.failOrder).toHaveBeenCalledWith(order.orderNo)
  })
})
