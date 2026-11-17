// 统一支付中心适配器：用 SDK 自带的 createMockCenter（内存版 zhifu-service，签名回调与真服务一致）。
import { describe, expect, it, vi } from 'vitest'
import { PaymentService } from './payments.js'
import { createCenterPay, createCenterPayFromEnv, type HvRedeem } from './pay-center.js'
import type { Queryable } from './pay-center-book.js'
import type { PgStore } from './store.js'
import type { AdoptResult } from './order-reuse.js'
import { createMockCenter } from './vendor/zhifu/center/mock.js'
import { sign } from './vendor/zhifu/center/sign.js'

const provider={code:'zhifu-center',displayName:'统一支付中心',adapter:'center',endpoint:'https://zfzx.invalid',merchantId:'',credentialRef:'PAY_CENTER',config:{},enabled:true}
const order={id:'order-id',orderNo:'PS20261117000001AB',userId:'user-1',planId:'plan-id',planName:'超级会员年卡',tier:'premium',billingCycle:'year',durationDays:365,lifetime:false,
  amountCents:29900,currency:'CNY',status:'pending',providerCode:provider.code,providerOrderNo:null,payUrl:null,paidAt:null,expiresAt:new Date(Date.now()+600000),createdAt:new Date(),
  groupId:null,splitIndex:null,splitTotal:null}

const second='PS20261117000002CD'
const noHooks={onPaid:async()=>undefined,onRefunded:async()=>undefined}

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
    if(s.startsWith('UPDATE pay_center_orders SET discarded=NULL')){for(const r of orders.values())if(r.order_no===v[0]&&r.discarded==='reused')r.discarded=null;return {rows:[]}}
    if(s.startsWith('UPDATE pay_center_orders SET discarded')){const r=orders.get(String(v[0]));if(r&&r.discarded===null)r.discarded=v[1];return {rows:[]}}
    if(s.startsWith('INSERT INTO pay_center_notifies')){const fresh=!notifies.has(String(v[0]));notifies.add(String(v[0]));return {rows:fresh?[{}]:[],rowCount:fresh?1:0}}
    if(s.startsWith('SELECT 1 FROM pay_center_notifies')){const n=notifies.has(String(v[0]))?1:0;return {rows:n?[{}]:[],rowCount:n}}
    throw new Error(`unexpected SQL: ${s}`)
  }}
  return {db,orders,notifies}
}

