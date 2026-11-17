// 中心还回旧未付单时的「接管」事务：同人同套餐同金额才接管，接管 = 重新过在售 / 限购。
import { describe, expect, it } from 'vitest'
import { adoptReusedOrder, isOrderReusableAs, type ReusePool } from './order-reuse.js'

type Row=Record<string,unknown>
const base={user_id:'u1',plan_id:'p1',amount_cents:9900,provider_code:'zhifu-center',group_id:null}

function fakePool(o:{target:Row|null;fresh:Row|null;onSale?:boolean;limit?:number|null;used?:number}){
  const log:string[]=[]
  const updates:Array<{sql:string;params:unknown[]}>=[]
  const pool:ReusePool={
    async query(sql,params=[]){
      const s=sql.replace(/\s+/g,' ').trim()
      if(s.startsWith('SELECT 1 FROM orders t JOIN orders n')){
        const ok=!!o.target&&!!o.fresh&&['user_id','plan_id','amount_cents','provider_code'].every(k=>o.target![k]===o.fresh![k])&&o.target.group_id===null
        return {rows:ok?[{}]:[],rowCount:ok?1:0}
      }
      throw new Error(`unexpected pool SQL: ${s} ${JSON.stringify(params)}`)
    },
    async connect(){
      return {
        release(){log.push('release')},
        async query(sql,params=[]){
          const s=sql.replace(/\s+/g,' ').trim()
          if(/^(BEGIN|COMMIT|ROLLBACK)$/.test(s)){log.push(s);return {rows:[],rowCount:0}}
          if(s.startsWith('SELECT order_no,user_id,plan_id')){
            const rows=[o.target,o.fresh].filter((r):r is Row=>!!r)
            return {rows,rowCount:rows.length}
          }
          if(s.startsWith('SELECT pg_advisory_xact_lock'))return {rows:[],rowCount:1}
          if(s.startsWith('SELECT purchase_limit_per_user FROM plans')){
            const rows=o.onSale===false?[]:[{purchase_limit_per_user:o.limit??null}]
            return {rows,rowCount:rows.length}
          }
          if(s.startsWith('SELECT count(DISTINCT coalesce(group_id,id))'))return {rows:[{n:o.used??0}],rowCount:1}
          if(s.startsWith('UPDATE orders')){updates.push({sql:s,params});return {rows:[],rowCount:1}}
          throw new Error(`unexpected SQL: ${s}`)
        },
      }
    },
  }
  return {pool,log,updates}
}
const link={providerOrderNo:'PR1',payUrl:'https://pay/1',checkoutUrl:null}

describe('中心还回旧未付单的接管',()=>{
  it('同人同套餐同金额才算可接管',async()=>{
    const same=fakePool({target:{...base,order_no:'OLD',status:'failed'},fresh:{...base,order_no:'NEW',status:'pending'}})
    expect(await isOrderReusableAs(same.pool,'OLD','NEW')).toBe(true)
    for(const diff of [{plan_id:'p2'},{user_id:'u2'},{amount_cents:1}]){
      const f=fakePool({target:{...base,...diff,order_no:'OLD',status:'failed'},fresh:{...base,order_no:'NEW',status:'pending'}})
      expect(await isOrderReusableAs(f.pool,'OLD','NEW')).toBe(false)
    }
  })

  it('接管失败单：同一事务里作废新单、恢复旧单并换上新码',async()=>{
    const f=fakePool({target:{...base,order_no:'OLD',status:'failed'},fresh:{...base,order_no:'NEW',status:'pending'},limit:1,used:0})
    expect(await adoptReusedOrder(f.pool,'NEW','OLD',link)).toEqual({ok:true})
    expect(f.updates).toHaveLength(2)
    expect(f.updates[0]?.params).toEqual(['NEW'])
    expect(f.updates[1]?.params.slice(0,3)).toEqual(['OLD','PR1','https://pay/1'])
    expect(f.log).toEqual(['BEGIN','COMMIT','release'])
  })

  it('套餐不同 / 已下架 / 超过限购：不接管，什么都不改',async()=>{
    const cases:Array<[Parameters<typeof fakePool>[0],string]>=[
      [{target:{...base,plan_id:'p2',order_no:'OLD',status:'failed'},fresh:{...base,order_no:'NEW',status:'pending'}},'mismatch'],
      [{target:{...base,order_no:'OLD',status:'failed'},fresh:{...base,order_no:'NEW',status:'pending'},onSale:false},'off_sale'],
      [{target:{...base,order_no:'OLD',status:'failed'},fresh:{...base,order_no:'NEW',status:'pending'},limit:1,used:1},'limit'],
      [{target:{...base,order_no:'OLD',status:'refunded'},fresh:{...base,order_no:'NEW',status:'pending'}},'state'],
      [{target:null,fresh:{...base,order_no:'NEW',status:'pending'}},'mismatch'],
    ]
    for(const [input,reason] of cases){
      const f=fakePool(input)
      expect(await adoptReusedOrder(f.pool,'NEW','OLD',link)).toEqual({ok:false,reason})
      expect(f.updates).toHaveLength(0)
      expect(f.log).toEqual(['BEGIN','ROLLBACK','release'])
    }
  })

  it('旧单其实已经付了：只作废新单，不动已付的那笔',async()=>{
    const f=fakePool({target:{...base,order_no:'OLD',status:'paid'},fresh:{...base,order_no:'NEW',status:'pending'}})
    expect(await adoptReusedOrder(f.pool,'NEW','OLD',link)).toEqual({ok:true})
    expect(f.updates.map(u=>u.params)).toEqual([['NEW']])
  })
})
