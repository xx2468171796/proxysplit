// 多级分销真库场景（跑在一个空的测试库上，会建表写数据；绝不对生产库跑）：
//   DATABASE_URL=postgres://…/空测试库 pnpm --filter @proxysplit/db migrate
//   DATABASE_URL=… pnpm --filter @proxysplit/api exec tsx scripts/fenxiao-scenario.mts
// 覆盖：带码注册绑上级 → 付款回调分佣（两级）→ 回调重放不重发 → 拆单付齐才按整组分一次 
// 手动确认不分佣 → 退款冲回 → 坏规则不挡付款 → 冻结 0 天直接可提现 → 提现 / 驳回 / 打款。
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { defaultFenxiaoPolicy, FenxiaoService, PgStore } from '@proxysplit/core'

const url=process.env.DATABASE_URL
if(!url)throw new Error('DATABASE_URL is required')
if(!/localhost|127\.0\.0\.1|paytest|_test/.test(url))throw new Error('refusing: DATABASE_URL does not look like a test database')
const store=new PgStore(url)
const svc=new FenxiaoService(store)
const q=(text:string,vals:unknown[]=[])=>store.pool.query(text,vals)
let passed=0
const step=async(name:string,fn:()=>Promise<void>)=>{await fn();passed++;console.log(`✔ ${name}`)}

const plan=(await q(`SELECT id,name,tier FROM plans WHERE tier<>'trial' AND active=true ORDER BY price_cents DESC LIMIT 1`)).rows[0]
const provider=(await q(`SELECT code FROM payment_providers LIMIT 1`)).rows[0]?.code
  ??(await q(`INSERT INTO payment_providers(code,name,enabled,config) VALUES('test','test',true,'{}') RETURNING code`)).rows[0].code
assert.ok(plan,'需要一个付费套餐（迁移 0003 自带）')
const tag=Date.now().toString(36)
const web=(name:string,ref?:string)=>store.registerWebUser({username:`${name}_${tag}`,email:`${name}_${tag}@t.local`,passwordHash:'x',ip:`10.0.${Math.floor(Math.random()*250)}.${Math.floor(Math.random()*250)}`,...(ref?{ref}:{})})
const order=async(userId:string,cents:number,group?:{id:string;index:number;total:number})=>{
  const no=`FX${tag}${Math.random().toString(36).slice(2,8)}`
  await q(`INSERT INTO orders(order_no,user_id,plan_id,plan_name,tier,billing_cycle,duration_days,amount_cents,provider_code,group_id,split_index,split_total)
    VALUES($1,$2,$3,$4,$5,'month',30,$6,$7,$8,$9,$10)`,[no,userId,plan.id,plan.name,plan.tier,cents,provider,group?.id??null,group?.index??null,group?.total??null])
  return no
}
const pay=(no:string,cents:number,eventId:string=randomUUID())=>store.fulfillPaidOrder({providerCode:provider,eventId,orderNo:no,amountCents:cents,providerOrderNo:`P${no}`,payloadHash:'h'})
const amounts=async(ref:string)=>(await q(`SELECT u.username,c.amount::int AS amount,c.status FROM fx_commissions c JOIN users u ON u.id::text=c.beneficiary_user_id
  WHERE c.source_ref=$1 ORDER BY c.level`,[ref])).rows.map(r=>`${String(r.username).split('_')[0]}:${r.amount}:${r.status}`)
const refOf=async(no:string)=>(await q(`SELECT coalesce(group_id::text,id::text) AS r FROM orders WHERE order_no=$1`,[no])).rows[0].r as string

const operator=await web('op')
await svc.savePolicy({...defaultFenxiaoPolicy,enabled:true,maxLevels:2,tiers:[{code:'agent',name:'分销商',rates:[2000,500]}],totalCapBps:4000,freezeDays:7},operator.id)
const top=await web('top')
await svc.grant(top.username,{tierCode:'agent'})
const topCode=(await svc.me(top.id)).code??''
const mid=await web('mid',topCode)
await svc.grant(mid.username,{tierCode:'agent'})
const midCode=(await svc.me(mid.id)).code??''
const buyer=await web('buyer',midCode.toLowerCase())

