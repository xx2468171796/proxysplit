// 动钱 / 动会员的后台操作：审计行和业务改动在同一个事务里（同一条连接、COMMIT 之前），审计写不进去就整体回滚。
// 原来是「业务提交 → 路由再用另一条连接写审计」：审计失败时钱已经动了却没有记录，接口还回 500 诱导重复操作。
import { describe, expect, it } from 'vitest'
import { DealerAdmin } from './dealer-admin.js'
import { PgStore } from './store.js'

type Call = { sql: string; params: unknown[]; conn: 'pool' | 'tx' }
type Reply = Array<Record<string, unknown>>
/** 按 SQL 片段给结果的假库；failAudit = 审计 INSERT 抛错。 */
function fakePool(replies: Array<[string, Reply]>, opts: { failAudit?: boolean } = {}) {
  const calls: Call[] = []
  const run = (conn: Call['conn']) => async (text: string, params: unknown[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim()
    calls.push({ sql, params, conn })
    if (opts.failAudit && sql.startsWith('INSERT INTO audit_logs')) throw new Error('audit insert failed')
    const rows = replies.find(([needle]) => sql.includes(needle))?.[1] ?? []
    return { rows, rowCount: rows.length }
  }
  const pool = { query: run('pool'), connect: async () => ({ query: run('tx'), release() {} }) }
  const verbs = () => calls.filter(c => c.conn === 'tx').map(c => (/^(BEGIN|COMMIT|ROLLBACK)$/.test(c.sql) ? c.sql : c.sql.startsWith('INSERT INTO audit_logs') ? 'AUDIT' : '·')).filter(v => v !== '·')
  const audit = () => calls.find(c => c.sql.startsWith('INSERT INTO audit_logs'))
  return { pool, calls, verbs, audit }
}
function storeOn(f: ReturnType<typeof fakePool>) {
  const store = Object.create(PgStore.prototype) as PgStore
  Object.assign(store, { pool: f.pool, fx: { reverse: async () => undefined, settle: async () => undefined } })
  return store
}
const by = { actor: 'admin-1', ip: '1.2.3.4' }
const paidOrder: Reply = [{ id: 'o1', order_no: 'PS1', user_id: 'u1', plan_id: 'p1', tier: 'premium', status: 'paid', group_id: null, provider_code: 'zhifu-center', provider_order_no: 'PR1', duration_days: 30, lifetime: false }]

describe('动钱操作的审计与业务同事务', () => {
  it('退款：审计在 COMMIT 之前、同一条连接上；带上退款原因与结果', async () => {
    const f = fakePool([['FROM orders WHERE order_no=$1 FOR UPDATE', paidOrder]])
    const r = await storeOn(f).refundOrder('PS1', '客户申请', { ...by, action: 'admin.order.refund' })
    expect(r).toMatchObject({ ok: true, orders: 1, licenseAdjusted: false })
    expect(f.verbs()).toEqual(['BEGIN', 'AUDIT', 'COMMIT'])
    expect(f.audit()?.conn).toBe('tx')
    expect(f.audit()?.params).toEqual(['admin-1', 'admin.order.refund', 'order', 'PS1', '1.2.3.4', 'success', { reason: '客户申请', orders: 1, licenseAdjusted: false, removedDays: null }])
  })

  it('退款：审计写不进去 → 整体回滚、抛错，订单没被标成已退', async () => {
    const f = fakePool([['FROM orders WHERE order_no=$1 FOR UPDATE', paidOrder]], { failAudit: true })
    await expect(storeOn(f).refundOrder('PS1', '客户申请', { ...by, action: 'admin.order.refund' })).rejects.toThrow('audit insert failed')
    expect(f.verbs()).toEqual(['BEGIN', 'AUDIT', 'ROLLBACK'])
  })

  it('手动确认订单：发放与审计同事务；已付的重复确认也留一行审计', async () => {
    const pending: Reply = [{ ...paidOrder[0], status: 'pending' }]
    const f = fakePool([['SELECT * FROM orders WHERE order_no=$1 FOR UPDATE', pending], ['FROM plans WHERE id=$1', [{ id: 'p1', tier: 'premium', duration_days: 30, lifetime: false }]], ['INSERT INTO licenses', [{ id: 'lic1' }]]])
    const r = await storeOn(f).confirmOrderManually('PS1', by)
    expect(r).toMatchObject({ ok: true, duplicate: false })
    expect(f.verbs()).toEqual(['BEGIN', 'AUDIT', 'COMMIT'])
    expect(f.audit()?.params.slice(0, 7)).toEqual(['admin-1', 'admin.order.confirm', 'order', 'PS1', '1.2.3.4', 'success', { duplicate: false }])
    const dup = fakePool([['SELECT * FROM orders WHERE order_no=$1 FOR UPDATE', paidOrder]])
    expect(await storeOn(dup).confirmOrderManually('PS1', by)).toMatchObject({ duplicate: true })
    expect(dup.verbs()).toEqual(['BEGIN', 'AUDIT', 'COMMIT'])
    expect(dup.audit()?.params[6]).toEqual({ duplicate: true })
  })

  it('后台发放 / 续期会员：同事务写审计；续期没有可续的授权时不写', async () => {
    const grant = fakePool([['SELECT id FROM users WHERE id=$1', [{ id: 'u1' }]], ['FROM plans WHERE id=$1', [{ id: 'p1', tier: 'premium', duration_days: 30, lifetime: false }]], ['INSERT INTO licenses', [{ id: 'lic1' }]]])
    await storeOn(grant).adminGrantLicense('u1', { planId: 'p1', durationDays: 30, lifetime: false }, by)
    expect(grant.verbs()).toEqual(['BEGIN', 'AUDIT', 'COMMIT'])
    expect(grant.audit()?.params).toEqual(['admin-1', 'admin.license.grant', 'user', 'u1', '1.2.3.4', 'success', { planId: 'p1', lifetime: false, durationDays: 30 }])
    const extend = fakePool([['UPDATE licenses SET expires_at', [{ id: 'lic1', expiresAt: new Date('2027-01-01T00:00:00Z') }]]])
    expect(await storeOn(extend).extendLicense('u1', 30, by)).toMatchObject({ id: 'lic1' })
    expect(extend.verbs()).toEqual(['BEGIN', 'AUDIT', 'COMMIT'])
    expect(extend.audit()?.params.slice(1, 4)).toEqual(['admin.license.extend', 'user', 'u1'])
    const none = fakePool([])
    expect(await storeOn(none).extendLicense('u1', 30, by)).toBeNull()
    expect(none.verbs()).toEqual(['BEGIN', 'ROLLBACK'])
  })

  // 支付中心全额退款、本地却还没发放：关单 + 占住付款事件号（迟到的付款回调按重复处理）+ 审计，同一事务、只做一次。
  it('中心已退款的未发放订单：关单、占事件号、审计同事务；已经处理过的不再写审计', async () => {
    const input = { eventId: 'center:PR1', reason: '支付中心退款（未发放）', metadata: { refundNo: 'RF1' } }
    const row = (status: string): Reply => [{ id: 'o1', status, provider_code: 'zhifu-center' }]
    const fresh = fakePool([['FROM orders WHERE order_no=$1 FOR UPDATE', row('failed')], ['INSERT INTO payment_events', [{ id: 'e1' }]], ["UPDATE orders SET status='closed'", [{ id: 'o1' }]]])
    expect(await storeOn(fresh).closeRefundedUnpaidOrder('PS1', input)).toBe('closed')
    expect(fresh.verbs()).toEqual(['BEGIN', 'AUDIT', 'COMMIT'])
    expect(fresh.calls.find(c => c.sql.startsWith('INSERT INTO payment_events'))?.params).toEqual(['zhifu-center', 'center:PR1', 'PS1'])
    expect(fresh.audit()?.params).toEqual([null, 'payment.center.refund', 'order', 'PS1', '', 'unfulfilled', { refundNo: 'RF1', reason: '支付中心退款（未发放）' }])
    // 重复的退款回调：事件号已占、订单已关 → 不再写审计
    const again = fakePool([['FROM orders WHERE order_no=$1 FOR UPDATE', row('closed')]])
    expect(await storeOn(again).closeRefundedUnpaidOrder('PS1', input)).toBe('closed')
    expect(again.verbs()).toEqual(['BEGIN', 'COMMIT'])
    // 付款抢先落地：什么都不改，交回调用方走正常退款
    const paid = fakePool([['FROM orders WHERE order_no=$1 FOR UPDATE', row('paid')]])
    expect(await storeOn(paid).closeRefundedUnpaidOrder('PS1', input)).toBe('paid')
    expect(paid.verbs()).toEqual(['BEGIN', 'ROLLBACK'])
  })

  it('代理商：标记已结算 / 改分成比例与审计同事务', async () => {
    const settle = fakePool([['UPDATE dealer_commissions SET status', [{ id: 7, commissionCents: 3000, dealerSlug: 'wen' }, { id: 8, commissionCents: 1500, dealerSlug: 'wen' }]]])
    const r = await new DealerAdmin(settle.pool).settle([7, 8, 9], '转账单号 1', by)
    expect(r).toEqual({ settled: 2, ids: [7, 8], commissionCents: 4500, dealers: ['wen'] })
    expect(settle.verbs()).toEqual(['BEGIN', 'AUDIT', 'COMMIT'])
    expect(settle.audit()?.params).toEqual(['admin-1', 'admin.dealer.settle', 'dealer-commission', '7,8', '1.2.3.4', 'success', { settled: 2, ids: [7, 8], commissionCents: 4500, dealers: ['wen'], note: '转账单号 1' }])
    const bps = fakePool([['INSERT INTO dealers', [{ slug: 'wen', commissionBps: 3000 }]]], { failAudit: true })
    await expect(new DealerAdmin(bps.pool).setBps('wen', 3000, by)).rejects.toThrow('audit insert failed')
    expect(bps.verbs()).toEqual(['BEGIN', 'AUDIT', 'ROLLBACK'])
  })
})
