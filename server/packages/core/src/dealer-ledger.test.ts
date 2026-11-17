// 代理商：客户归属（付过款不归属 + 审计）与分成入账（停用不记、可疑进待复核）。
import { describe, expect, it, vi } from 'vitest'
import { DealerService, recordDealerCommissionInTx, type DealerHttpGet } from './dealer.js'
import { ipHash } from './trial.js'

type Q = { text: string; params: unknown[] }
type Reply = { rows?: unknown[]; rowCount?: number } | Error
function fakeDb(handler: (q: Q) => Reply) {
  const calls: Q[] = []
  const query = async (text: string, params: unknown[] = []) => {
    const q = { text, params }
    calls.push(q)
    const r = handler(q)
    if (r instanceof Error) throw r
    return { rows: r.rows ?? [], rowCount: r.rowCount ?? r.rows?.length ?? 0 }
  }
  // 归属要开事务：connect() 给回同一个假库（BEGIN / COMMIT 也记进 calls）
  return { db: { query, connect: async () => ({ query, release: () => {} }) }, calls }
}
const down: DealerHttpGet = async () => ({ status: 500, body: null })
const firstWords = (calls: Q[]) => calls.map(c => c.text.split(/\s/)[0])

describe('客户归属', () => {
  const svc = (o: { attributed?: number; auditFails?: boolean } = {}) => {
    const { db, calls } = fakeDb(q => {
      if (q.text.startsWith('SELECT slug')) return { rows: [{ slug: 'wen', brand: '', contact: 'rjz665', enabled: true, fetchedAt: new Date() }] }
      if (q.text.startsWith('UPDATE users')) return { rowCount: o.attributed ?? 1 }
      if (q.text.startsWith('INSERT INTO audit_logs') && o.auditFails) return new Error('audit down')
      return {}
    })
    return { s: new DealerService(db, { baseUrl: 'http://x', get: down }), calls }
  }
  it('付过款的账号不归属（条件在 SQL 里）；归属成功同事务写审计：谁、归给谁、来源摘要、设备摘要', async () => {
    const ok = svc()
    expect(await ok.s.attribute('u1', 'wen', { ip: '203.0.113.9', deviceHash: 'dev-hash' })).toBe(true)
    expect(ok.calls.find(c => c.text.startsWith('UPDATE users'))?.text)
      .toContain('NOT EXISTS(SELECT 1 FROM orders o WHERE o.user_id=users.id AND o.paid_at IS NOT NULL)')
    const words = firstWords(ok.calls)
    expect(words.slice(words.indexOf('BEGIN'))).toEqual(['BEGIN', 'UPDATE', 'INSERT', 'COMMIT'])
    const audit = ok.calls.find(c => c.text.startsWith('INSERT INTO audit_logs'))
    expect(audit?.params.slice(0, 6)).toEqual(['u1', 'dealer.attribute', 'user', 'u1', '203.0.113.9', 'success'])
    expect(audit?.params[6]).toEqual({ dealer: 'wen', ipHash: ipHash('203.0.113.9'), deviceHash: 'dev-hash' })
  })
  it('没归属成（已归属 / 付过款 / 不是 aigw / 超过 7 天）：不写审计', async () => {
    const no = svc({ attributed: 0 })
    expect(await no.s.attribute('u1', 'wen', { ip: '203.0.113.9' })).toBe(false)
    expect(no.calls.some(c => c.text.startsWith('INSERT INTO audit_logs'))).toBe(false)
  })
  it('审计写不进去：归属也不落库（回滚），不抛错（不挡登录）', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bad = svc({ auditFails: true })
    expect(await bad.s.attribute('u1', 'wen')).toBe(false)
    expect(bad.calls.at(-1)?.text).toBe('ROLLBACK')
    err.mockRestore()
  })
})