await step('带码注册绑上级（码不分大小写），上级链 = [mid, top]',async()=>{
  assert.deepEqual((await store.fx.getMember(buyer.id))?.ancestors,[mid.id,top.id])
  const stray=await web('stray','NOSUCHCODE')
  assert.equal(await store.fx.getMember(stray.id),null)
})
let first=''
await step('付款回调分两级佣金（20% / 5%），冻结中',async()=>{
  first=await order(buyer.id,3000)
  await pay(first,3000,'evt-1')
  assert.deepEqual(await amounts(await refOf(first)),['mid:600:frozen','top:150:frozen'])
})
await step('同一回调重放 / 另一条回调同单：不重发',async()=>{
  assert.equal((await pay(first,3000,'evt-1')).duplicate,true)
  assert.equal((await pay(first,3000,'evt-1b')).duplicate,true)
  assert.equal((await q(`SELECT count(*)::int AS n FROM fx_commissions WHERE source_ref=$1`,[await refOf(first)])).rows[0].n,2)
})
await step('拆单：付一笔不分佣，付齐按整组 3000 分一次',async()=>{
  const g=randomUUID()
  const a=await order(buyer.id,2000,{id:g,index:1,total:2}),b=await order(buyer.id,1000,{id:g,index:2,total:2})
  await pay(a,2000)
  assert.deepEqual(await amounts(g),[])
  await pay(b,1000)
  assert.deepEqual(await amounts(g),['mid:600:frozen','top:150:frozen'])
})
await step('后台手动确认不分佣（没经网关到账）',async()=>{
  const no=await order(buyer.id,1000)
  await store.confirmOrderManually(no)
  assert.deepEqual(await amounts(await refOf(no)),[])
})
await step('退款同事务冲回，余额扣回',async()=>{
  const before=await store.fx.account(mid.id)
  await store.refundOrder(first,'测试退款')
  assert.deepEqual(await amounts(await refOf(first)),['mid:600:reversed','top:150:reversed'])
  const after=await store.fx.account(mid.id)
  assert.equal(before.frozen-after.frozen,600n)
})
await step('规则被手改坏 → 按关处理，付款照常发货、不分佣',async()=>{
  await q(`UPDATE system_settings SET value='{"enabled":true}' WHERE key='fenxiao_policy'`)
  const no=await order(buyer.id,1000)
  assert.equal((await pay(no,1000)).ok,true)
  assert.deepEqual(await amounts(await refOf(no)),[])
})
await step('冻结 0 天直接可提现；提现 → 驳回退回 → 再提 → 打款',async()=>{
  await svc.savePolicy({...defaultFenxiaoPolicy,enabled:true,maxLevels:2,tiers:[{code:'agent',name:'分销商',rates:[2000,500]}],totalCapBps:4000,freezeDays:0,minWithdrawalCents:100},operator.id)
  const no=await order(buyer.id,5000)
  await pay(no,5000)
  const me=await svc.me(mid.id)
  assert.equal(me.account.availableCents,1000)
  await assert.rejects(svc.withdraw(mid.id,{amountCents:1001,method:'alipay',account:'a@b.c',name:'测'}),/余额不足/)
  const w=await svc.withdraw(mid.id,{amountCents:800,method:'alipay',account:'a@b.c',name:'测'})
  await svc.review(w.id,'rejected','admin','账号不对')
  const w2=await svc.withdraw(mid.id,{amountCents:1000,method:'alipay',account:'a@b.c',name:'测'})
  await svc.review(w2.id,'paid','admin')
  const acc=(await svc.me(mid.id)).account
  assert.deepEqual([acc.availableCents,acc.withdrawnCents],[0,1000])
})
await step('后台列表带用户名 / 订单号；推广人看到的买家打码',async()=>{
  const list=await svc.listCommissions({limit:20,offset:0,q:mid.username})
  assert.ok(list.items.every(c=>c.beneficiary===mid.username&&c.orderNo))
  const mine=await svc.myCommissions(mid.id,{limit:20,offset:0})
  assert.ok(mine.items.every(c=>c.buyer.includes('***')))
  const members=await svc.listMembers({limit:20,offset:0,agentsOnly:'1'})
  assert.ok(members.items.some(m=>m.username===mid.username&&m.parentUsername===top.username&&m.directCount===1))
  const ov=await svc.overview(30)
  assert.ok(ov.withdrawnCents>=1000&&ov.agents>=2)
})
console.log(`\n${passed} 项全过`)
await store.close()
