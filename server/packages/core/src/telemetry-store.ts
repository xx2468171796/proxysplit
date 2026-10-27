// 客户端日志上报：入库（一批一个事务、每张表一条语句，不在循环里查库）+ 保留期清理。
// 查询 / 统计在 telemetry-query.ts。表结构见 migrations/0016_client_telemetry.sql。
import type { TelemetryBatch } from '@proxysplit/contracts'

export type QueryResult = { rows: Record<string, unknown>[]; rowCount: number | null }
export type DbClient = { query: (sql: string, params?: unknown[]) => Promise<QueryResult>; release: () => void }
export type Db = { query: (sql: string, params?: unknown[]) => Promise<QueryResult>; connect: () => Promise<DbClient> }

export type IngestContext = { accountId: string | null; ip: string; now?: Date }
export type IngestResult = { events: number; logs: number }

/** 客户端时间超前太多（改过系统时间）就按收到时间记，避免把统计挤到未来。 */
const MAX_CLOCK_SKEW_MS = 10 * 60_000

export function clampTs(ts: string, now: Date): string {
  const t = Date.parse(ts)
  if (!Number.isFinite(t) || t - now.getTime() > MAX_CLOCK_SKEW_MS) return now.toISOString()
  return new Date(t).toISOString()
}

/** PG 的 text / jsonb 都不收 \u0000：序列化后整体去掉。 */
export const pgJson = (v: unknown) => JSON.stringify(v).replace(/(?<!\\)((?:\\\\)*)\\u0000/g, '$1')

/** 设备最近一次启动代理的结果（本批里最新的 proxy.start）。 */
export function lastStart(batch: TelemetryBatch): { status: string; errorCode: string | null; ts: string } | null {
  let best: { status: string; errorCode: string | null; ts: string } | null = null
  for (const e of batch.events) {
    if (e.type !== 'proxy.start') continue
    if (!best || Date.parse(e.ts) >= Date.parse(best.ts)) best = { status: e.status, errorCode: e.errorCode ?? null, ts: e.ts }
  }
  return best
}

export class TelemetryStore {
  constructor(private readonly db: Db) {}

