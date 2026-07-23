import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { AppError } from '@proxysplit/shared'
import type { PgStore, PaymentProviderRecord } from './store.js'

type Scalar=string|number
type ZhongzhuanCallback={
  app_id?:string;out_trade_no?:string;app_order_no?:string;amount?:number|string;
  status?:string;timestamp?:number|string;sign?:string;sn?:string;trade_no?:string;
  payway?:string;payer_info?:string;paid_at?:string
}

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
  constructor(private store:PgStore,private publicBaseUrl:string){}

  async createOrder(userId:string,planId:string,username:string){
    const order=await this.store.createOrder(userId,planId)
    const provider=await this.store.getProvider(order.providerCode)
    if(!provider||!provider.enabled)throw new AppError('PAYMENT_UNAVAILABLE','支付通道暂不可用',503)
    if(provider.adapter!=='zhongzhuan'){
      await this.store.failOrder(order.orderNo)
      throw new AppError('PAYMENT_UNSUPPORTED','支付通道适配器不可用',503)
    }
    const appId=credential(provider,'APP_ID'),secret=credential(provider,'APP_SECRET')
    const timestamp=Math.floor(Date.now()/1000)
    const params:Record<string,Scalar>={
      app_id:appId,timestamp,app_order_no:order.orderNo,amount:order.amountCents/100,
      subject:`ProxySplit ${order.planName}`,order_type:'recharge',
      notify_url:`${this.publicBaseUrl}/v1/payments/zhongzhuan/notify`,buyer_name:username,
    }
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15_000)
    try{
      const response=await fetch(`${provider.endpoint.replace(/\/$/,'')}/api/v1/pay/create`,{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({...params,sign:sign(params,secret)}),signal:controller.signal,
      })
      const data=await response.json() as {code?:number;message?:string;data?:{qr_code?:string;out_trade_no?:string;trade_no?:string}}
      if(!response.ok||data.code!==0||!data.data?.qr_code)throw new Error(data.message||`HTTP ${response.status}`)
      const providerOrderNo=data.data.out_trade_no||data.data.trade_no||order.orderNo
      await this.store.setOrderPayment(order.orderNo,providerOrderNo,data.data.qr_code)
      return {...order,providerOrderNo,payUrl:data.data.qr_code}
    }catch(error){
      await this.store.failOrder(order.orderNo)
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
    if(callback.status!=='PAID')return {ok:true,ignored:true}
    const amountCents=Math.round(Number(callback.amount)*100)
    if(!Number.isSafeInteger(amountCents)||amountCents!==order.amountCents)throw new AppError('PAYMENT_AMOUNT_MISMATCH','支付金额不匹配',409)
    const providerOrderNo=callback.out_trade_no||callback.trade_no||callback.app_order_no
    if(order.providerOrderNo&&order.providerOrderNo!==providerOrderNo&&order.providerOrderNo!==order.orderNo){
      throw new AppError('PAYMENT_ORDER_MISMATCH','支付平台订单号不匹配',409)
    }
    const eventId=callback.sn||callback.trade_no||callback.out_trade_no||`${callback.app_order_no}:${timestamp}`
    return this.store.fulfillPaidOrder({
      providerCode:provider.code,eventId,orderNo:callback.app_order_no,amountCents,
      providerOrderNo,payloadHash:createHash('sha256').update(JSON.stringify(callback)).digest('hex'),
    })
  }

  // 主动查单兜底：异步回调（notify_url）可能因回调地址不可达/网关未转发而永远收不到，
  // 前端点“刷新到账”时由服务端带凭据向网关查一次订单，命中已支付即幂等落地，
  // 与 handleZhongzhuanCallback 复用同一 fulfillPaidOrder（payment_events 去重，双写安全）。
  async syncOrder(orderNo:string){
    const order=await this.store.getOrderForCallback(orderNo)
    if(!order||order.status!=='pending')return {ok:true,status:order?.status??'unknown',changed:false}
    const provider=await this.store.getProvider(order.providerCode)
    if(!provider||!provider.enabled||provider.adapter!=='zhongzhuan')return {ok:true,status:order.status,changed:false}
    const appId=credential(provider,'APP_ID'),secret=credential(provider,'APP_SECRET')
    const timestamp=Math.floor(Date.now()/1000)
    // 查单只签 app_id/timestamp/app_order_no（与统一收款 5ff 网关客户端一致，多签参数会验签失败）。
    const params:Record<string,Scalar>={app_id:appId,timestamp,app_order_no:orderNo}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15_000)
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
      const result=await this.store.fulfillPaidOrder({
        providerCode:provider.code,eventId,orderNo,amountCents,providerOrderNo,
        payloadHash:createHash('sha256').update(JSON.stringify(data.data)).digest('hex'),
      })
      return {...result,status:'paid',changed:true}
    }finally{clearTimeout(timer)}
  }
}
