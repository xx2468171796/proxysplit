// 代理站（AI 中转站代理商子站）：客户归属、客服联系方式、付费分成。
// 接入点：AuthService（登录 / 同步时 attribute + 回应里的 contact）、store.ts grantWithinTx(source='order') 记分成、
// refundOrder 作废。业主 2026-11-17：主站客户只显示业主微信，代理站客户只显示该代理商微信；分成线下结算。
import http from 'node:http'
import https from 'node:https'
import { aigwDealerSchema, DEALER_SLUG_RE } from '@proxysplit/contracts'

type Db={ query(text:string,params?:unknown[]):Promise<{rows:unknown[];rowCount:number|null}> }
export type DealerContact={wechat:string;brand?:string}
/** 主站（ai.zygskins.cn）客户看到的客服微信 */
export const MAIN_SITE_WECHAT='zyg69996'
const REFRESH_MS=10*60_000

export const dealerCommissionCents=(grossCents:number,bps:number)=>Math.floor(grossCents*bps/10000)

/** GET → 状态码 + 解析好的 JSON（解析失败 = null） */
export type DealerHttpGet=(url:string,headers:Record<string,string>,timeoutMs:number)=>Promise<{status:number;body:unknown}>
export type DealerFetchConfig={baseUrl:string;host?:string|undefined;timeoutMs?:number;get?:DealerHttpGet;now?:()=>number}

// 用 node:http(s) 而不是 fetch：Node 的 fetch 会丢掉自定义 Host 头，走内网地址 + Host 时必须这样。
export const nodeHttpGet:DealerHttpGet=(url,headers,timeoutMs)=>new Promise((resolve,reject)=>{
  const u=new URL(url)
  const req=(u.protocol==='https:'?https:http).request(u,{method:'GET',headers,timeout:timeoutMs},res=>{
    let raw='';let size=0
    res.setEncoding('utf8')
    res.on('data',(c:string)=>{size+=c.length;if(size>64*1024){req.destroy(new Error('too large'));return}raw+=c})
    res.on('end',()=>{let body:unknown=null;try{body=JSON.parse(raw)}catch{/* 非 JSON */}resolve({status:res.statusCode??0,body})})
  })
  req.on('timeout',()=>req.destroy(new Error('timeout')))
  req.on('error',reject)
  req.end()
})
type DealerRow={slug:string;brand:string;contact:string;enabled:boolean;fetchedAt:Date|null}

export class DealerService{
  /** 上次尝试拉取的时间（含失败）：失败也 10 分钟内不重试，aigw 挂了不拖慢登录 */
  private attempts=new Map<string,number>()
  constructor(private db:Db,private cfg:DealerFetchConfig){}
  private now(){return this.cfg.now?.()??Date.now()}

  /** 拉 aigw 公开接口；404 = 不存在（按停用记），其它失败返回 null（保留缓存）。 */
  private async fetchRemote(slug:string):Promise<{brand:string;contact:string;enabled:boolean}|null>{
    try{
      const headers:Record<string,string>={accept:'application/json'}
      if(this.cfg.host)headers.host=this.cfg.host
      const res=await (this.cfg.get??nodeHttpGet)(`${this.cfg.baseUrl.replace(/\/+$/,'')}/api/public/dealers/${encodeURIComponent(slug)}`,headers,this.cfg.timeoutMs??5000)
      if(res.status===404)return {brand:'',contact:'',enabled:false}
      if(res.status<200||res.status>=300)return null
      const parsed=aigwDealerSchema.safeParse(res.body)
      if(!parsed.success||parsed.data.slug!==slug)return null
      return {brand:parsed.data.brand,contact:parsed.data.contact,enabled:parsed.data.enabled}
    }catch{return null}
  }

  /** 读代理商（首次见到或超过 10 分钟就刷新；commission_bps 永不被拉取覆盖）。 */
  async get(slug:string):Promise<DealerRow|null>{
    if(!DEALER_SLUG_RE.test(slug))return null
    const row=(await this.db.query(`SELECT slug,brand,contact,enabled,fetched_at AS "fetchedAt" FROM dealers WHERE slug=$1`,[slug])).rows[0] as DealerRow|undefined
    const now=this.now()
    const stale=!row?.fetchedAt||now-new Date(row.fetchedAt).getTime()>=REFRESH_MS
    if(!stale||now-(this.attempts.get(slug)??0)<REFRESH_MS)return row??null
    this.attempts.set(slug,now)
    const remote=await this.fetchRemote(slug)
    if(!remote)return row??null
    // 不存在的代理商不建行（避免随便一个标识就占表）；已有行（比如后台先设了比例）照常更新。
    if(!row&&!remote.enabled)return null
    const saved=(await this.db.query(`INSERT INTO dealers(slug,brand,contact,enabled,fetched_at,updated_at) VALUES($1,$2,$3,$4,now(),now())
      ON CONFLICT(slug) DO UPDATE SET brand=EXCLUDED.brand,contact=EXCLUDED.contact,enabled=EXCLUDED.enabled,fetched_at=now(),updated_at=now()
      RETURNING slug,brand,contact,enabled,fetched_at AS "fetchedAt"`,[slug,remote.brand,remote.contact,remote.enabled])).rows[0] as DealerRow
    return saved
  }

