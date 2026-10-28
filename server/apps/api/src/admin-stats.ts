// 运营总览聚合（只读）：GET /v1/admin/stats/overview、GET /v1/admin/users/:id/cloud 的 SQL 与纯函数。
// 口径写在 docs/admin-rebuild.md「指标字典」；日切按 Asia/Shanghai，金额一律「分」并以字符串返回（bigint 安全）。
import { z } from 'zod'

export const STATS_TIME_ZONE = 'Asia/Shanghai'
const DAY_MS = 86_400_000

type Row = Record<string, unknown>
export type Queryable = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Row[] }> }

export const statsOverviewQuery = z.object({ days: z.coerce.number().int().refine((d) => d === 7 || d === 30 || d === 90, '只支持 7 / 30 / 90 天').default(30) })

/** 当前窗口 = [now − days, now)，对比窗口 = 紧挨着的前一段同样长度。 */
export function statsWindows(now: Date, days: number) {
  const curFrom = new Date(now.getTime() - days * DAY_MS)
  const prevFrom = new Date(curFrom.getTime() - days * DAY_MS)
  return { cur: { from: curFrom, to: now }, prev: { from: prevFrom, to: curFrom } }
}

/** pg 的 numeric / bigint 可能以字符串返回：统一转成十进制整数字符串，不经过浮点。 */
export function centsString(v: unknown): string {
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.trunc(v)).toString()
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return BigInt(v.trim()).toString()
  return '0'
}

export const int = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

/** 补齐窗口里没有数据的日子：缺失返回 null（图上断线），不是 0；有记录的日子照常。 */
export function fillDays<T>(rows: readonly { date: string; value: T }[], from: Date, days: number, empty: T): { date: string; value: T }[] {
  const map = new Map(rows.map((r) => [r.date, r.value]))
  const out: { date: string; value: T }[] = []
  for (let i = 0; i < days; i++) {
    const date = shanghaiDate(new Date(from.getTime() + (i + 1) * DAY_MS))
    out.push({ date, value: map.get(date) ?? empty })
  }
  return out
}

/** 北京日期 YYYY-MM-DD（UTC+8，无夏令时）。 */
export function shanghaiDate(d: Date): string {
  return new Date(d.getTime() + 8 * 3_600_000).toISOString().slice(0, 10)
}

const day = (col: string) => `to_char(${col} AT TIME ZONE '${STATS_TIME_ZONE}','YYYY-MM-DD')`
const PAID_LICENSE = `l.status='active' AND (l.lifetime OR l.expires_at>now()) AND p.tier IN ('standard','premium')`

export class AdminStatsQuery {
  constructor(private readonly db: Queryable) {}

