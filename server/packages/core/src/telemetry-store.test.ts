import { describe, expect, it } from 'vitest'
import type { TelemetryBatch } from '@proxysplit/contracts'
import { clampTs, lastStart, pgJson, TelemetryStore, type Db } from './telemetry-store.js'
import { logWindow, matchLines, TelemetryQuery } from './telemetry-query.js'

type Call = { sql: string; params: unknown[] }
function fakeDb(rowCounts: number[] = []) {
  const calls: Call[] = []
  const query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params })
    return { rows: [], rowCount: sql.startsWith('DELETE') ? rowCounts.shift() ?? 0 : 1 }
  }
  const db: Db = { query, connect: async () => ({ query, release: () => {} }) }
  return { db, calls }
}

const batch: TelemetryBatch = {
  schemaVersion: 1, deviceId: 'a'.repeat(64), appVersion: '1.9.96', os: 'Windows 11',
  events: [
    { eventId: '11111111-2222-4333-8444-555555555555', sessionId: 's', seq: 1, ts: '2026-10-27T10:00:00Z', type: 'proxy.start', status: 'fail', errorCode: 'TUN_CREATE_FAIL', payload: {} },
    { eventId: '11111111-2222-4333-8444-555555555556', sessionId: 's', seq: 2, ts: '2026-10-27T10:05:00Z', type: 'proxy.start', status: 'ok', payload: { note: 'a\u0000b' } },
    { eventId: '11111111-2222-4333-8444-555555555557', sessionId: 's', seq: 3, ts: '2026-10-27T10:06:00Z', type: 'node.latency', status: 'fail', payload: {} },
  ],
  logs: [{ chunkId: '21111111-2222-4333-8444-555555555555', sessionId: 's', startedAt: '2026-10-27T10:00:00Z', endedAt: '2026-10-27T10:01:00Z', lineCount: 2, text: 'x\u0000y\nz\n' }],
}

describe('telemetry ingest', () => {
  it('stores a batch in one transaction with one statement per table (no per-row queries)', async () => {
    const { db, calls } = fakeDb()
    const res = await new TelemetryStore(db).ingest(batch, { accountId: 'u1', ip: '1.2.3.4', now: new Date('2026-10-27T12:00:00Z') })
    expect(res).toEqual({ events: 1, logs: 1 })
    expect(calls.map(c => c.sql.trim().split(/\s+/)[0])).toEqual(['BEGIN', 'INSERT', 'INSERT', 'INSERT', 'COMMIT'])
    const device = calls[1]!.params
    expect(device[8]).toBe('ok') // newest proxy.start wins
    const events = JSON.parse(String(calls[2]!.params[0]))
    expect(events).toHaveLength(3)
    expect(String(calls[2]!.params[0])).not.toContain('\\u0000')
    expect(String(calls[3]!.params[0])).not.toContain('\\u0000')
  })

  it('rolls back on failure', async () => {
    const calls: string[] = []
    const client = { query: async (sql: string) => { calls.push(sql.trim().split(/\s+/)[0]!); if (sql.includes('client_events')) throw new Error('boom'); return { rows: [], rowCount: 1 } }, release: () => {} }
    const store = new TelemetryStore({ query: client.query, connect: async () => client })
    await expect(store.ingest(batch, { accountId: null, ip: '' })).rejects.toThrow('boom')
    expect(calls).toContain('ROLLBACK')
  })

  it('clamps clocks that run ahead and picks the latest start', () => {
    const now = new Date('2026-10-27T12:00:00Z')
    expect(clampTs('2027-01-01T00:00:00Z', now)).toBe(now.toISOString())
    expect(clampTs('2026-10-27T11:00:00Z', now)).toBe('2026-10-27T11:00:00.000Z')
    expect(lastStart(batch)).toMatchObject({ status: 'ok' })
    expect(pgJson({ a: 'x\u0000y', b: '\\u0000' })).toBe('{"a":"xy","b":"\\\\u0000"}')
  })
})

describe('telemetry retention', () => {
  it('deletes in bounded batches until a short batch, then removes stale devices', async () => {
    const { db, calls } = fakeDb([5, 5, 2, 0, 1])
    const removed = await new TelemetryStore(db).purge(15, { batchSize: 5, maxBatches: 10, now: new Date('2026-10-27T00:00:00Z') })
    expect(removed).toEqual({ events: 12, logs: 0, devices: 1 })
    expect(calls).toHaveLength(5)
    expect(calls[0]!.params[0]).toBe('2026-10-12T00:00:00.000Z')
    expect(calls.every(c => c.sql.includes('LIMIT'))).toBe(true)
  })

  it('stops at maxBatches so one run never holds the table for long', async () => {
    const { db, calls } = fakeDb(Array(50).fill(5))
    await new TelemetryStore(db).purge(15, { batchSize: 5, maxBatches: 3 })
    expect(calls).toHaveLength(7) // 3 events + 3 logs + 1 devices
  })
})

describe('telemetry queries', () => {
  it('bounds the log search window to 7 days and defaults to 24 h', () => {
    const now = new Date('2026-10-27T00:00:00Z')
    expect(logWindow(undefined, undefined, now).from.toISOString()).toBe('2026-10-26T00:00:00.000Z')
    expect(logWindow('2026-01-01T00:00:00Z', undefined, now).from.toISOString()).toBe('2026-10-20T00:00:00.000Z')
    expect(matchLines('a TUN fail\nok\nTun again', 'tun')).toEqual(['a TUN fail', 'Tun again'])
  })

  it('paginates and escapes LIKE wildcards', async () => {
    const { db, calls } = fakeDb()
    await new TelemetryQuery(db).listDevices({ q: '50%_x', limit: 20, offset: 40, lastStatus: 'fail' })
    expect(calls[0]!.params).toEqual(['%50\\%\\_x%', 'fail', 20, 40])
    expect(calls[0]!.sql).toContain('LIMIT $3 OFFSET $4')
    await new TelemetryQuery(db).searchLogs('a'.repeat(64), { q: 'tun', limit: 10, offset: 0 })
    expect(calls[1]!.sql).toContain('ILIKE')
    expect(calls[1]!.sql).toContain('started_at<=$3 AND ended_at>=$2')
  })

  it('runs a fixed number of analytics queries', async () => {
    const { db, calls } = fakeDb()
    const res = await new TelemetryQuery(db).analytics({ days: 7, limit: 10 })
    expect(calls).toHaveLength(9)
    expect(Object.keys(res)).toContain('latencyByProtocol')
  })
})
