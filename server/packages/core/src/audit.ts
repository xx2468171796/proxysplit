// 审计行的唯一写入点。动钱 / 动会员的操作（退款、手动确认订单、发放 / 续期会员、代理商结算与改比例）
// 把它放在业务事务里、COMMIT 之前调：业务和审计要么都成、要么都不成。其它操作经 PgStore.audit 用连接池写。
export type AuditRow = {
  actor: string | null; action: string; targetType: string; targetId: string; ip: string; result: string
  metadata?: Record<string, unknown>
}
/** 谁、从哪儿发起的（路由给）；动作名与明细由各业务函数自己定。 */
export type AuditActor = { actor: string | null; ip: string }
type AuditDb = { query(text: string, params?: unknown[]): Promise<unknown> }

export async function insertAudit(db: AuditDb, a: AuditRow): Promise<void> {
  await db.query('INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,ip,result,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [a.actor, a.action, a.targetType, a.targetId, a.ip, a.result, a.metadata ?? {}])
}
