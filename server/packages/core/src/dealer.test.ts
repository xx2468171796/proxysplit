import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { DealerService, dealerCommissionCents, MAIN_SITE_WECHAT, nodeHttpGet, voidDealerCommissionInTx, type DealerHttpGet } from './dealer.js'

type Q={text:string;params:unknown[]}
const fakeDb=(handler:(q:Q)=>{rows?:unknown[];rowCount?:number}|Error)=>{
  const calls:Q[]=[]
  const db={query:vi.fn(async(text:string,params:unknown[]=[])=>{
    const q={text,params};calls.push(q)
    const r=handler(q)
    if(r instanceof Error)throw r
    return {rows:r.rows??[],rowCount:r.rowCount??(r.rows?.length??0)}
  })}
  // 归属要开事务：connect() 给回同一个假库
  return {db:Object.assign(db,{connect:async()=>({query:db.query,release:()=>{}})}),calls}
}
const remote=(status:number,body:unknown):DealerHttpGet=>vi.fn(async()=>({status,body}))

describe('dealer commission math',()=>{
  it('floors to whole cents',()=>{
    expect(dealerCommissionCents(9900,3000)).toBe(2970)
    expect(dealerCommissionCents(3333,3000)).toBe(999)
    expect(dealerCommissionCents(9900,0)).toBe(0)
  })
})

describe('DealerService.get',()=>{
  it('fetches on first sight, caches for 10 minutes and never writes commission_bps',async()=>{
    let row:Record<string,unknown>|undefined
    const {db,calls}=fakeDb(q=>{
      if(q.text.startsWith('SELECT slug'))return {rows:row?[row]:[]}
      if(q.text.startsWith('INSERT INTO dealers')){row={slug:'wen',brand:q.params[1],contact:q.params[2],enabled:q.params[3],fetchedAt:new Date(now)};return {rows:[row]}}
      return {}
    })
    let now=1_000_000
    const get=remote(200,{slug:'wen',brand:'文',contact:'rjz665',enabled:true})
    const s=new DealerService(db,{baseUrl:'http://aigw.local/',host:'ai.zygskins.cn',get,now:()=>now})
    expect(await s.get('wen')).toMatchObject({contact:'rjz665',enabled:true})
    expect(get).toHaveBeenCalledWith('http://aigw.local/api/public/dealers/wen',{accept:'application/json',host:'ai.zygskins.cn'},5000)
    const upsert=calls.find(c=>c.text.startsWith('INSERT INTO dealers'))
    expect(upsert?.text).not.toMatch(/commission_bps/)
    now+=9*60_000
    await s.get('wen')
    expect(get).toHaveBeenCalledTimes(1)
    now+=2*60_000
    await s.get('wen')
    expect(get).toHaveBeenCalledTimes(2)
  })
  it('keeps the cache when aigw fails and does not retry within 10 minutes',async()=>{
    const cached={slug:'wen',brand:'文',contact:'rjz665',enabled:true,fetchedAt:new Date(0)}
    const {db,calls}=fakeDb(q=>q.text.startsWith('SELECT slug')?{rows:[cached]}:{})
    const get=remote(503,null)
    const s=new DealerService(db,{baseUrl:'http://x',get,now:()=>100*60_000})
    expect(await s.get('wen')).toEqual(cached)
    await s.get('wen')
    expect(get).toHaveBeenCalledTimes(1)
    expect(calls.some(c=>c.text.startsWith('INSERT'))).toBe(false)
  })
  it('unknown dealer (404) is not stored; invalid slugs never hit the network',async()=>{
    const {db,calls}=fakeDb(()=>({rows:[]}))
    const get=remote(404,null)
    const s=new DealerService(db,{baseUrl:'http://x',get})
    expect(await s.get('nope')).toBeNull()
    expect(calls.some(c=>c.text.startsWith('INSERT'))).toBe(false)
    expect(await s.get('../etc')).toBeNull()
    expect(get).toHaveBeenCalledTimes(1)
  })
})

describe('DealerService attribution and contact',()=>{
  const svc=(user:{channel:string;dealer:string}|undefined,dealer:Record<string,unknown>|undefined)=>{
    const {db,calls}=fakeDb(q=>{
      if(q.text.startsWith('SELECT channel'))return {rows:user?[user]:[]}
      if(q.text.startsWith('SELECT slug'))return {rows:dealer?[{...dealer,fetchedAt:new Date()}]:[]}
      if(q.text.startsWith('UPDATE users'))return {rowCount:1}
      return {}
    })
    return {s:new DealerService(db,{baseUrl:'http://x',get:remote(500,null)}),calls}
  }
  it('attributes only to an enabled dealer, once, aigw accounts only (in SQL)',async()=>{
    const ok=svc(undefined,{slug:'wen',brand:'',contact:'rjz665',enabled:true})
    expect(await ok.s.attribute('u1','wen')).toBe(true)
    const upd=ok.calls.find(c=>c.text.startsWith('UPDATE users'))
    expect(upd?.text).toMatch(/dealer=''/)
    expect(upd?.text).toMatch(/channel='aigw'/)
    const off=svc(undefined,{slug:'wen',brand:'',contact:'rjz665',enabled:false})
    expect(await off.s.attribute('u1','wen')).toBe(false)
    expect(off.calls.some(c=>c.text.startsWith('UPDATE users'))).toBe(false)
    expect(await off.s.attribute('u1',undefined)).toBe(false)
  })
  it('plain users get no contact; main site → owner; dealer → dealer only; disabled dealer → main site',async()=>{
    expect(await svc({channel:'',dealer:''},undefined).s.contactFor('u')).toBeNull()
    expect(await svc({channel:'aigw',dealer:''},undefined).s.contactFor('u')).toEqual({wechat:MAIN_SITE_WECHAT})
    expect(await svc({channel:'aigw',dealer:'wen'},{slug:'wen',brand:'文',contact:'rjz665',enabled:true}).s.contactFor('u')).toEqual({wechat:'rjz665',brand:'文'})
    expect(await svc({channel:'aigw',dealer:'wen'},{slug:'wen',brand:'文',contact:'rjz665',enabled:false}).s.contactFor('u')).toEqual({wechat:MAIN_SITE_WECHAT})
  })
})

// 入账与归属审计的测试在 dealer-ledger.test.ts
describe('commission ledger in the payment transaction',()=>{
  it('refund voids by the same source and never throws',async()=>{
    const ok=fakeDb(()=>({}))
    await voidDealerCommissionInTx(ok.db,'group-1','重复付款')
    const upd=ok.calls[1]
    expect(upd?.text).toMatch(/SET status='void'/)
    expect(upd?.params).toEqual(['group-1','重复付款'])
    const bad=fakeDb(q=>q.text.startsWith('UPDATE')?new Error('boom'):{})
    const err=vi.spyOn(console,'error').mockImplementation(()=>{})
    await expect(voidDealerCommissionInTx(bad.db,'g','r')).resolves.toBeUndefined()
    expect(bad.calls.at(-1)?.text).toBe('ROLLBACK TO SAVEPOINT dealer_void')
    err.mockRestore()
  })
})

describe('nodeHttpGet',()=>{
  it('sends the Host header (Node fetch would drop it) and parses JSON',async()=>{
    const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({host:req.headers.host}))})
    await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
    try{
      const port=(server.address() as AddressInfo).port
      const r=await nodeHttpGet(`http://127.0.0.1:${port}/api/public/dealers/wen`,{host:'ai.zygskins.cn'},3000)
      expect(r).toEqual({status:200,body:{host:'ai.zygskins.cn'}})
    }finally{server.close()}
  })
})