describe('分成入账（recordDealerCommissionInTx）', () => {
  const order = { userId: 'buyer', ref: 'order-1', gross: 9900, slug: 'wen', enabled: true, bps: 3000, owners: ['owner-1'] }
  /** 发货事务里的假连接：订单 / 代理商那一行 + 可疑度那一行。 */
  const ledger = (o: Record<string, unknown> | undefined, suspicion = { own: false, cluster: 0 }) => fakeDb(q => {
    if (q.text.startsWith('SELECT u.id')) return { rows: o ? [o] : [] }
    if (q.text.includes('AS cluster')) return { rows: [suspicion] }
    return {}
  })
  const inserted = (calls: Q[]) => calls.find(c => c.text.startsWith('INSERT INTO dealer_commissions'))

  it('正常订单：一行 pending，比例快照，来源唯一，全程在保存点里', async () => {
    const { db, calls } = ledger(order)
    await recordDealerCommissionInTx(db, 'order-1')
    expect(firstWords(calls)).toEqual(['SAVEPOINT', 'SELECT', 'SELECT', 'INSERT', 'RELEASE'])
    expect(calls[1]?.text).toContain('coalesce(o.group_id::text,o.id::text)')
    expect(calls[1]?.params).toEqual(['order-1'])
    expect(inserted(calls)?.text).toContain('ON CONFLICT (source) DO NOTHING')
    expect(inserted(calls)?.params).toEqual(['wen', 'buyer', 'order-1', 9900, 3000, 2970, 'pending', ''])
  })
  it('买家没有归属代理商、或实付为 0：不记', async () => {
    for (const o of [undefined, { ...order, gross: 0 }]) {
      const { db, calls } = ledger(o)
      await recordDealerCommissionInTx(db, 'order-1')
      expect(inserted(calls)).toBeUndefined()
      expect(calls.at(-1)?.text).toBe('RELEASE SAVEPOINT dealer_commission')
    }
  })
  // dealers.enabled 是 aigw 接口的缓存，对面一次 404 就会翻成停用：直接不记的话真分成会悄悄丢，所以记成待复核、让后台定。
  it('代理商是停用状态：照记一行，但进待复核（不进应付），备注写明原因', async () => {
    const { db, calls } = ledger({ ...order, enabled: false })
    await recordDealerCommissionInTx(db, 'order-1')
    expect(inserted(calls)?.params).toEqual(['wen', 'buyer', 'order-1', 9900, 3000, 2970, 'review', '待复核：下单时代理商是停用状态'])
  })
  it('买家与代理商本人的账号同设备 / 同注册来源：记成待复核（不进应付）', async () => {
    const { db, calls } = ledger(order, { own: true, cluster: 0 })
    await recordDealerCommissionInTx(db, 'order-1')
    expect(inserted(calls)?.params.slice(6)).toEqual(['review', '待复核：与代理商本人的账号同设备或同注册来源'])
    const check = calls[2]
    expect(check?.params).toEqual(['buyer', 'wen', ['owner-1']])
    expect(check?.text).toContain('s.registration_ip_hash=b.registration_ip_hash')
    expect(check?.text).toContain('y.hardware_hash=x.hardware_hash')
    expect(check?.text).toContain("interval '30 days'")
    expect(check?.text).toContain("c.user_id<>b.id AND c.status<>'void'")
  })
  it('30 天内与同一代理商另外 3 个付费客户同设备 / 同注册来源：待复核；2 个还是待结算', async () => {
    const three = ledger(order, { own: false, cluster: 3 })
    await recordDealerCommissionInTx(three.db, 'order-1')
    expect(inserted(three.calls)?.params.slice(6)).toEqual(['review', '待复核：30 天内与该代理商另外 3 个付费客户同设备或同注册来源'])
    const two = ledger(order, { own: false, cluster: 2 })
    await recordDealerCommissionInTx(two.db, 'order-1')
    expect(inserted(two.calls)?.params.slice(6)).toEqual(['pending', ''])
  })
  it('中途出错绝不挡发货：回滚到保存点，只记日志', async () => {
    const { db, calls } = fakeDb(q => (q.text.startsWith('SELECT u.id') ? new Error('boom') : {}))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(recordDealerCommissionInTx(db, 'order-1')).resolves.toBeUndefined()
    expect(calls.at(-1)?.text).toBe('ROLLBACK TO SAVEPOINT dealer_commission')
    err.mockRestore()
  })
})
