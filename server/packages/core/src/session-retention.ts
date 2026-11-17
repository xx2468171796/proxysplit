// 会话表保留期清理。每次刷新令牌都会往 sessions 插一行（旧行标 consumed），以前从不删，表只增不减。
// 哪些行可以删而不削弱安全性：
//   - 已过期超过 1 天：令牌本身的 JWT 已过期，验签那一步就拒了，行没用了；
//   - 已吊销 / 已消费超过 retentionDays 天：重放检测（旧令牌再次出现 → 吊销整个 family）针对的是
//     「令牌刚被偷、两边抢着用」的窗口，按分钟计；这么久以前的旧令牌再出现时查不到行，照样回 401。
// 每个设备当前在用的那一行（没消费、没吊销、没过期）永远不会被删。
export type RetentionDb = { query: (sql: string, params?: unknown[]) => Promise<{ rowCount?: number | null }> }

export const SESSION_RETENTION_DAYS = 7

export async function purgeSessions(db: RetentionDb, opts: { retentionDays?: number; batchSize?: number; maxBatches?: number; now?: Date } = {}) {
  const batchSize = opts.batchSize ?? 5000, maxBatches = opts.maxBatches ?? 20
  const now = (opts.now ?? new Date()).getTime()
  const expiredBefore = new Date(now - 86_400_000).toISOString()
  const staleBefore = new Date(now - (opts.retentionDays ?? SESSION_RETENTION_DAYS) * 86_400_000).toISOString()
  let sessions = 0
  for (let i = 0; i < maxBatches; i++) {
    const r = await db.query(`DELETE FROM sessions WHERE id IN (SELECT id FROM sessions
      WHERE expires_at<$1 OR revoked_at<$2 OR consumed_at<$2 LIMIT $3)`, [expiredBefore, staleBefore, batchSize])
    sessions += r.rowCount ?? 0
    if ((r.rowCount ?? 0) < batchSize) break
  }
  return { sessions }
}
