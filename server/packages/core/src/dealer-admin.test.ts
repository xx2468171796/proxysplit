// 后台「代理商分成」流水的合计：按状态分开给，应付 = 只算待结算。
import { describe, expect, it } from 'vitest'
import { DealerAdmin } from './dealer-admin.js'

type Row = { status: 'pending' | 'settled' | 'void'; gross: number; commission: number }
/** 只实现合计那条 SQL 用到的 FILTER 语义的假库。 */
function fakeDb(rows: Row[]) {
  const sqls: string[] = []
  const of = (status: string, key: 'gross' | 'commission') => rows.filter(r => r.status === status).reduce((a, r) => a + r[key], 0)
  const db = {
    connect: async () => { throw new Error('合计是只读查询，不该开事务') },
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

// 2026-11-18：待复核（review）状态——不进应付，后台复核通过才变待结算。
describe('待复核的分成', () => {
  type Call = { text: string; params: unknown[] }
  function txDb(answer: (c: Call) => unknown[]) {
    const calls: Call[] = []
    const query = async (text: string, params: unknown[] = []) => { const c = { text, params }; calls.push(c); const rows = answer(c); return { rows, rowCount: rows.length } }
    return { db: { query, connect: async () => ({ query, release: () => {} }) }, calls }
  }
  const by = { actor: 'admin-1', ip: '203.0.113.9' }

  it('合计单列待复核，应付不含它；结算只动待结算的', async () => {
    const { db, calls } = txDb(c => (c.text.includes('count(*)') ? [{ n: 3, pending: 3000, review: 2970, settled: 0, void: 0, gross: 19900 }] : []))
    const admin = new DealerAdmin(db)
    const r = await admin.commissions({ limit: 20, offset: 0, status: 'review' })
    expect(r).toMatchObject({ payableCents: 3000, sums: { pendingCents: 3000, reviewCents: 2970 } })
    expect(calls[0]?.text).toContain("FILTER (WHERE c.status='review')")
    await admin.settle([1, 2], '', by)
    expect(calls.find(c => c.text.includes("SET status='settled'"))?.text).toContain("AND status='pending'")
  })
  it('复核通过 → 待结算，作废 → 已作废；只动待复核的，审计同事务', async () => {
    for (const [action, status] of [['approve', 'pending'], ['void', 'void']] as const) {
      const { db, calls } = txDb(c => (c.text.startsWith('UPDATE dealer_commissions') ? [{ id: 7, commissionCents: 2970, dealerSlug: 'wen' }] : []))
      const r = await new DealerAdmin(db).review([7, 8], action, '核实是不同的人', by)
      expect(r).toEqual({ action, changed: 1, ids: [7], commissionCents: 2970, dealers: ['wen'] })
      const upd = calls.find(c => c.text.startsWith('UPDATE dealer_commissions'))
      expect(upd?.text).toContain("AND status='review'")
      expect(upd?.params).toEqual([[7, 8], status, '核实是不同的人'])
      expect(calls.map(c => c.text.split(/\s/)[0])).toEqual(['BEGIN', 'UPDATE', 'INSERT', 'COMMIT'])
      const audit = calls.find(c => c.text.startsWith('INSERT INTO audit_logs'))
      expect(audit?.params.slice(0, 3)).toEqual(['admin-1', 'admin.dealer.review', 'dealer-commission'])
    }
    await expect(new DealerAdmin(txDb(() => []).db).review([], 'approve', '', by)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })
  it('设代理商本人的账号：用户名换成账号 id；有不存在的用户名整体拒绝、不落库', async () => {
    const ok = txDb(c => (c.text.startsWith('SELECT id,username') ? [{ id: 'id-a', username: 'wen_boss' }] : c.text.startsWith('UPDATE dealers') ? [{ slug: 'wen' }] : []))
    expect(await new DealerAdmin(ok.db).setOwners('wen', [' Wen_Boss '], by)).toEqual({ slug: 'wen', ownerUsernames: ['wen_boss'] })
    expect(ok.calls.find(c => c.text.startsWith('UPDATE dealers'))?.params).toEqual(['wen', ['id-a']])
    expect(ok.calls.find(c => c.text.startsWith('INSERT INTO audit_logs'))?.params[1]).toBe('admin.dealer.owners')
    const bad = txDb(() => [])
    await expect(new DealerAdmin(bad.db).setOwners('wen', ['nobody'], by)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(bad.calls.some(c => c.text.startsWith('UPDATE dealers'))).toBe(false)
    expect(bad.calls.at(-1)?.text).toBe('ROLLBACK')
  })
})