  async ingest(batch: TelemetryBatch, ctx: IngestContext): Promise<IngestResult> {
    const now = ctx.now ?? new Date()
    const events = batch.events.map(e => ({
      event_id: e.eventId, session_id: e.sessionId, seq: e.seq, ts: clampTs(e.ts, now), type: e.type, status: e.status,
      duration_ms: e.durationMs ?? null, error_code: e.errorCode ?? null, error_text: e.errorText ?? null, payload: e.payload ?? {},
    }))
    const logs = batch.logs.map(l => ({
      chunk_id: l.chunkId, session_id: l.sessionId, started_at: clampTs(l.startedAt, now), ended_at: clampTs(l.endedAt, now),
      line_count: l.lineCount, bytes: Buffer.byteLength(l.text), text: l.text.replaceAll('\u0000', ''),
    }))
    const start = lastStart(batch)
    const logBytes = logs.reduce((n, l) => n + l.bytes, 0)
    const client = await this.db.connect()
    try {
      await client.query('BEGIN')
      await client.query(`INSERT INTO client_devices(device_id,app_version,core_version,os,arch,account_id,account_hint,last_ip,last_status,last_error_code,last_start_at,events_count,log_bytes)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9,'info'),$10,$11,$12,$13)
        ON CONFLICT(device_id) DO UPDATE SET last_seen=now(),app_version=EXCLUDED.app_version,
          core_version=CASE WHEN EXCLUDED.core_version<>'' THEN EXCLUDED.core_version ELSE client_devices.core_version END,
          os=CASE WHEN EXCLUDED.os<>'' THEN EXCLUDED.os ELSE client_devices.os END,arch=EXCLUDED.arch,
          account_id=coalesce(EXCLUDED.account_id,client_devices.account_id),
          account_hint=CASE WHEN EXCLUDED.account_hint<>'' THEN EXCLUDED.account_hint ELSE client_devices.account_hint END,
          last_ip=EXCLUDED.last_ip,
          last_status=CASE WHEN $9::text IS NOT NULL AND (client_devices.last_start_at IS NULL OR $11::timestamptz>=client_devices.last_start_at) THEN $9 ELSE client_devices.last_status END,
          last_error_code=CASE WHEN $9::text IS NOT NULL AND (client_devices.last_start_at IS NULL OR $11::timestamptz>=client_devices.last_start_at) THEN $10 ELSE client_devices.last_error_code END,
          last_start_at=greatest(client_devices.last_start_at,$11::timestamptz),
          events_count=client_devices.events_count+EXCLUDED.events_count,log_bytes=client_devices.log_bytes+EXCLUDED.log_bytes`,
        [batch.deviceId, batch.appVersion, batch.coreVersion ?? '', batch.os ?? '', batch.arch ?? '', ctx.accountId, batch.accountHint ?? '', ctx.ip,
          start?.status ?? null, start?.errorCode ?? null, start ? clampTs(start.ts, now) : null, events.length, logBytes])
      const ev = events.length ? await client.query(`INSERT INTO client_events(event_id,device_id,account_id,session_id,seq,ts,type,status,duration_ms,error_code,error_text,app_version,os,schema_version,payload)
        SELECT r.event_id,$2,$3,r.session_id,r.seq,r.ts,r.type,r.status,r.duration_ms,r.error_code,r.error_text,$4,$5,$6,coalesce(r.payload,'{}'::jsonb)
        FROM jsonb_to_recordset($1::jsonb) AS r(event_id uuid,session_id text,seq bigint,ts timestamptz,type text,status text,duration_ms integer,error_code text,error_text text,payload jsonb)
        ON CONFLICT(event_id) DO NOTHING`, [pgJson(events), batch.deviceId, ctx.accountId, batch.appVersion, batch.os ?? '', batch.schemaVersion]) : { rowCount: 0 }
      const lg = logs.length ? await client.query(`INSERT INTO client_log_chunks(chunk_id,device_id,session_id,started_at,ended_at,line_count,bytes,text)
        SELECT r.chunk_id,$2,r.session_id,r.started_at,r.ended_at,r.line_count,r.bytes,r.text
        FROM jsonb_to_recordset($1::jsonb) AS r(chunk_id uuid,session_id text,started_at timestamptz,ended_at timestamptz,line_count integer,bytes integer,text text)
        ON CONFLICT(chunk_id) DO NOTHING`, [pgJson(logs), batch.deviceId]) : { rowCount: 0 }
      await client.query('COMMIT')
      return { events: ev.rowCount ?? 0, logs: lg.rowCount ?? 0 }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally { client.release() }
  }

  /**
   * 删掉 retentionDays 之前收到的数据：每批最多 batchSize 行，每张表最多 maxBatches 批，
   * 删不完的下一轮接着删（不长时间占锁、不一次性撑爆 WAL）。
   */
  async purge(retentionDays: number, opts: { batchSize?: number; maxBatches?: number; now?: Date } = {}) {
    const batchSize = opts.batchSize ?? 5000, maxBatches = opts.maxBatches ?? 20
    const cutoff = new Date((opts.now ?? new Date()).getTime() - retentionDays * 86_400_000).toISOString()
    const removed = { events: 0, logs: 0, devices: 0 }
    const tables = [['client_events', 'received_at', 'events'], ['client_log_chunks', 'received_at', 'logs']] as const
    for (const [table, col, key] of tables) {
      for (let i = 0; i < maxBatches; i++) {
        const r = await this.db.query(`DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE ${col}<$1 ORDER BY id LIMIT $2)`, [cutoff, batchSize])
        removed[key] += r.rowCount ?? 0
        if ((r.rowCount ?? 0) < batchSize) break
      }
    }
    const d = await this.db.query(`DELETE FROM client_devices WHERE device_id IN (SELECT device_id FROM client_devices WHERE last_seen<$1 LIMIT $2)`, [cutoff, batchSize])
    removed.devices = d.rowCount ?? 0
    return removed
  }
}