  async overview(days: number, now = new Date()) {
    const w = statsWindows(now, days)
    const win = [w.cur.from, w.cur.to, w.prev.from]
    const [snap, period, signDaily, revDaily, sms, smsPurpose] = await Promise.all([
      this.db.query(`SELECT
        (SELECT count(*)::int FROM users WHERE role='user') AS "users",
        (SELECT count(DISTINCT l.user_id)::int FROM licenses l JOIN plans p ON p.id=l.plan_id JOIN users u ON u.id=l.user_id WHERE u.role='user' AND ${PAID_LICENSE}) AS "paid",
        (SELECT count(*)::int FROM users WHERE role='user' AND phone IS NOT NULL) AS "phoneBound",
        (SELECT count(*)::int FROM config_profiles) AS "profiles",
        (SELECT count(*)::int FROM config_profiles WHERE share_code IS NOT NULL) AS "shared",
        (SELECT count(*)::int FROM config_profiles WHERE restore_password_hash IS NOT NULL) AS "locked",
        (SELECT count(DISTINCT user_id)::int FROM config_profiles) AS "profileUsers",
        (SELECT count(*)::int FROM config_sync) AS "syncUsers",
        (SELECT count(*)::int FROM devices WHERE revoked=false AND last_seen_at>now()-interval '15 minutes') AS "online"`),
      this.db.query(`SELECT
        (SELECT count(*)::int FROM users WHERE role='user' AND created_at>=$1 AND created_at<$2) AS "signupsCur",
        (SELECT count(*)::int FROM users WHERE role='user' AND created_at>=$3 AND created_at<$1) AS "signupsPrev",
        (SELECT coalesce(sum(amount_cents),0)::bigint FROM orders WHERE status='paid' AND paid_at>=$1 AND paid_at<$2) AS "revCur",
        (SELECT coalesce(sum(amount_cents),0)::bigint FROM orders WHERE status='paid' AND paid_at>=$3 AND paid_at<$1) AS "revPrev",
        (SELECT count(*)::int FROM orders WHERE status='paid' AND paid_at>=$1 AND paid_at<$2) AS "paidOrdersCur",
        (SELECT count(*)::int FROM orders WHERE status='paid' AND paid_at>=$3 AND paid_at<$1) AS "paidOrdersPrev",
        (SELECT count(DISTINCT o.user_id)::int FROM orders o JOIN users u ON u.id=o.user_id WHERE o.status='paid' AND u.created_at>=$1 AND u.created_at<$2 AND o.paid_at<$2) AS "convCur",
        (SELECT count(DISTINCT o.user_id)::int FROM orders o JOIN users u ON u.id=o.user_id WHERE o.status='paid' AND u.created_at>=$3 AND u.created_at<$1 AND o.paid_at<$1) AS "convPrev",
        (SELECT count(*)::int FROM (SELECT user_id FROM orders WHERE status='paid' GROUP BY user_id HAVING min(paid_at)>=$1 AND min(paid_at)<$2) f) AS "newPaidCur",
        (SELECT count(*)::int FROM (SELECT user_id FROM orders WHERE status='paid' GROUP BY user_id HAVING min(paid_at)>=$3 AND min(paid_at)<$1) f) AS "newPaidPrev"`, win),
      this.db.query(`SELECT ${day('created_at')} AS date,count(*)::int AS n FROM users WHERE role='user' AND created_at>=$1 AND created_at<$2 GROUP BY 1`, [w.cur.from, w.cur.to]),
      this.db.query(`SELECT ${day('paid_at')} AS date,coalesce(sum(amount_cents),0)::bigint AS n FROM orders WHERE status='paid' AND paid_at>=$1 AND paid_at<$2 GROUP BY 1`, [w.cur.from, w.cur.to]),
      // sms_codes 只保留约 2 天（phone-auth.ts 每次发送清理），所以短信固定看最近 24 小时 vs 前 24 小时。
      this.db.query(`SELECT
        count(*) FILTER (WHERE created_at>=now()-interval '24 hours')::int AS "sent",
        count(*) FILTER (WHERE created_at<now()-interval '24 hours' AND created_at>=now()-interval '48 hours')::int AS "prev",
        count(*) FILTER (WHERE created_at>=now()-interval '24 hours' AND consumed_at IS NOT NULL)::int AS "verified"
        FROM sms_codes`),
      this.db.query(`SELECT purpose,count(*)::int AS n FROM sms_codes WHERE created_at>=now()-interval '24 hours' GROUP BY purpose ORDER BY purpose`),
    ])
    const s = snap.rows[0] ?? {}, p = period.rows[0] ?? {}, m = sms.rows[0] ?? {}
    const users = int(s.users), paid = int(s.paid)
    return {
      asOf: now.toISOString(), days, timeZone: STATS_TIME_ZONE,
      window: { from: w.cur.from.toISOString(), to: w.cur.to.toISOString(), prevFrom: w.prev.from.toISOString() },
      members: { users, paid, free: Math.max(users - paid, 0), newPaid: { cur: int(p.newPaidCur), prev: int(p.newPaidPrev) } },
      signups: { cur: int(p.signupsCur), prev: int(p.signupsPrev), daily: fillDays(signDaily.rows.map((r) => ({ date: String(r.date), value: int(r.n) })), w.cur.from, days, 0) },
      revenue: { curCents: centsString(p.revCur), prevCents: centsString(p.revPrev), paidOrders: { cur: int(p.paidOrdersCur), prev: int(p.paidOrdersPrev) },
        daily: fillDays(revDaily.rows.map((r) => ({ date: String(r.date), value: centsString(r.n) })), w.cur.from, days, '0') },
      conversion: { cur: { cohort: int(p.signupsCur), converted: int(p.convCur) }, prev: { cohort: int(p.signupsPrev), converted: int(p.convPrev) } },
      phone: { bound: int(s.phoneBound), total: users },
      cloud: { profiles: int(s.profiles), shared: int(s.shared), locked: int(s.locked), profileUsers: int(s.profileUsers), syncUsers: int(s.syncUsers) },
      sms: { sent24h: int(m.sent), prev24h: int(m.prev), verified24h: int(m.verified), byPurpose: smsPurpose.rows.map((r) => ({ purpose: String(r.purpose), count: int(r.n) })) },
      online: { devices15m: int(s.online) },
    }
  }

  /** 某用户的云同步与云端配置元数据（不含配置内容、分享码和任何密码哈希）。 */
  async userCloud(userId: string) {
    const [sync, profiles] = await Promise.all([
      this.db.query(`SELECT version,size,device_name AS "deviceName",updated_at AS "updatedAt" FROM config_sync WHERE user_id=$1`, [userId]),
      this.db.query(`SELECT id,name,size,device_name AS "deviceName",(share_code IS NOT NULL) AS shared,(restore_password_hash IS NOT NULL) AS locked,
        created_at AS "createdAt",updated_at AS "updatedAt" FROM config_profiles WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 50`, [userId]),
    ])
    return { sync: sync.rows[0] ?? null, profiles: profiles.rows }
  }
}
