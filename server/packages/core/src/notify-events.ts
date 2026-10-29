// 业务事件 → 站内通知（经 notify.send，幂等键防重复）：会员到账、会员快到期、过期通知清理。
// 都在业务事务提交之后调；发失败只记日志（notify.send 已兜住），不影响付款 / 授权。
import type { Notify } from './notify.js'

type Pool = { query: <R>(text: string, values?: unknown[]) => Promise<{ rows: R[] }> }

const day = (d: Date) => d.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })
const REMIND_DAYS = 3
const PURGE_AFTER_DAYS = 90

export function createNotifyEvents(pool: Pool, notify: Notify) {
  /** 付款落地后：整单（拆单则整组）付清才发一次「会员已到账」。 */
  async function membershipPaid(orderNo: string): Promise<void> {
    const r = await pool.query<{ user_id: string; plan_name: string; group_key: string; lifetime: boolean; expires_at: Date | null }>(
      `SELECT o.user_id, o.plan_name, coalesce(o.group_id::text, o.order_no) AS group_key, o.lifetime,
         (SELECT max(l.expires_at) FROM licenses l WHERE l.user_id=o.user_id AND l.status='active') AS expires_at
       FROM orders o WHERE o.order_no=$1 AND o.status='paid'
         AND NOT EXISTS (SELECT 1 FROM orders g WHERE o.group_id IS NOT NULL AND g.group_id=o.group_id AND g.status<>'paid')`,
      [orderNo],
    )
    const o = r.rows[0]
    if (!o) return
    const until = o.lifetime ? '永久有效' : o.expires_at ? `有效期到 ${day(o.expires_at)}` : ''
    await notify.send({
      userId: o.user_id,
      kind: 'reward',
      title: '会员已到账',
      body: `**${o.plan_name}** 已生效${until ? `，${until}` : ''}。感谢支持！`,
      surfaces: ['inbox', 'toast'],
      idemKey: `paid:${o.group_key}`,
    })
  }

  /** 每天跑：非永久、非 AI 套餐的会员到期前 3 天提醒一次（同一到期日只提醒一次）。 */
  async function expiringReminders(): Promise<number> {
    const r = await pool.query<{ id: string; user_id: string; expires_at: Date }>(
      `SELECT l.id, l.user_id, l.expires_at FROM licenses l
       WHERE l.status='active' AND NOT coalesce(l.lifetime,false) AND l.source NOT IN ('trial','aigw')
         AND l.expires_at > now() AND l.expires_at <= now() + make_interval(days => $1)
         AND NOT EXISTS (SELECT 1 FROM licenses x WHERE x.user_id=l.user_id AND x.status='active'
           AND (coalesce(x.lifetime,false) OR x.expires_at > l.expires_at))`,
      [REMIND_DAYS],
    )
    for (const l of r.rows) {
      await notify.send({
        userId: l.user_id,
        kind: 'warning',
        title: '会员快到期了',
        body: `你的会员将在 **${day(l.expires_at)}** 到期，到期后会回到免费版（只能用 1 台设备）。可在「账户」里续费。`,
        surfaces: ['inbox', 'toast'],
        idemKey: `expire:${l.id}:${l.expires_at.toISOString().slice(0, 10)}`,
      })
    }
    return r.rows.length
  }

  async function purge(): Promise<void> {
    await notify.tongzhi.purge({ olderThanDays: PURGE_AFTER_DAYS })
  }

  return { membershipPaid, expiringReminders, purge }
}

export type NotifyEvents = ReturnType<typeof createNotifyEvents>
