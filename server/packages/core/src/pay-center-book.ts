// 统一支付中心（zhifu-service）在本站的两张表：订单簿 pay_center_orders（SDK SiteOrderBook）
// 与回调去重 pay_center_notifies（SDK DedupeStore，notify_id 唯一键）。迁移 0022。
import type { DedupeStore } from './vendor/zhifu/center/notify.js'
import type { SiteOrderBook, SiteOrderRecord } from './vendor/zhifu/site/types.js'

export type Queryable = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }> }

/** meta.orderNo = 本地 orders.order_no（建中心单时写进去，回调时据此找本地订单）。 */
export const localOrderNoOf = (meta: Record<string, unknown>): string | null =>
  typeof meta.orderNo === 'string' && meta.orderNo ? meta.orderNo : null

export function pgCenterOrderBook(db: Queryable): SiteOrderBook & {
  byLocalOrderNo(orderNo: string): Promise<SiteOrderRecord | null>
} {
  const row = (r: Record<string, unknown>): SiteOrderRecord => ({
    siteOrderNo: String(r.site_order_no), userId: String(r.user_id), amountCents: Number(r.amount_cents),
    meta: (r.meta && typeof r.meta === 'object' ? r.meta : {}) as Record<string, unknown>,
  })
  return {
    async save(rec) {
      const orderNo = localOrderNoOf(rec.meta)
      if (!orderNo) throw new Error('center order book: meta.orderNo missing')
      await db.query(`INSERT INTO pay_center_orders(site_order_no,order_no,user_id,amount_cents,meta) VALUES($1,$2,$3,$4,$5)`,
        [rec.siteOrderNo, orderNo, rec.userId, rec.amountCents, JSON.stringify(rec.meta)])
    },
    async load(siteOrderNo) {
      const r = await db.query(`SELECT site_order_no,user_id,amount_cents,meta FROM pay_center_orders WHERE site_order_no=$1`, [siteOrderNo])
      return r.rows[0] ? row(r.rows[0]) : null
    },
    async discard(siteOrderNo, reason) {
      await db.query(`UPDATE pay_center_orders SET discarded=$2 WHERE site_order_no=$1 AND discarded IS NULL`, [siteOrderNo, reason])
    },
    // 一笔本地订单对应最新那张没作废的中心单（换线 / 复用后以最新为准）。
    async byLocalOrderNo(orderNo) {
      const r = await db.query(`SELECT site_order_no,user_id,amount_cents,meta FROM pay_center_orders
        WHERE order_no=$1 AND discarded IS NULL ORDER BY created_at DESC LIMIT 1`, [orderNo])
      return r.rows[0] ? row(r.rows[0]) : null
    },
  }
}

export function pgCenterDedupe(db: Queryable): DedupeStore {
  return {
    async seen(id) { return ((await db.query(`SELECT 1 FROM pay_center_notifies WHERE notify_id=$1`, [id])).rowCount ?? 0) > 0 },
    async mark(id) { await db.query(`INSERT INTO pay_center_notifies(notify_id) VALUES($1) ON CONFLICT DO NOTHING`, [id]) },
    async claim(id) {
      return ((await db.query(`INSERT INTO pay_center_notifies(notify_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING 1`, [id])).rowCount ?? 0) > 0
    },
    async release(id) { await db.query(`DELETE FROM pay_center_notifies WHERE notify_id=$1`, [id]) },
  }
}
