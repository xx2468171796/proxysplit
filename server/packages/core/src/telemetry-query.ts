// 客户端日志上报：后台查询与统计（都分页 / 限条数，走 0016 的索引；不在循环里查库）。
import type { TelemetryAnalyticsQuery, TelemetryDeviceListQuery, TelemetryEventListQuery, TelemetryFailureQuery, TelemetryLogQuery } from '@proxysplit/contracts'
import type { Db } from './telemetry-store.js'

type Row = Record<string, unknown>
export type Page<T = Row> = { items: T[]; total: number; limit: number; offset: number }

/** 日志全文搜索的时间窗：默认最近 24 小时，最长 7 天（ILIKE 扫不到窗外）。 */
export const LOG_WINDOW_DEFAULT_MS = 86_400_000
export const LOG_WINDOW_MAX_MS = 7 * 86_400_000

export function logWindow(from?: string, to?: string, now = new Date()): { from: Date; to: Date } {
  const end = to ? new Date(to) : now
  let start = from ? new Date(from) : new Date(end.getTime() - LOG_WINDOW_DEFAULT_MS)
  if (end.getTime() - start.getTime() > LOG_WINDOW_MAX_MS) start = new Date(end.getTime() - LOG_WINDOW_MAX_MS)
  return { from: start, to: end }
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, m => '\\' + m)

/** 把 count(*) OVER() 拆出来做 total。 */
function page(rows: Row[], limit: number, offset: number): Page {
  const total = rows[0] ? Number(rows[0].totalCount) : 0
  return { items: rows.map(({ totalCount: _t, ...rest }) => rest), total, limit, offset }
}

/** 从日志块里挑出命中的行（最多 maxLines 行），后台不必整块下发。 */
export function matchLines(text: string, q: string, maxLines = 200): string[] {
  const needle = q.toLowerCase(), out: string[] = []
  for (const line of text.split('\n')) {
    if (line && line.toLowerCase().includes(needle)) { out.push(line); if (out.length >= maxLines) break }
  }
  return out
}

export class TelemetryQuery {
  constructor(private readonly db: Db) {}

  async listDevices(p: TelemetryDeviceListQuery): Promise<Page> {
    const conds: string[] = [], vals: unknown[] = []
    const add = (sql: string, v: unknown) => { vals.push(v); conds.push(sql.replaceAll('$?', `$${vals.length}`)) }
    if (p.q) add(`(d.device_id LIKE $? OR d.os ILIKE $? OR d.account_hint ILIKE $? OR d.last_ip LIKE $?)`, `%${likeEscape(p.q)}%`)
    if (p.version) add('d.app_version=$?', p.version)
    if (p.lastStatus) add('d.last_status=$?', p.lastStatus)
    if (p.account) add(`(d.account_hint ILIKE $? OR u.username ILIKE $? OR d.account_id::text LIKE $?)`, `%${likeEscape(p.account)}%`)
    if (p.from) add('d.last_seen>=$?', p.from)
    if (p.to) add('d.last_seen<=$?', p.to)
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
    vals.push(p.limit, p.offset)
    const r = await this.db.query(`SELECT d.device_id AS "deviceId",d.first_seen AS "firstSeen",d.last_seen AS "lastSeen",d.app_version AS "appVersion",
      d.core_version AS "coreVersion",d.os,d.arch,d.account_id AS "accountId",u.username,d.account_hint AS "accountHint",d.last_ip AS "lastIp",
      d.last_status AS "lastStatus",d.last_error_code AS "lastErrorCode",d.last_start_at AS "lastStartAt",d.events_count::int AS "eventsCount",
      d.log_bytes::bigint AS "logBytes",(count(*) OVER())::int AS "totalCount"
      FROM client_devices d LEFT JOIN users u ON u.id=d.account_id ${where}
      ORDER BY d.last_seen DESC LIMIT $${vals.length - 1} OFFSET $${vals.length}`, vals)
    return page(r.rows, p.limit, p.offset)
  }

