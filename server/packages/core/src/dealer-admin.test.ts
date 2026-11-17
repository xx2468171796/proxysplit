// 后台「代理商分成」流水的合计：按状态分开给，应付 = 只算待结算。
import { describe, expect, it } from 'vitest'
import { DealerAdmin } from './dealer-admin.js'

type Row = { status: 'pending' | 'settled' | 'void'; gross: number; commission: number }
/** 只实现合计那条 SQL 用到的 FILTER 语义的假库。 */
function fakeDb(rows: Row[]) {
  const sqls: string[] = []
  const of = (status: string, key: 'gross' | 'commission') => rows.filter(r => r.status === status).reduce((a, r) => a + r[key], 0)
  const db = {
    async query(text: string) {
      sqls.push(text.replace(/\s+/g, ' '))
      if (text.includes('count(*)')) {
        return { rowCount: 1, rows: [{
          n: rows.length, pending: of('pending', 'commission'), settled: of('settled', 'commission'), void: of('void', 'commission'),
          gross: of('pending', 'gross') + of('settled', 'gross'),
        }] }
      }
      return { rows: [], rowCount: 0 }
    },
  }
  return { db, sqls }
}

describe('代理商分成流水合计', () => {
  it('按状态分开合计，应付只算待结算（原来一个数把已结算、已作废都加了进去）', async () => {
    const { db, sqls } = fakeDb([
      { status: 'pending', gross: 10000, commission: 3000 }, { status: 'pending', gross: 5000, commission: 1500 },
      { status: 'settled', gross: 20000, commission: 6000 }, { status: 'void', gross: 9900, commission: 2970 },
    ])
    const r = await new DealerAdmin(db).commissions({ limit: 20, offset: 0 })
    expect(r).toMatchObject({ total: 4, payableCents: 4500, sums: { pendingCents: 4500, settledCents: 6000, voidCents: 2970 }, grossCents: 35000 })
    expect(r).not.toHaveProperty('commissionCents')
    expect(r).not.toHaveProperty('amountSumCents')
    expect(sqls[0]).toContain("FILTER (WHERE c.status='pending')")
    expect(sqls[0]).toContain("FILTER (WHERE c.status='settled')")
    expect(sqls[0]).toContain("FILTER (WHERE c.status='void')")
    expect(sqls[0]).toContain("sum(c.gross_cents) FILTER (WHERE c.status<>'void')")
  })
})
