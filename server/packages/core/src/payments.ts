import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { AppError } from '@proxysplit/shared'
import type { PgStore, PaymentProviderRecord } from './store.js'

type Scalar=string|number
type ZhongzhuanCallback={
  app_id?:string;out_trade_no?:string;app_order_no?:string;amount?:number|string;
  status?:string;timestamp?:number|string;sign?:string;sn?:string;trade_no?:string;
  payway?:string;payer_info?:string;paid_at?:string
}
type SyncOrderResult={ok:boolean;status:string;changed:boolean;duplicate?:boolean}

const signedParams=(params:Record<string,unknown>)=>Object.keys(params).sort()
  .map(key=>`${key}=${String(params[key] as Scalar)}`).join('&')
const sign=(params:Record<string,unknown>,secret:string)=>createHmac('sha256',secret).update(signedParams(params)).digest('hex')
const safeHexEqual=(a:string,b:string)=>{
  if(!/^[a-f0-9]+$/i.test(a)||!/^[a-f0-9]+$/i.test(b))return false
  const left=Buffer.from(a,'hex'),right=Buffer.from(b,'hex')
  return left.length===right.length&&timingSafeEqual(left,right)
}
const credential=(provider:PaymentProviderRecord,name:'APP_ID'|'APP_SECRET')=>{
  const value=process.env[`${provider.credentialRef}_${name}`]
  if(!value)throw new AppError('PAYMENT_UNAVAILABLE','支付通道凭据尚未配置',503)
  return value
}

export class PaymentService{
  private syncCache=new Map<string,{at:number;promise:Promise<SyncOrderResult>}>()
  constructor(private store:PgStore,private publicBaseUrl:string,private log:(message:string)=>void=message=>console.warn(message)){}

  // A checkout is one or more orders. Plans above the split cap create a group
  // of sub-orders, each with its own gateway QR, paid separately.
  async createOrder(userId:string,planId:string,username:string){
    let orders
    try{orders=await this.store.createOrders(userId,planId)}
    catch(error){if((error as Error).message==='AMOUNT_TOO_LARGE')throw new AppError('AMOUNT_TOO_LARGE','订单金额过大，请联系客服',400);throw error}
    const provider=await this.store.getProvider(orders[0]!.providerCode)
    if(!provider||!provider.enabled)throw new AppError('PAYMENT_UNAVAILABLE','支付通道暂不可用',503)
    if(provider.adapter!=='zhongzhuan'){
      for(const o of orders)await this.store.failOrder(o.orderNo)
      throw new AppError('PAYMENT_UNSUPPORTED','支付通道适配器不可用',503)
    }
    const paid=[]
    for(const order of orders){
      // A resumed split piece that is still valid already has its gateway QR.
      if(order.payUrl&&order.providerOrderNo){paid.push(order);continue}
      const withUrl=await this.createGatewayOrder(provider,order,username)
      paid.push(withUrl)
    }
    const split=orders.length>1
    return {split,groupNo:orders[0]!.groupId??null,orders:paid,order:paid[0]}
  }

