// 统一支付中心把玩家同金额的旧未付单还回来（reused）时，本地订单的「接管」规则。
// 只有同一用户、同一套餐、同一金额、同一通道的非拆单订单才接管（否则付的是 A 套餐的钱、发的是 B 套餐）；
// 接管 = 旧单重新变成可付，所以要在同一事务里重新过「套餐在售」与「限购」两道闸（与 store.createOrders 同一套条件）。

type Rows={rows:Array<Record<string,unknown>>;rowCount?:number|null}
type Query=(sql:string,params?:unknown[])=>Promise<Rows>
export type ReusePool={query:Query;connect():Promise<{query:Query;release():void}>}
export type ReuseLink={providerOrderNo:string;payUrl:string;checkoutUrl?:string|null;expiresAt?:Date}
export type AdoptResult={ok:true}|{ok:false;reason:'mismatch'|'off_sale'|'limit'|'state'}

/** 套餐当前在售（createOrders 与接管共用）。 */
export const PLAN_ON_SALE_SQL=`active=true AND public=true AND (sale_starts_at IS NULL OR sale_starts_at<=now()) AND (sale_ends_at IS NULL OR sale_ends_at>now())`
/** 已占用的购买次数：已付 + 未过期待付，拆单按组算一次；$3 = 不计入的订单号（接管时的新旧两单）。 */
export const PURCHASE_COUNT_SQL=`SELECT count(DISTINCT coalesce(group_id,id))::int AS n FROM orders
  WHERE user_id=$1 AND plan_id=$2 AND (status='paid' OR (status='pending' AND expires_at>now())) AND NOT (order_no=ANY($3::text[]))`
export const purchaseLockKey=(userId:string,planId:string)=>`purchase:${userId}:${planId}`

const SAME=['user_id','plan_id','amount_cents','provider_code'] as const

/** 旧单 target 能不能当作新单 fresh 的替身（只读预判；真正接管时事务里再核一遍）。 */
export async function isOrderReusableAs(pool:Pick<ReusePool,'query'>,target:string,fresh:string):Promise<boolean>{
  const r=await pool.query(`SELECT 1 FROM orders t JOIN orders n ON n.order_no=$2
    WHERE t.order_no=$1 AND t.user_id=n.user_id AND t.plan_id=n.plan_id AND t.amount_cents=n.amount_cents
      AND t.provider_code=n.provider_code AND t.group_id IS NULL`,[target,fresh])
  return r.rows.length>0
}

/** 接管：作废这次新建的 fresh，把 target 恢复成待支付并换上中心给的码。任何一道闸不过都整体回滚。 */
export async function adoptReusedOrder(pool:ReusePool,fresh:string,target:string,link:ReuseLink):Promise<AdoptResult>{
  const client=await pool.connect()
  const refuse=async(reason:Exclude<AdoptResult,{ok:true}>['reason']):Promise<AdoptResult>=>{await client.query('ROLLBACK');return {ok:false,reason}}
  try{
    await client.query('BEGIN')
    const rows=(await client.query(`SELECT order_no,user_id,plan_id,amount_cents,provider_code,group_id,status FROM orders
      WHERE order_no=ANY($1::text[]) ORDER BY order_no FOR UPDATE`,[[target,fresh]])).rows
    const t=rows.find(r=>r.order_no===target),n=rows.find(r=>r.order_no===fresh)
    if(!t||!n||t.group_id!==null||SAME.some(k=>t[k]!==n[k]))return await refuse('mismatch')
    if(t.status==='paid'){
      await client.query(`UPDATE orders SET status='failed',updated_at=now() WHERE order_no=$1 AND status='pending'`,[fresh])
      await client.query('COMMIT')
      return {ok:true}
    }
    if(t.status!=='pending'&&t.status!=='failed')return await refuse('state')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[purchaseLockKey(String(t.user_id),String(t.plan_id))])
    const plan=(await client.query(`SELECT purchase_limit_per_user FROM plans WHERE id=$1 AND ${PLAN_ON_SALE_SQL}`,[t.plan_id])).rows[0]
    if(!plan)return await refuse('off_sale')
    const limit=Number(plan.purchase_limit_per_user??0)
    if(limit>0){
      const used=Number((await client.query(PURCHASE_COUNT_SQL,[t.user_id,t.plan_id,[target,fresh]])).rows[0]?.n??0)
      if(used>=limit)return await refuse('limit')
    }
    await client.query(`UPDATE orders SET status='failed',updated_at=now() WHERE order_no=$1 AND status='pending'`,[fresh])
    await client.query(`UPDATE orders SET provider_order_no=$2,pay_url=$3,checkout_url=$4,merchant_name=NULL,expires_at=coalesce($5,expires_at),status='pending',updated_at=now()
      WHERE order_no=$1`,[target,link.providerOrderNo,link.payUrl,link.checkoutUrl??null,link.expiresAt??null])
    await client.query('COMMIT')
    return {ok:true}
  }catch(e){await client.query('ROLLBACK').catch(()=>undefined);throw e}finally{client.release()}
}