  async getDevice(deviceId: string): Promise<Row | null> {
    const r = await this.db.query(`SELECT d.*,u.username FROM client_devices d LEFT JOIN users u ON u.id=d.account_id WHERE d.device_id=$1`, [deviceId])
    return r.rows[0] ?? null
  }

  async listEvents(deviceId: string, p: TelemetryEventListQuery): Promise<Page> {
    const conds = ['device_id=$1'], vals: unknown[] = [deviceId]
    const add = (sql: string, v: unknown) => { vals.push(v); conds.push(sql.replaceAll('$?', `$${vals.length}`)) }
    if (p.type) add('type=$?', p.type)
    if (p.status) add('status=$?', p.status)
    if (p.errorCode) add('error_code=$?', p.errorCode)
    if (p.from) add('ts>=$?', p.from)
    if (p.to) add('ts<=$?', p.to)
    if (p.q) add('(error_text ILIKE $? OR type ILIKE $?)', `%${likeEscape(p.q)}%`)
    vals.push(p.limit, p.offset)
    const r = await this.db.query(`SELECT id::text,event_id AS "eventId",session_id AS "sessionId",seq::int,ts,received_at AS "receivedAt",type,status,
      duration_ms AS "durationMs",error_code AS "errorCode",error_text AS "errorText",app_version AS "appVersion",payload,(count(*) OVER())::int AS "totalCount"
      FROM client_events WHERE ${conds.join(' AND ')} ORDER BY ts DESC,seq DESC LIMIT $${vals.length - 1} OFFSET $${vals.length}`, vals)
    return page(r.rows, p.limit, p.offset)
  }

  /** 日志：按时间窗分页；带 q 时只在窗内 ILIKE，并只回命中的行。 */
  async searchLogs(deviceId: string, p: TelemetryLogQuery): Promise<Page & { window: { from: string; to: string } }> {
    const w = logWindow(p.from, p.to)
    const vals: unknown[] = [deviceId, w.from.toISOString(), w.to.toISOString()]
    let filter = ''
    if (p.q) { vals.push(`%${likeEscape(p.q)}%`); filter = `AND text ILIKE $${vals.length}` }
    vals.push(p.limit, p.offset)
    const r = await this.db.query(`SELECT id::text,session_id AS "sessionId",started_at AS "startedAt",ended_at AS "endedAt",line_count AS "lineCount",bytes,text,
      (count(*) OVER())::int AS "totalCount"
      FROM client_log_chunks WHERE device_id=$1 AND started_at<=$3 AND ended_at>=$2 ${filter}
      ORDER BY started_at DESC LIMIT $${vals.length - 1} OFFSET $${vals.length}`, vals)
    const rows = p.q ? r.rows.map(row => ({ ...row, text: undefined, matches: matchLines(String(row.text ?? ''), p.q ?? '') })) : r.rows
    return { ...page(rows, p.limit, p.offset), window: { from: w.from.toISOString(), to: w.to.toISOString() } }
  }

  /** 最近失败：按（事件类型, 错误码）分组。 */
  async failures(p: TelemetryFailureQuery): Promise<Page> {
    const vals: unknown[] = [new Date(Date.now() - p.days * 86_400_000).toISOString()]
    const conds = [`status='fail'`, 'ts>=$1']
    if (p.type) { vals.push(p.type); conds.push(`type=$${vals.length}`) }
    if (p.version) { vals.push(p.version); conds.push(`app_version=$${vals.length}`) }
    if (p.q) { vals.push(`%${likeEscape(p.q)}%`); conds.push(`error_text ILIKE $${vals.length}`) }
    vals.push(p.limit, p.offset)
    const r = await this.db.query(`SELECT type,coalesce(error_code,'UNKNOWN') AS "errorCode",count(*)::int AS count,count(DISTINCT device_id)::int AS devices,
      max(ts) AS "lastAt",(array_agg(error_text ORDER BY ts DESC))[1] AS "sampleText",(array_agg(device_id ORDER BY ts DESC))[1] AS "sampleDevice",
      (array_agg(DISTINCT app_version))[1:5] AS versions,(count(*) OVER())::int AS "totalCount"
      FROM client_events WHERE ${conds.join(' AND ')} GROUP BY type,coalesce(error_code,'UNKNOWN')
      ORDER BY count(*) DESC LIMIT $${vals.length - 1} OFFSET $${vals.length}`, vals)
    return page(r.rows, p.limit, p.offset)
  }

