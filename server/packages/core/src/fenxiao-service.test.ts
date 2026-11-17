// 分销里动钱的后台 / 用户操作：记账与 audit_logs 同一个事务；推广人欠款时提现不能标「已打款」。
// 原来：包自己开事务记账并提交 → 路由再用另一条连接写审计（审计失败时钱已经动了、接口却回 500）；
// 提现审核不看账户余额，退款冲回后余额为负的人照样能被打款。
import { describe, expect, it } from 'vitest'
import { FenxiaoService } from './fenxiao-service.js'
import type { PgStore } from './store.js'

type Call = { sql: string; params: unknown[]; conn: 'pool' | 'tx' }
type Io = { tx?: { query: unknown }; afterCommit?: (send: () => Promise<void>) => void }
const by = { actor: 'admin-1', ip: '1.2.3.4' }
const withdrawal = { id: 7n, userId: 'u1', amount: 10000n, fee: 0n, net: 10000n, status: 'paid', payee: { method: 'alipay', account: 'a', name: 'n' }, adminNote: null, createdAt: new Date(), reviewedAt: new Date() }
const commission = { id: 9n, sourceKind: 'adjust', sourceRef: 'adj-1', buyerUserId: 'u1', beneficiaryUserId: 'u1', level: 0, baseAmount: 0n, rateBps: 0, amount: -500n, status: 'available', availableAt: new Date(), holdReason: null, note: 'x', reversedAt: null, reverseReason: null, createdAt: new Date() }

