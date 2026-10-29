import { describe, expect, it } from 'vitest'
import { createNotify } from './notify.js'
import { createNotifyEvents } from './notify-events.js'

const fakePool = (rows: unknown[]) => {
  const calls: { text: string; values: unknown[] | undefined }[] = []
  const pool = {
    calls,
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values })
      return { rows }
    },
  }
  return pool
}
const log = { warn: () => {} }

describe('notify：老客户端 /v1/announcements 从 notice 派生', () => {
  it('迁移来的公告还原老类型 / 摘要 / 版本号', async () => {
    const published = new Date('2026-10-01T00:00:00Z')
    const pool = fakePool([
      { id: 'ann-1', kind: 'event', title: 'v1.9.0', body: '正文\n第二行', pinned: true, meta: { summary: '摘要', version: '1.9.0', legacyType: 'release' }, published_at: published, start_at: null, end_at: null },
      { id: 'n-2', kind: 'maintenance', title: '维护', body: '今晚维护\n细节', pinned: false, meta: {}, published_at: null, start_at: null, end_at: null },
    ])
    const n = createNotify(pool as never, { log })
    const items = await n.legacyAnnouncements()
    expect(items[0]).toMatchObject({ id: 'ann-1', type: 'release', summary: '摘要', version: '1.9.0', pinned: true, publishedAt: published.toISOString() })
    // 后台新发的通知：类型按 kind 映射，摘要取正文第一行
    expect(items[1]).toMatchObject({ type: 'maintenance', summary: '今晚维护', version: '', publishedAt: null })
    expect(pool.calls[0]!.text).toContain("audience_type='all'")
  })
})

describe('notify-events：会员到账', () => {
  it('整组付清才发，幂等键按组', async () => {
    const pool = fakePool([{ user_id: 'u1', plan_name: '月卡', group_key: 'g-1', lifetime: false, expires_at: new Date('2026-11-30T00:00:00Z') }])
    const sent: unknown[] = []
    const notify = { send: async (x: unknown) => void sent.push(x), tongzhi: {} } as never
    await createNotifyEvents(pool as never, notify).membershipPaid('PS-1')
    expect(sent).toEqual([expect.objectContaining({ userId: 'u1', kind: 'reward', idemKey: 'paid:g-1' })])
  })
  it('订单没付清（查不到）就不发', async () => {
    const sent: unknown[] = []
    const notify = { send: async (x: unknown) => void sent.push(x), tongzhi: {} } as never
    await createNotifyEvents(fakePool([]) as never, notify).membershipPaid('PS-2')
    expect(sent).toEqual([])
  })
})
