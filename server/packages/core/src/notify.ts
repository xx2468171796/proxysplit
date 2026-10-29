// 站内通知 / 公告：公司统一通知包 tongzhi（vendor 在 ./vendor/tongzhi，tag 见其 VERSION）。
// 一份模型装公告 + 站内信；业务发消息一律走 notify.send（带 idemKey，事务提交之后调）。
// 老客户端（≤1.11）还读 /v1/announcements：legacyAnnouncements() 从 notice 派生出老形状。
import type { createDatabase } from '@proxysplit/db'
import {
  createSqlPgTongzhiStore,
  createTongzhi,
  createTongzhiAiControl,
  createTongzhiHttpHandlers,
  type SendInput,
} from './vendor/tongzhi/index.js'

export type LegacyAnnouncement = {
  id: string
  type: 'notice' | 'maintenance' | 'release'
  title: string
  summary: string
  content: string
  version: string
  pinned: boolean
  publishedAt: string | null
  startsAt: string | null
  endsAt: string | null
}

const LEGACY_TYPE: Record<string, LegacyAnnouncement['type']> = { maintenance: 'maintenance', event: 'release' }

type Logger = { warn: (msg: string, detail?: unknown) => void }
/** 后台 / AI 的通知操作记进审计日志（业务自动发的 system 消息不记，免得刷屏） */
type Audit = (
  actor: string | null,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown>,
) => Promise<unknown>
const UUID = /^[0-9a-f-]{36}$/i

type Pool = ReturnType<typeof createDatabase>['pool']
type NoticeRow = {
  id: string
  kind: string
  title: string
  body: string
  pinned: boolean
  meta: { summary?: string; version?: string; legacyType?: LegacyAnnouncement['type'] } | null
  published_at: Date | null
  start_at: Date | null
  end_at: Date | null
}

export function createNotify(pool: Pool, opts: { aiToken?: string | undefined; log: Logger; audit?: Audit }) {
  const db = { query: (text: string, values?: unknown[]) => pool.query(text, values) }
  const tongzhi = createTongzhi({
    store: createSqlPgTongzhiStore({ db, onWarn: (msg, d) => opts.log.warn(`tongzhi: ${msg}`, d) }),
    countAudience: async (a) =>
      a.type === 'all' ? Number((await pool.query("SELECT count(*) FROM users WHERE status='active'")).rows[0].count) : null,
    onEvent: async (e) => {
      if (!opts.audit || e.actor.id === 'system') return
      const target = 'notice' in e ? e.notice.id : 'noticeId' in e ? e.noticeId : 'batchId' in e ? e.batchId : ''
      const actor = UUID.test(e.actor.id) ? e.actor.id : null
      await opts.audit(actor, `admin.notice.${e.type}`, 'notice', target, { actor: e.actor.id, source: e.actor.source ?? '' })
    },
  })
  const http = createTongzhiHttpHandlers({ tongzhi, version: 'proxysplit-tongzhi' })
  const ai = createTongzhiAiControl({ token: opts.aiToken })

  /** 业务定向消息：失败只记日志，不影响主流程（调用方在事务提交之后调）。 */
  async function send(input: SendInput): Promise<void> {
    try {
      await tongzhi.send(input)
    } catch (e) {
      opts.log.warn('tongzhi send failed', { idemKey: input.idemKey, err: String(e) })
    }
  }

  /** 老客户端的 /v1/announcements：全员、已发布、在时间窗内的通知，还原成老字段。 */
  async function legacyAnnouncements(limit = 200): Promise<LegacyAnnouncement[]> {
    const r = await pool.query<NoticeRow>(
      `SELECT id,kind,title,body,pinned,meta,published_at,start_at,end_at FROM notice
       WHERE status='published' AND audience_type='all'
         AND (start_at IS NULL OR start_at<=now()) AND (end_at IS NULL OR end_at>now())
       ORDER BY pinned DESC, coalesce(published_at,created_at) DESC LIMIT $1`,
      [limit],
    )
    const iso = (d: Date | null) => (d ? d.toISOString() : null)
    return r.rows.map((n) => {
      const meta = n.meta ?? {}
      return {
        id: n.id,
        type: meta.legacyType ?? LEGACY_TYPE[n.kind] ?? 'notice',
        title: n.title,
        summary: meta.summary ?? String(n.body).split('\n')[0]?.slice(0, 200) ?? '',
        content: n.body,
        version: meta.version ?? '',
        pinned: n.pinned,
        publishedAt: iso(n.published_at),
        startsAt: iso(n.start_at),
        endsAt: iso(n.end_at),
      }
    })
  }

  return { tongzhi, http, ai, send, legacyAnnouncements }
}

export type Notify = ReturnType<typeof createNotify>
