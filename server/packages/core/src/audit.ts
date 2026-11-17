// 审计行的唯一写入点。动钱 / 动会员的操作（退款、手动确认订单、发放 / 续期会员、代理商结算与改比例）
// 把它放在业务事务里、COMMIT 之前调：业务和审计要么都成、要么都不成。其它操作经 PgStore.audit 用连接池写。
export type AuditRow = {
  actor: string | null; action: string; targetType: string; targetId: string; ip: string; result: string
  metadata?: Record<string, unknown>
}
/** 谁、从哪儿发起的（路由给）；动作名与明细由各业务函数自己定。 */
export type AuditActor = { actor: string | null; ip: string }
type AuditDb = { query(text: string, params?: unknown[]): Promise<unknown> }
type TxQuery = (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>
export type AuditTx = { query: TxQuery }
export type AuditPool = { connect(): Promise<{ query: TxQuery; release(): void }> }
/** 业务函数交回的审计内容；操作人 / IP 由调用方的 AuditActor 给，result 默认 success。 */
export type AuditEntry = Omit<AuditRow, 'actor' | 'ip' | 'result'> & { result?: string }

/**
 * 「业务改动 + 它的审计行」同一个事务：run 在事务里做业务并交回审计内容，审计写不进去就整体回滚。
 * 自己不需要别的事务控制的动钱操作都用它（代理商结算 / 复核、分销调账 / 提现审核 / 佣金复核、兑换码）。
 */
export async function withAuditedTx<T>(pool: AuditPool, by: AuditActor, run: (tx: AuditTx) => Promise<{ result: T; audit: AuditEntry }>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { result, audit } = await run({ query: (text, params) => client.query(text, params) })
    await insertAudit(client, { result: 'success', ...audit, ...by })
    await client.query('COMMIT')
    return result
  } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e } finally { client.release() }
}

export async function insertAudit(db: AuditDb, a: AuditRow): Promise<void> {
  await db.query('INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,ip,result,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [a.actor, a.action, a.targetType, a.targetId, a.ip, a.result, a.metadata ?? {}])
}
