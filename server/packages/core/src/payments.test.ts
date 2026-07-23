import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PaymentService } from './payments.js'
import type { PgStore } from './store.js'

const provider={code:'zhongzhuan-prod',displayName:'生产收款',adapter:'zhongzhuan',endpoint:'https://pay.invalid',merchantId:'',credentialRef:'PAYMENT_TEST',config:{},enabled:true}
const order={id:'order-id',orderNo:'PS202607230001',userId:'user-id',planId:'plan-id',planName:'超级会员年卡',tier:'premium',billingCycle:'year',durationDays:365,lifetime:false,amountCents:29900,currency:'CNY',status:'pending',providerCode:provider.code,providerOrderNo:null,payUrl:null,paidAt:null,expiresAt:new Date(Date.now()+600000),createdAt:new Date()}
const sign=(data:Record<string,unknown>)=>createHmac('sha256','test-secret').update(Object.keys(data).sort().map(k=>`${k}=${String(data[k])}`).join('&')).digest('hex')

afterEach(()=>vi.unstubAllGlobals())
describe('zhongzhuan payment adapter',()=>{
  it('creates a server-priced signed order and stores the returned pay URL',async()=>{
    process.env.PAYMENT_TEST_APP_ID='app-test'
    process.env.PAYMENT_TEST_APP_SECRET='test-secret'
    let requestBody:Record<string,unknown>={}
    vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{
      requestBody=JSON.parse(String(init.body))
      return new Response(JSON.stringify({code:0,data:{qr_code:'https://cashier.invalid/q/1',out_trade_no:'gateway-1'}}),{status:200,headers:{'content-type':'application/json'}})
    }))
    const store={
      createOrder:async()=>order,getProvider:async()=>provider,
      setOrderPayment:vi.fn(async()=>({orderNo:order.orderNo})),failOrder:vi.fn(),
    }
    const service=new PaymentService(store as unknown as PgStore,'https://proxysplit.invalid')
    const result=await service.createOrder('user-id','plan-id','alice')
    expect(requestBody.amount).toBe(299)
    expect(requestBody.notify_url).toBe('https://proxysplit.invalid/v1/payments/zhongzhuan/notify')
    const {sign:signature,...params}=requestBody
    expect(signature).toBe(sign(params))
    expect(result.payUrl).toBe('https://cashier.invalid/q/1')
    expect(store.setOrderPayment).toHaveBeenCalledWith(order.orderNo,'gateway-1','https://cashier.invalid/q/1')
    expect(store.failOrder).not.toHaveBeenCalled()
  })

  it('keeps an ambiguously failed gateway create pending for later reconciliation',async()=>{
    process.env.PAYMENT_TEST_APP_ID='app-test'
    process.env.PAYMENT_TEST_APP_SECRET='test-secret'
    vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('connection reset')}))
    const store={
      createOrder:async()=>order,getProvider:async()=>provider,
      setOrderPayment:vi.fn(),failOrder:vi.fn(),
    }
    const service=new PaymentService(store as unknown as PgStore,'https://proxysplit.invalid')
    await expect(service.createOrder('user-id','plan-id','alice')).rejects.toMatchObject({code:'PAYMENT_CREATE_FAILED'})
    expect(store.setOrderPayment).not.toHaveBeenCalled()
    expect(store.failOrder).not.toHaveBeenCalled()
  })

  it('verifies callback timestamp/signature/amount before idempotent fulfillment',async()=>{
    process.env.PAYMENT_TEST_APP_ID='app-test'
    process.env.PAYMENT_TEST_APP_SECRET='test-secret'
    const fulfill=vi.fn(async()=>({ok:true,duplicate:false}))
    const store={
      getOrderForCallback:async()=>({...order,providerOrderNo:'gateway-1'}),
      getProvider:async()=>provider,fulfillPaidOrder:fulfill,
    }
    const service=new PaymentService(store as unknown as PgStore,'https://proxysplit.invalid')
    const data:Record<string,unknown>={app_id:'app-test',app_order_no:order.orderNo,out_trade_no:'gateway-1',trade_no:'trade-1',amount:299,status:'PAID',timestamp:Math.floor(Date.now()/1000),sn:'event-1'}
    await service.handleZhongzhuanCallback({...data,sign:sign(data)})
    expect(fulfill).toHaveBeenCalledWith(expect.objectContaining({orderNo:order.orderNo,amountCents:29900,eventId:'event-1'}))
    const stale={...data,timestamp:Math.floor(Date.now()/1000)-600}
    await expect(service.handleZhongzhuanCallback({...stale,sign:sign(stale)})).rejects.toMatchObject({code:'PAYMENT_CALLBACK_EXPIRED'})
  })

  it('sync polls the gateway and idempotently fulfills a pending order',async()=>{
    process.env.PAYMENT_TEST_APP_ID='app-test'
    process.env.PAYMENT_TEST_APP_SECRET='test-secret'
    let queryBody:Record<string,unknown>={}
    vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
      expect(url).toContain('/api/v1/pay/query')
      queryBody=JSON.parse(String(init.body))
      return new Response(JSON.stringify({code:0,data:{status:'PAID',amount:299,out_trade_no:'gateway-1',trade_no:'trade-1',sn:'event-9'}}),{status:200,headers:{'content-type':'application/json'}})
    }))
    const fulfill=vi.fn(async()=>({ok:true,duplicate:false}))
    const store={
      getOrderForCallback:async()=>({orderNo:order.orderNo,providerCode:provider.code,providerOrderNo:'gateway-1',amountCents:29900,status:'pending'}),
      getProvider:async()=>provider,fulfillPaidOrder:fulfill,
    }
    const service=new PaymentService(store as unknown as PgStore,'https://proxysplit.invalid')
    const [result,duplicatePoll]=await Promise.all([service.syncOrder(order.orderNo),service.syncOrder(order.orderNo)])
    expect(result).toMatchObject({status:'paid',changed:true})
    expect(duplicatePoll).toEqual(result)
    expect(fetch).toHaveBeenCalledTimes(1)
    const {sign:signature,...params}=queryBody
    expect(signature).toBe(sign(params))
    expect(fulfill).toHaveBeenCalledWith(expect.objectContaining({orderNo:order.orderNo,amountCents:29900,eventId:'event-9',providerOrderNo:'gateway-1'}))
  })

  it('sync rejects a paid result whose amount does not match the order',async()=>{
    process.env.PAYMENT_TEST_APP_ID='app-test'
    process.env.PAYMENT_TEST_APP_SECRET='test-secret'
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({code:0,data:{status:'PAID',amount:1,out_trade_no:'gateway-1'}}),{status:200,headers:{'content-type':'application/json'}})))
    const fulfill=vi.fn()
    const store={
      getOrderForCallback:async()=>({orderNo:order.orderNo,providerCode:provider.code,providerOrderNo:'gateway-1',amountCents:29900,status:'pending'}),
      getProvider:async()=>provider,fulfillPaidOrder:fulfill,
    }
    const service=new PaymentService(store as unknown as PgStore,'https://proxysplit.invalid')
    await expect(service.syncOrder(order.orderNo)).rejects.toMatchObject({code:'PAYMENT_AMOUNT_MISMATCH'})
    expect(fulfill).not.toHaveBeenCalled()
  })

  it('closes an expired gateway order and stops treating it as payable',async()=>{
    process.env.PAYMENT_TEST_APP_ID='app-test'
    process.env.PAYMENT_TEST_APP_SECRET='test-secret'
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({code:0,data:{status:'EXPIRED',amount:299,out_trade_no:'gateway-1'}}),{status:200,headers:{'content-type':'application/json'}})))
    const failOrder=vi.fn()
    const store={
      getOrderForCallback:async()=>({orderNo:order.orderNo,providerCode:provider.code,providerOrderNo:'gateway-1',amountCents:29900,status:'pending'}),
      getProvider:async()=>provider,failOrder,
    }
    const service=new PaymentService(store as unknown as PgStore,'https://proxysplit.invalid')
    await expect(service.syncOrder(order.orderNo)).resolves.toMatchObject({status:'expired',changed:true})
    expect(failOrder).toHaveBeenCalledWith(order.orderNo)
  })
})
