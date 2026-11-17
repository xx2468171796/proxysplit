// 后台「代理商分成」：代理商列表（比例可改）、分成流水（筛选 / 分页）、批量标记已结算。线下打款，系统只记账。
import type { DealerCommissionsQuery, DealerListQuery } from '@proxysplit/contracts'
import { AppError } from '@proxysplit/shared'

type Db={ query(text:string,params?:unknown[]):Promise<{rows:unknown[];rowCount:number|null}> }
export type DealerSummary={slug:string;brand:string;contact:string;enabled:boolean;commissionBps:number;fetchedAt:string|null;
  customers:number;grossCents:number;pendingCents:number;settledCents:number}
export type DealerCommissionRow={id:number;dealerSlug:string;userId:string;username:string;source:string;grossCents:number;bps:number;
  commissionCents:number;status:'pending'|'settled'|'void';createdAt:string;settledAt:string|null;note:string}

// 起止是 ISO 时间（后台把北京日的整天换算好），to 含。
const range=(q:DealerCommissionsQuery)=>{
  const conds:string[]=[];const vals:unknown[]=[]
  if(q.dealer){vals.push(q.dealer);conds.push(`c.dealer_slug=$${vals.length}`)}
  if(q.status){vals.push(q.status);conds.push(`c.status=$${vals.length}`)}
  if(q.from){vals.push(q.from);conds.push(`c.created_at>=$${vals.length}::timestamptz`)}
  if(q.to){vals.push(q.to);conds.push(`c.created_at<=$${vals.length}::timestamptz`)}
  return {where:conds.length?`WHERE ${conds.join(' AND ')}`:'',vals}
}

export class DealerAdmin{
  constructor(private db:Db){}

  async list(q:DealerListQuery){
    const total=Number(((await this.db.query('SELECT count(*)::int AS n FROM dealers')).rows[0] as {n:number}).n)
    const items=(await this.db.query(`SELECT d.slug,d.brand,d.contact,d.enabled,d.commission_bps AS "commissionBps",d.fetched_at AS "fetchedAt",
        (SELECT count(*)::int FROM users u WHERE u.dealer=d.slug) AS customers,
        coalesce(s.gross,0)::int AS "grossCents",coalesce(s.pending,0)::int AS "pendingCents",coalesce(s.settled,0)::int AS "settledCents"
      FROM dealers d
      LEFT JOIN (SELECT dealer_slug,sum(gross_cents) FILTER (WHERE status<>'void') AS gross,
          sum(commission_cents) FILTER (WHERE status='pending') AS pending,sum(commission_cents) FILTER (WHERE status='settled') AS settled
        FROM dealer_commissions GROUP BY dealer_slug) s ON s.dealer_slug=d.slug
      ORDER BY d.updated_at DESC,d.slug LIMIT $1 OFFSET $2`,[q.limit,q.offset])).rows as DealerSummary[]
    return {items,total,limit:q.limit,offset:q.offset}
  }

  /** 改比例；代理商还没出现过也能先建好（资料等首次拉取补齐）。只影响之后的订单，已记的流水保留当时快照。 */
  async setBps(slug:string,commissionBps:number){
    const r=await this.db.query(`INSERT INTO dealers(slug,commission_bps) VALUES($1,$2)
      ON CONFLICT(slug) DO UPDATE SET commission_bps=EXCLUDED.commission_bps,updated_at=now()
      RETURNING slug,commission_bps AS "commissionBps"`,[slug,commissionBps])
    return r.rows[0] as {slug:string;commissionBps:number}
  }

  async commissions(q:DealerCommissionsQuery){
    const {where,vals}=range(q)
    const sum=(await this.db.query(`SELECT count(*)::int AS n,coalesce(sum(c.gross_cents),0)::int AS gross,coalesce(sum(c.commission_cents),0)::int AS commission
      FROM dealer_commissions c ${where}`,vals)).rows[0] as {n:number;gross:number;commission:number}
    const items=(await this.db.query(`SELECT c.id::int AS id,c.dealer_slug AS "dealerSlug",c.user_id AS "userId",coalesce(u.username,'') AS username,c.source,
        c.gross_cents AS "grossCents",c.bps,c.commission_cents AS "commissionCents",c.status,c.created_at AS "createdAt",c.settled_at AS "settledAt",c.note
      FROM dealer_commissions c LEFT JOIN users u ON u.id=c.user_id ${where}
      ORDER BY c.created_at DESC,c.id DESC LIMIT $${vals.length+1} OFFSET $${vals.length+2}`,[...vals,q.limit,q.offset])).rows as DealerCommissionRow[]
    return {items,total:sum.n,grossCents:sum.gross,commissionCents:sum.commission,amountSumCents:sum.commission,limit:q.limit,offset:q.offset}
  }

  /** 批量标记已结算：只动 pending 的；返回真正改了的 id 与金额（给审计）。 */
  async settle(ids:number[],note:string){
    if(!ids.length)throw new AppError('VALIDATION_ERROR','没有选中流水',400)
    const r=await this.db.query(`UPDATE dealer_commissions SET status='settled',settled_at=now(),note=CASE WHEN $2::text='' THEN note ELSE $2::text END
      WHERE id=ANY($1::bigint[]) AND status='pending' RETURNING id::int AS id,commission_cents AS "commissionCents",dealer_slug AS "dealerSlug"`,[ids,note])
    const rows=r.rows as Array<{id:number;commissionCents:number;dealerSlug:string}>
    return {settled:rows.length,ids:rows.map(x=>x.id),commissionCents:rows.reduce((a,x)=>a+x.commissionCents,0),dealers:[...new Set(rows.map(x=>x.dealerSlug))]}
  }
}