function setup(opts: { available?: string; failAudit?: boolean } = {}) {
  const calls: Call[] = []
  const events: string[] = []
  const run = (conn: Call['conn']) => async (text: string, params: unknown[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim()
    calls.push({ sql, params, conn })
    if (conn === 'tx' && /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) events.push(sql)
    if (sql.startsWith('INSERT INTO audit_logs')) { if (opts.failAudit) throw new Error('audit insert failed'); events.push('AUDIT') }
    if (sql.startsWith('SELECT user_id FROM fx_withdrawals')) return { rows: [{ user_id: 'u1' }], rowCount: 1 }
    if (sql.includes('FROM fx_accounts')) return { rows: opts.available === undefined ? [] : [{ user_id: 'u1', available: opts.available }], rowCount: 1 }
    if (sql.includes('FROM users')) return { rows: [{ id: 'u1', username: 'alice' }], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  }
  const txQuery = run('tx')
  const pool = { query: run('pool'), connect: async () => ({ query: txQuery, release() {} }) }
  // 包的记账函数：必须拿到宿主事务（io.tx），在上面写一条能认出来的 SQL
  const ledger = <T>(name: string, result: T) => async (input: Io) => {
    if (!input.tx) throw new Error(`${name} ran outside the host transaction`)
    await (input.tx as { query: typeof txQuery }).query(`LEDGER ${name}`)
    events.push(name)
    input.afterCommit?.(async () => { events.push(`notify:${name}`) })
    return result
  }
  const fx = {
    tables: { withdrawals: 'fx_withdrawals', accounts: 'fx_accounts' },
    reviewWithdrawal: ledger('reviewWithdrawal', withdrawal), adjust: ledger('adjust', commission),
    reviewCommission: ledger('reviewCommission', commission), requestWithdrawal: ledger('requestWithdrawal', { ...withdrawal, status: 'pending' }),
    listWithdrawals: async () => ({ items: [{ ...withdrawal, status: 'pending' }, { ...withdrawal, id: 8n, userId: 'u2', status: 'pending' }], total: 2, limit: 20, offset: 0 }),
  }
  const service = new FenxiaoService({ pool, fx } as unknown as PgStore)
  return { service, calls, events }
}

describe('分销：动钱操作与审计同事务', () => {
  it('提现标已打款：记账和审计在同一条连接、COMMIT 之前；通知在提交之后才发', async () => {
    const t = setup({ available: '0' })
    expect(await t.service.review('7', 'paid', by)).toMatchObject({ id: '7', amountCents: 10000 })
    expect(t.events).toEqual(['BEGIN', 'reviewWithdrawal', 'AUDIT', 'COMMIT', 'notify:reviewWithdrawal'])
    const audit = t.calls.find(c => c.sql.startsWith('INSERT INTO audit_logs'))
    expect(audit?.conn).toBe('tx')
    expect(audit?.params).toEqual(['admin-1', 'admin.fenxiao.withdrawal', 'fx-withdrawal', '7', '1.2.3.4', 'success', { action: 'paid', amountCents: 10000 }])
  })

  it('审计写不进去：整体回滚、抛错，通知不发', async () => {
    const t = setup({ available: '0', failAudit: true })
    await expect(t.service.review('7', 'paid', by)).rejects.toThrow('audit insert failed')
    expect(t.events).toEqual(['BEGIN', 'reviewWithdrawal', 'ROLLBACK'])
  })

  it('推广人欠款（可提现余额为负）：标已打款被拒，提示里有欠多少、该怎么办；驳回照常', async () => {
    const t = setup({ available: '-5000' })
    await expect(t.service.review('7', 'paid', by)).rejects.toMatchObject({ code: 'FX_BENEFICIARY_IN_DEBT', status: 409, message: expect.stringContaining('¥50.00'), extra: { debtCents: 5000 } })
    expect(t.events).toEqual(['BEGIN', 'ROLLBACK'])
    // 余额那一行是在事务里加锁读的（和随后的记账同一条连接），不是事务外先看一眼
    expect(t.calls.filter(c => c.sql.includes('FOR UPDATE')).map(c => c.conn)).toEqual(['tx', 'tx'])
    const reject = setup({ available: '-5000' })
    await reject.service.review('7', 'rejected', by, '有退款')
    expect(reject.events).toEqual(['BEGIN', 'reviewWithdrawal', 'AUDIT', 'COMMIT', 'notify:reviewWithdrawal'])
  })

  it('没有账户行 = 不欠，可以打款', async () => {
    const t = setup()
    await t.service.review('7', 'paid', by)
    expect(t.events).toContain('COMMIT')
  })

  it('调账、佣金复核、申请提现同样同事务', async () => {
    const adjust = setup()
    await adjust.service.adjust('alice', -500, '扣回', by)
    expect(adjust.events).toEqual(['BEGIN', 'adjust', 'AUDIT', 'COMMIT', 'notify:adjust'])
    expect(adjust.calls.find(c => c.sql.startsWith('INSERT INTO audit_logs'))?.params).toEqual(['admin-1', 'admin.fenxiao.adjust', 'user', 'u1', '1.2.3.4', 'success', { amountCents: -500, reason: '扣回' }])
    const review = setup()
    await review.service.reviewCommission('9', 'void', by, '刷单')
    expect(review.events.slice(0, 4)).toEqual(['BEGIN', 'reviewCommission', 'AUDIT', 'COMMIT'])
    const request = setup()
    await request.service.withdraw('u1', { amountCents: 10000, method: 'alipay', account: 'a', name: 'n' }, '5.6.7.8')
    expect(request.events.slice(0, 4)).toEqual(['BEGIN', 'requestWithdrawal', 'AUDIT', 'COMMIT'])
    expect(request.calls.find(c => c.sql.startsWith('INSERT INTO audit_logs'))?.params.slice(0, 5)).toEqual(['u1', 'fenxiao.withdraw.request', 'fx-withdrawal', '7', '5.6.7.8'])
  })

  it('提现列表每行带申请人的净欠款', async () => {
    const t = setup({ available: '-1234' })
    const page = await t.service.listWithdrawals({ limit: 20, offset: 0 })
    expect(page.items.map(w => [w.id, w.debtCents])).toEqual([['7', 1234], ['8', 0]])
  })
})