function setup(hvRedeem?:HvRedeem){
  const mock=createMockCenter({appId:'site-test',secret:'test-secret'})
  const sent:Array<{challengePassed?:boolean}>=[]
  const tryCreate=mock.client.tryCreateOrder
  mock.client.tryCreateOrder=async input=>{sent.push(input as {challengePassed?:boolean});return tryCreate(input)}
  const {db,orders,notifies}=memoryDb()
  const logs:string[]=[]
  const store={
    createOrders:vi.fn(async()=>[order]),getProvider:async()=>provider,failOrder:vi.fn(async()=>undefined),
    setOrderPayment:vi.fn(async()=>({orderNo:order.orderNo})),getOrderForUser:async()=>({...order}),
    getOrderForCallback:async()=>({orderNo:order.orderNo,providerCode:provider.code,providerOrderNo:null,amountCents:order.amountCents,status:'pending'}),
    fulfillPaidOrder:vi.fn(async()=>({ok:true,duplicate:false})),
    isOrderReusableAs:vi.fn(async()=>true),adoptReusedOrder:vi.fn(async():Promise<AdoptResult>=>({ok:true})),
    refundOrder:vi.fn(async()=>({ok:true,orders:1,licenseAdjusted:true,removedDays:365})),audit:vi.fn(async()=>undefined),
  }
  const paid:string[]=[]
  const service=new PaymentService(store as unknown as PgStore,'https://site.invalid',m=>{logs.push(m)},async no=>{paid.push(no)},
    hooks=>createCenterPay({appId:'site-test',secret:'test-secret',client:mock.client,db,...hooks,log:m=>{logs.push(m)},...(hvRedeem?{hvRedeem}:{})}))
  return {mock,orders,notifies,logs,store,service,paid,sent}
}
/** 中心的 order.refunded 回调体：拿已付回调改事件与退款额后重新签名（mock 中心没有现成的）。 */
function refundBody(paidRaw:string,refundedCents:number,refundNo='RF1'){
  const {sign:_s,...body}=JSON.parse(paidRaw) as Record<string,string|number>
  const next={...body,event:'order.refunded',notify_id:`N-${refundNo}`,refunded_cents:refundedCents,refund_no:refundNo,refund_amount_cents:refundedCents}
  return JSON.stringify({...next,sign:sign(next,'test-secret')})
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

  it('发放中途失败 / 进程退出：回调没被记成「已处理」，中心重试时照样发放（至少一次）',async()=>{
    const {mock,store,service,orders,notifies}=setup()
    await service.createOrder('user-1','plan-id','alice')
    const raw=mock.pay((await mock.client.query({siteOrderNo:String([...orders.values()][0]?.site_order_no)})).order_no)
    store.fulfillPaidOrder.mockImplementationOnce(async()=>{
      // 发放开始时库里不能已经有这条回调的记录：进程此刻退出，重试就会被当成重复而不发放。
      expect(notifies.size).toBe(0)
      throw new Error('process died')
    })
    const first=await service.handleCenterNotify(raw)
    expect(first.status).toBeGreaterThanOrEqual(500)
    expect(notifies.size).toBe(0)
    const retry=await service.handleCenterNotify(raw)
    expect(retry.status).toBe(200)
    expect(store.fulfillPaidOrder).toHaveBeenCalledTimes(2)
    expect(notifies.size).toBe(1)
  })

  it('查单对账：中心已付而本地还是待支付 / 失败 → 走同一个 fulfillPaidOrder 补发并记 warn',async()=>{
    for(const local of ['pending','failed']){
      const {mock,store,service,orders,logs,paid}=setup()
      await service.createOrder('user-1','plan-id','alice')
      const siteOrderNo=String([...orders.values()][0]?.site_order_no)
      mock.pay((await mock.client.query({siteOrderNo})).order_no) // 中心收到钱了，回调没送到
      store.getOrderForCallback=async()=>({orderNo:order.orderNo,providerCode:provider.code,providerOrderNo:null,amountCents:order.amountCents,status:local})
      const r=await service.syncOrder(order.orderNo)
      expect(r).toMatchObject({status:'paid',changed:true})
      expect(store.fulfillPaidOrder).toHaveBeenCalledWith(expect.objectContaining({
        providerCode:'zhifu-center',eventId:`center:${siteOrderNo}`,orderNo:order.orderNo,amountCents:29900,providerOrderNo:siteOrderNo,
      }))
      expect(paid).toEqual([order.orderNo])
      expect(logs.some(m=>m.includes(order.orderNo)&&m.includes('补发'))).toBe(true)
    }
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

  it('付款前人机验证：凭证兑换通过才声明 challengePassed；不带凭证 / 未配 PAY_HV_HOST 不声明',async()=>{
    const redeem=vi.fn<HvRedeem>(async token=>(token==='good'?'ok':'bad'))
    const ok=setup(redeem)
    await ok.service.createOrder('user-1','plan-id','alice',{hvToken:'good'})
    expect(redeem).toHaveBeenCalledWith('good')
    expect(ok.sent[0]?.challengePassed).toBe(true)
    const bad=setup(redeem)
    await bad.service.createOrder('user-1','plan-id','alice',{hvToken:'forged'})
    expect(bad.sent[0]?.challengePassed).toBeUndefined()
    const none=setup(redeem)
    redeem.mockClear()
    await none.service.createOrder('user-1','plan-id','alice')
    expect(redeem).not.toHaveBeenCalled()
    expect(none.sent[0]?.challengePassed).toBeUndefined()
    const unset=setup()
    await unset.service.createOrder('user-1','plan-id','alice',{hvToken:'good'})
    expect(unset.sent[0]?.challengePassed).toBeUndefined()
  })

  it('验证服务不可达按通过（SDK 同语义），但要留日志并计数（不是悄悄放行）',async()=>{
    const {service,sent,logs}=setup(async()=>'unavailable')
    await service.createOrder('user-1','plan-id','alice',{hvToken:'any'})
    expect(sent[0]?.challengePassed).toBe(true)
    expect(logs.filter(m=>m.includes('人机验证服务不可达'))).toHaveLength(1)
    expect(service.centerStats()).toEqual({hvUnavailable:1})
  })

  describe('中心退款回调 order.refunded',()=>{
    const paidThenRefund=async(local:string,refundedCents=29900)=>{
      const s=setup()
      await s.service.createOrder('user-1','plan-id','alice')
      const paidRaw=s.mock.pay((await s.mock.client.query({siteOrderNo:String([...s.orders.values()][0]?.site_order_no)})).order_no)
      s.store.getOrderForCallback=async()=>({orderNo:order.orderNo,providerCode:provider.code,providerOrderNo:null,amountCents:order.amountCents,status:local})
      return {...s,raw:refundBody(paidRaw,refundedCents)}
    }
    it('全额退款：走本地退款（收回会员时间、冲回佣金），原因「支付中心退款」，带审计',async()=>{
      const {service,store,raw}=await paidThenRefund('paid')
      const reply=await service.handleCenterNotify(raw)
      expect(reply.status).toBe(200)
      expect(store.refundOrder).toHaveBeenCalledTimes(1)
      expect(store.refundOrder).toHaveBeenCalledWith(order.orderNo,'支付中心退款')
      expect(store.audit).toHaveBeenCalledWith(null,'payment.center.refund','order',order.orderNo,'','success',expect.objectContaining({refundNo:'RF1',refundedCents:29900}))
      expect(store.fulfillPaidOrder).not.toHaveBeenCalled()
    })
    it('本地已是已退款：直接确认，不重复退',async()=>{
      const {service,store,raw}=await paidThenRefund('refunded')
      expect((await service.handleCenterNotify(raw)).status).toBe(200)
      expect(store.refundOrder).not.toHaveBeenCalled()
    })
    it('本地还没发放（退款回调先到）：不确认，等付款落地后中心重试',async()=>{
      const {service,store,raw}=await paidThenRefund('pending')
      expect((await service.handleCenterNotify(raw)).status).toBeGreaterThanOrEqual(500)
      expect(store.refundOrder).not.toHaveBeenCalled()
    })
    it('部分退款：不自动收回整笔会员，记 warn + 审计后确认（人工处理）',async()=>{
      const {service,store,raw,logs}=await paidThenRefund('paid',1000)
      expect((await service.handleCenterNotify(raw)).status).toBe(200)
      expect(store.refundOrder).not.toHaveBeenCalled()
      expect(store.audit).toHaveBeenCalledWith(null,'payment.center.refund','order',order.orderNo,'','partial',expect.objectContaining({refundedCents:1000}))
      expect(logs.some(m=>m.includes('部分退款'))).toBe(true)
    })
  })

  it('本站旧未付单自动「取消后重下」：凭证只兑一次，两次下单都带通过',async()=>{
    const redeem=vi.fn<HvRedeem>(async()=>'ok')
    const {mock,service,sent}=setup(redeem)
    mock.failNext('OPEN_ORDER_EXISTS','你有一笔未支付的订单',{order_no:'M0',site_order_no:'PR0',amount_cents:100,same_site:true,site_name:null,
      expires_at:new Date(Date.now()+60000).toISOString()})
    const r=await service.createOrder('user-1','plan-id','alice',{hvToken:'good'})
    expect(r.order?.payUrl).toBeTruthy()
    expect(redeem).toHaveBeenCalledTimes(1)
    expect(sent).toHaveLength(2)
    expect(sent.every(s=>s.challengePassed===true)).toBe(true)
  })

  it('中心还回同金额旧未付单：同人同套餐同金额 → 接管旧本地单（事务里作废新单），不另开中心单',async()=>{
    const {store,service,orders}=setup()
    const first=await service.createOrder('user-1','plan-id','alice')
    store.createOrders.mockResolvedValueOnce([{...order,orderNo:second}])
    const r=await service.createOrder('user-1','plan-id','alice')
    expect(store.isOrderReusableAs).toHaveBeenCalledWith(order.orderNo,second)
    expect(store.adoptReusedOrder).toHaveBeenCalledWith(second,order.orderNo,expect.objectContaining({providerOrderNo:first.order?.providerOrderNo,payUrl:first.order?.payUrl}))
    expect(r.order?.orderNo).toBe(order.orderNo)
    expect([...orders.values()].filter(o=>o.discarded===null)).toHaveLength(1)
  })

  it('还回的旧单是另一个套餐（同价）：不接管，取消旧中心单后给这次的订单开新码',async()=>{
    const {mock,store,service,orders}=setup()
    const first=await service.createOrder('user-1','plan-id','alice')
    store.createOrders.mockResolvedValueOnce([{...order,orderNo:second,planId:'other-plan'}])
    store.isOrderReusableAs.mockResolvedValueOnce(false)
    const r=await service.createOrder('user-1','other-plan','alice')
    expect(store.adoptReusedOrder).not.toHaveBeenCalled()
    expect(r.order?.orderNo).toBe(second)
    expect(r.order?.providerOrderNo).not.toBe(first.order?.providerOrderNo)
    expect(store.setOrderPayment).toHaveBeenLastCalledWith(second,r.order?.providerOrderNo,r.order?.payUrl,expect.anything())
    expect((await mock.client.query({siteOrderNo:String(first.order?.providerOrderNo)})).status).toBe('cancelled')
    // 新单的订单簿记录没被留在「reused 作废」状态：查单 / 对账还找得到它
    expect([...orders.values()].find(o=>o.order_no===second)?.discarded).toBeNull()
  })

  it('接管时重新过在售 / 限购：超过限购 → PURCHASE_LIMIT，新单作废',async()=>{
    const {store,service}=setup()
    await service.createOrder('user-1','plan-id','alice')
    store.createOrders.mockResolvedValueOnce([{...order,orderNo:second}])
    store.adoptReusedOrder.mockResolvedValueOnce({ok:false,reason:'limit'})
    await expect(service.createOrder('user-1','plan-id','alice')).rejects.toMatchObject({code:'PURCHASE_LIMIT',status:409})
    expect(store.failOrder).toHaveBeenCalledWith(second)
    expect(store.setOrderPayment).toHaveBeenCalledTimes(1)
  })

  it('中心要求验证：返回 PAY_CHALLENGE_REQUIRED 给客户端重新验证',async()=>{
    const {mock,service}=setup()
    mock.failNext('CHALLENGE_REQUIRED','')
    await expect(service.createOrder('user-1','plan-id','alice')).rejects.toMatchObject({code:'PAY_CHALLENGE_REQUIRED',status:403})
  })

  it('env 不全不接中心；center 通道下单报未配置',async()=>{
    const {db}=memoryDb()
    expect(createCenterPayFromEnv({PAY_MODE:'center',PAY_CENTER_URL:'https://zfzx.invalid'},db,noHooks)).toBeNull()
    expect(createCenterPayFromEnv({PAY_CENTER_URL:'https://x',PAY_CENTER_APP_ID:'a',PAY_CENTER_SECRET:'s'},db,noHooks)).toBeNull()
    const store={createOrders:async()=>[order],getProvider:async()=>provider,failOrder:vi.fn(async()=>undefined)}
    const service=new PaymentService(store as unknown as PgStore,'https://site.invalid',()=>undefined,undefined,()=>null)
    await expect(service.createOrder('user-1','plan-id','alice')).rejects.toMatchObject({code:'PAYMENT_UNAVAILABLE'})
    expect(store.failOrder).toHaveBeenCalledWith(order.orderNo)
  })
})
