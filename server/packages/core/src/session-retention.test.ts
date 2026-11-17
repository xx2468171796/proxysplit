import { describe, expect, it } from 'vitest'
import { purgeSessions } from './session-retention.js'

describe('会话保留期清理', () => {
  it('分批删除：过期超过 1 天、或吊销 / 消费超过保留期的行；在用的行不在条件里', async () => {
    const counts = [5, 5, 2]
    const calls: Array<{ sql: string; params: unknown[] }> = []
    const db = { query: async (sql: string, params: unknown[] = []) => { calls.push({ sql: sql.replace(/\s+/g, ' '), params }); return { rowCount: counts.shift() ?? 0 } } }
    const res = await purgeSessions(db, { batchSize: 5, now: new Date('2026-11-18T00:00:00Z') })
    expect(res).toEqual({ sessions: 12 })
    expect(calls).toHaveLength(3)
    expect(calls[0]?.sql).toContain('expires_at<$1 OR revoked_at<$2 OR consumed_at<$2')
    expect(calls[0]?.params).toEqual(['2026-11-17T00:00:00.000Z', '2026-11-11T00:00:00.000Z', 5])
  })

  it('一轮最多 maxBatches 批，删不完下一轮接着删（不长时间占着连接）', async () => {
    let n = 0
    const res = await purgeSessions({ query: async () => { n++; return { rowCount: 10 } } }, { batchSize: 10, maxBatches: 3 })
    expect(res).toEqual({ sessions: 30 })
    expect(n).toBe(3)
  })
})