  /** 统计分析：固定条数的几条聚合，并发查询。 */
  async analytics(p: TelemetryAnalyticsQuery) {
    const since = new Date(Date.now() - p.days * 86_400_000).toISOString(), lim = p.limit
    const startBy = (dim: string) => this.db.query(`SELECT ${dim} AS key,count(*)::int AS starts,count(*) FILTER (WHERE status='ok')::int AS ok,
      round(100.0*count(*) FILTER (WHERE status='ok')/greatest(count(*),1),1)::float AS "okRate"
      FROM client_events WHERE type='proxy.start' AND ts>=$1 GROUP BY 1 ORDER BY 2 DESC LIMIT $2`, [since, lim])
    const [daily, byVersion, byOs, byCapture, byProtocol, errors, security, apps, latency] = await Promise.all([
      this.db.query(`SELECT to_char(date_trunc('day',ts),'YYYY-MM-DD') AS day,count(DISTINCT device_id)::int AS "activeDevices",
        count(*) FILTER (WHERE type='proxy.start')::int AS starts,count(*) FILTER (WHERE type='proxy.start' AND status='ok')::int AS "startOk",
        count(*) FILTER (WHERE status='fail')::int AS failures
        FROM client_events WHERE ts>=$1 GROUP BY 1 ORDER BY 1`, [since]),
      startBy('app_version'), startBy(`split_part(os,' (',1)`), startBy(`coalesce(payload->>'capture','?')`), startBy(`coalesce(nullif(payload->>'protocol',''),'?')`),
      this.db.query(`SELECT coalesce(error_code,'UNKNOWN') AS key,count(*)::int AS count,count(DISTINCT device_id)::int AS devices
        FROM client_events WHERE status='fail' AND ts>=$1 GROUP BY 1 ORDER BY 2 DESC LIMIT $2`, [since, lim]),
      this.db.query(`SELECT p AS key,count(DISTINCT device_id)::int AS devices FROM client_events,jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(payload->'products')='array' THEN payload->'products' ELSE '[]'::jsonb END) p
        WHERE type='env.security' AND ts>=$1 GROUP BY 1 ORDER BY 2 DESC LIMIT $2`, [since, lim]),
      this.db.query(`SELECT split_part(a,'→',1) AS key,count(DISTINCT device_id)::int AS devices FROM client_events,jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(payload->'added')='array' THEN payload->'added' ELSE '[]'::jsonb END) a
        WHERE type='app_rule.change' AND ts>=$1 GROUP BY 1 ORDER BY 2 DESC LIMIT $2`, [since, lim]),
      this.db.query(`SELECT coalesce(nullif(payload->>'protocol',''),'?') AS key,count(*)::int AS tests,count(*) FILTER (WHERE status='fail')::int AS failed,
        round(100.0*count(*) FILTER (WHERE status='fail')/greatest(count(*),1),1)::float AS "failRate"
        FROM client_events WHERE type IN ('node.latency','node.tcp') AND ts>=$1 GROUP BY 1 ORDER BY 2 DESC LIMIT $2`, [since, lim]),
    ])
    return {
      days: p.days, daily: daily.rows, startByVersion: byVersion.rows, startByOs: byOs.rows, startByCapture: byCapture.rows,
      startByProtocol: byProtocol.rows, topErrors: errors.rows, security: security.rows, topApps: apps.rows, latencyByProtocol: latency.rows,
    }
  }
}