  private async createGatewayOrder(provider:PaymentProviderRecord,order:{orderNo:string;amountCents:number;planName:string;groupId:string|null;splitIndex:number|null;splitTotal:number|null;providerOrderNo:string|null;payUrl:string|null;status:string},username:string){
    const appId=credential(provider,'APP_ID'),secret=credential(provider,'APP_SECRET')
    const timestamp=Math.floor(Date.now()/1000)
    const subject=order.splitTotal&&order.splitTotal>1?`ProxySplit ${order.planName}（${order.splitIndex}/${order.splitTotal}）`:`ProxySplit ${order.planName}`
    const params:Record<string,Scalar>={
      app_id:appId,timestamp,app_order_no:order.orderNo,amount:order.amountCents/100,
      subject,order_type:'recharge',
      notify_url:`${this.publicBaseUrl}/v1/payments/zhongzhuan/notify`,buyer_name:username,
    }
    // 收款线路 (provider config.line): the gateway otherwise picks a 收款主体 per order.
    const line=Number(provider.config.line)
    if(Number.isSafeInteger(line)&&line>0)params.line=line
    // Split sub-orders must say so: some 收款主体 can't take split payments, and the
    // gateway cannot tell that a single piece belongs to a group.
    if(order.splitTotal&&order.splitTotal>1)params.split=1
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15_000)
    let definitiveFailure=false
    try{
      const response=await fetch(`${provider.endpoint.replace(/\/$/,'')}/api/v1/pay/create`,{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({...params,sign:sign(params,secret)}),signal:controller.signal,
      })
      const data=await response.json() as {code?:number;message?:string;data?:{qr_code?:string;out_trade_no?:string;trade_no?:string;checkout_url?:string;merchant?:string;line?:number;line_name?:string;line_honored?:boolean}}
      if((response.status>=400&&response.status<500)||(typeof data.code==='number'&&data.code!==0))definitiveFailure=true
      if(!response.ok||data.code!==0||!data.data?.qr_code)throw new Error(data.message||`HTTP ${response.status}`)
      const providerOrderNo=data.data.out_trade_no||data.data.trade_no||order.orderNo
      const checkoutUrl=typeof data.data.checkout_url==='string'&&data.data.checkout_url.startsWith('https://')?data.data.checkout_url:null
      const merchantName=typeof data.data.merchant==='string'?data.data.merchant.slice(0,120):null
      if(data.data.line_honored===false){
        // The chosen line is unavailable right now (daily cap, circuit breaker);
        // the gateway fell back to another 收款主体 so the customer can still pay.
        this.log(`[payments] 收款线路 ${params.line} 暂不可用，网关改用 ${data.data.line_name??data.data.line??'其它线路'}（${merchantName??'未知主体'}），订单 ${order.orderNo}`)
      }
      if(!await this.store.setOrderPayment(order.orderNo,providerOrderNo,data.data.qr_code,{checkoutUrl,merchantName})){
        const current=await this.store.getOrderForCallback(order.orderNo)
        if(current?.status==='paid')return {...order,status:'paid',providerOrderNo,payUrl:data.data.qr_code,checkoutUrl}
        throw new Error('本地订单状态已变化，请刷新订单状态')
      }
      return {...order,providerOrderNo,payUrl:data.data.qr_code,checkoutUrl}
    }catch(error){
      if(definitiveFailure)await this.store.failOrder(order.orderNo)
      throw new AppError('PAYMENT_CREATE_FAILED',`支付下单失败：${error instanceof Error?error.message:'网关通讯异常'}`,502)
    }finally{clearTimeout(timer)}
  }

  async handleZhongzhuanCallback(body:unknown){
    if(!body||typeof body!=='object')throw new AppError('PAYMENT_CALLBACK_INVALID','无效支付回调',400)
    const callback=body as ZhongzhuanCallback
    if(!callback.app_order_no||!callback.sign||!callback.app_id||callback.timestamp===undefined)throw new AppError('PAYMENT_CALLBACK_INVALID','支付回调字段不完整',400)
    const order=await this.store.getOrderForCallback(callback.app_order_no)
    if(!order)throw new AppError('PAYMENT_ORDER_NOT_FOUND','支付订单不存在',404)
    const provider=await this.store.getProvider(order.providerCode)
    if(!provider||provider.adapter!=='zhongzhuan')throw new AppError('PAYMENT_PROVIDER_INVALID','支付通道不匹配',400)
    const appId=credential(provider,'APP_ID'),secret=credential(provider,'APP_SECRET')
    const {sign:signature,...params}=callback
    if(callback.app_id!==appId||!safeHexEqual(sign(params,secret),signature))throw new AppError('PAYMENT_SIGNATURE_INVALID','支付签名验证失败',401)
    const timestamp=Number(callback.timestamp)
    if(!Number.isFinite(timestamp)||Math.abs(Math.floor(Date.now()/1000)-timestamp)>300)throw new AppError('PAYMENT_CALLBACK_EXPIRED','支付回调已过期',401)
    if(String(callback.status??'').toUpperCase()!=='PAID')return {ok:true,ignored:true}
    const amountCents=Math.round(Number(callback.amount)*100)
    if(!Number.isSafeInteger(amountCents)||amountCents!==order.amountCents)throw new AppError('PAYMENT_AMOUNT_MISMATCH','支付金额不匹配',409)
    const providerOrderNo=callback.out_trade_no||callback.trade_no||callback.app_order_no
    if(order.providerOrderNo&&order.providerOrderNo!==providerOrderNo&&order.providerOrderNo!==order.orderNo){
      throw new AppError('PAYMENT_ORDER_MISMATCH','支付平台订单号不匹配',409)
    }
    const eventId=callback.sn||callback.trade_no||callback.out_trade_no||`${callback.app_order_no}:${timestamp}`
    const paidAt=parsePaidAt(callback.paid_at)
    return this.store.fulfillPaidOrder({
      providerCode:provider.code,eventId,orderNo:callback.app_order_no,amountCents,
      providerOrderNo,payloadHash:createHash('sha256').update(JSON.stringify(callback)).digest('hex'),
      ...(paidAt?{paidAt}:{}),
    })
  }

  // 主动查单兜底：异步回调（notify_url）可能因回调地址不可达/网关未转发而永远收不到，
  // 前端点“刷新到账”时由服务端带凭据向网关查一次订单，命中已支付即幂等落地，
  // 与 handleZhongzhuanCallback 复用同一 fulfillPaidOrder（payment_events 去重，双写安全）。
  syncOrder(orderNo:string):Promise<SyncOrderResult>{
    const now=Date.now(),cached=this.syncCache.get(orderNo)
    if(cached&&now-cached.at<5_000)return cached.promise
    for(const [key,value] of this.syncCache){
      if(now-value.at>=60_000)this.syncCache.delete(key)
    }
    const promise=this.syncOrderUncached(orderNo)
    this.syncCache.set(orderNo,{at:now,promise})
    return promise
  }

  private async syncOrderUncached(orderNo:string):Promise<SyncOrderResult>{
    const order=await this.store.getOrderForCallback(orderNo)
    // 'closed' = 拆单里被换号重发的那笔：旧二维码仍可能被付款，照样查。
    if(!order||!['pending','failed','closed'].includes(order.status))return {ok:true,status:order?.status??'unknown',changed:false}
    const provider=await this.store.getProvider(order.providerCode)
    // enabled controls creation of new orders. Historical orders must remain
    // queryable after a provider is deactivated or switched.
    if(!provider||provider.adapter!=='zhongzhuan')return {ok:true,status:order.status,changed:false}
    const appId=credential(provider,'APP_ID'),secret=credential(provider,'APP_SECRET')
    const timestamp=Math.floor(Date.now()/1000)
    // 查单只签 app_id/timestamp/app_order_no（与统一收款 5ff 网关客户端一致，多签参数会验签失败）。
    const params:Record<string,Scalar>={app_id:appId,timestamp,app_order_no:orderNo}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8_000)
    try{
      const response=await fetch(`${provider.endpoint.replace(/\/$/,'')}/api/v1/pay/query`,{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({...params,sign:sign(params,secret)}),signal:controller.signal,
      })
      const data=await response.json() as {code?:number;message?:string;data?:{status?:string;amount?:number|string;out_trade_no?:string;trade_no?:string;paid_at?:string;sn?:string}}
      if(!response.ok||data.code!==0||!data.data?.status)throw new AppError('PAYMENT_QUERY_FAILED',`查单失败：${data.message||`HTTP ${response.status}`}`,502)
      const status=String(data.data.status).toUpperCase()
      // 网关状态：PENDING | PAID | CANCELLED | EXPIRED。终态置 failed 让前端停止轮询。
      if(status==='EXPIRED'||status==='CANCELLED'){await this.store.failOrder(orderNo);return {ok:true,status:status.toLowerCase(),changed:true}}
      if(status!=='PAID')return {ok:true,status:'pending',changed:false}
      const amountCents=Math.round(Number(data.data.amount)*100)
      if(!Number.isSafeInteger(amountCents)||amountCents!==order.amountCents)throw new AppError('PAYMENT_AMOUNT_MISMATCH','支付金额不匹配',409)
      const providerOrderNo=data.data.out_trade_no||data.data.trade_no||order.providerOrderNo||orderNo
      if(order.providerOrderNo&&order.providerOrderNo!==providerOrderNo&&order.providerOrderNo!==orderNo){
        throw new AppError('PAYMENT_ORDER_MISMATCH','支付平台订单号不匹配',409)
      }
      const eventId=data.data.sn||data.data.trade_no||data.data.out_trade_no||`${orderNo}:query`
      const paidAt=parsePaidAt(data.data.paid_at)
      const result=await this.store.fulfillPaidOrder({
        providerCode:provider.code,eventId,orderNo,amountCents,providerOrderNo,
        payloadHash:createHash('sha256').update(JSON.stringify(data.data)).digest('hex'),
        ...(paidAt?{paidAt}:{}),
      })
      return {...result,status:'paid',changed:!result.duplicate}
    }finally{clearTimeout(timer)}
  }
}

const parsePaidAt=(value?:string)=>{
  if(!value)return undefined
  const date=new Date(value)
  return Number.isFinite(date.getTime())?date:undefined
}