  /** 客户归属：只给 aigw 渠道、还没归属的账号写一次，且代理商必须在 aigw 存在并启用。出错不挡登录。 */
  async attribute(userId:string,slug:string|undefined):Promise<boolean>{
    if(!slug)return false
    try{
      const d=await this.get(slug)
      if(!d?.enabled)return false
      const r=await this.db.query(`UPDATE users SET dealer=$2,updated_at=now() WHERE id=$1 AND dealer='' AND channel='aigw'`,[userId,slug])
      return (r.rowCount??0)>0
    }catch(e){console.error('[dealer] attribute failed',{userId,slug,error:(e as Error).message});return false}
  }

  /** 客户端显示的客服：普通用户 null；主站 aigw → 业主微信；代理站 → 该代理商（未知 / 停用 / 没填联系方式按主站）。 */
  async contactFor(userId:string):Promise<DealerContact|null>{
    const u=(await this.db.query(`SELECT channel,dealer FROM users WHERE id=$1`,[userId])).rows[0] as {channel:string;dealer:string}|undefined
    if(!u||u.channel!=='aigw')return null
    if(u.dealer){
      const d=await this.get(u.dealer).catch(()=>null)
      if(d?.enabled&&d.contact)return {wechat:d.contact,...(d.brand?{brand:d.brand}:{})}
    }
    return {wechat:MAIN_SITE_WECHAT}
  }
}

/**
 * 付款发货时记一行分成（与发货同事务，保存点隔离：出错只记日志，绝不挡客户的发货）。
 * 来源 = 拆单组 id（整组一次）或订单 id，source 唯一 → 回调重放不重记；gross = 实付分（含后台手动确认的单，先记下不丢）；
 * bps = 当时代理商的比例快照（0 也记，比例定了再线下按 gross 补算）。
 */
export async function recordDealerCommissionInTx(client:Db,orderId:string){
  await client.query('SAVEPOINT dealer_commission')
  try{
    await client.query(`INSERT INTO dealer_commissions(dealer_slug,user_id,source,gross_cents,bps,commission_cents)
      SELECT d.slug,u.id,x.ref,x.gross,d.commission_bps,floor(x.gross::numeric*d.commission_bps/10000)::int
      FROM (SELECT o.user_id,coalesce(o.group_id::text,o.id::text) AS ref,
          (SELECT coalesce(sum(g.amount_cents),0)::int FROM orders g
            WHERE g.id=o.id OR (o.group_id IS NOT NULL AND g.group_id=o.group_id AND g.status='paid')) AS gross
        FROM orders o WHERE o.id=$1) x
      JOIN users u ON u.id=x.user_id AND u.dealer<>''
      JOIN dealers d ON d.slug=u.dealer
      WHERE x.gross>0
      ON CONFLICT (source) DO NOTHING`,[orderId])
    await client.query('RELEASE SAVEPOINT dealer_commission')
  }catch(e){
    await client.query('ROLLBACK TO SAVEPOINT dealer_commission')
    console.error('[dealer] commission failed',{orderId,error:(e as Error).message})
  }
}

/** 退款同事务作废分成；已结算的也作废，备注写明「结算后退款」方便线下追回。 */
export async function voidDealerCommissionInTx(client:Db,source:string,reason:string){
  await client.query('SAVEPOINT dealer_void')
  try{
    await client.query(`UPDATE dealer_commissions SET status='void',
      note=CASE WHEN status='settled' THEN '结算后退款：'||$2::text ELSE '退款：'||$2::text END
    WHERE source=$1 AND status<>'void'`,[source,reason.slice(0,180)])
    await client.query('RELEASE SAVEPOINT dealer_void')
  }catch(e){
    await client.query('ROLLBACK TO SAVEPOINT dealer_void')
    console.error('[dealer] void failed',{source,error:(e as Error).message})
  }
}
