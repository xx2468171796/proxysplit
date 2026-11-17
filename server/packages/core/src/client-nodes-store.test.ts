import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { ClientNodeReport } from '@proxysplit/contracts'
import { clientNodeReportSchema } from '@proxysplit/contracts'
import { ClientNodesStore, diffInventory, LinkCipher, sha256Hex } from './client-nodes-store.js'
import { ClientNodesQuery, OUTSIDER_ROWS_SQL } from './client-nodes-query.js'
import type { Db } from './telemetry-store.js'

type Call = { sql: string; params: unknown[] }
const KEY = randomBytes(32).toString('base64')
const DEVICE = 'a'.repeat(64)

function fakeDb(prev: { nodes?: Record<string, unknown>[]; subs?: Record<string, unknown>[]; reveal?: Record<string, unknown>[] } = {}) {
  const calls: Call[] = []
  const query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params })
    if (sql.includes('FROM client_nodes WHERE device_id=$1 FOR UPDATE')) return { rows: prev.nodes ?? [], rowCount: 0 }
    if (sql.includes('FROM client_subs WHERE device_id=$1 FOR UPDATE')) return { rows: prev.subs ?? [], rowCount: 0 }
    if (sql.startsWith('SELECT link_enc') || sql.startsWith('SELECT url_enc')) return { rows: prev.reveal ?? [], rowCount: 0 }
    return { rows: [], rowCount: 1 }
  }
  const db: Db = { query, connect: async () => ({ query, release: () => {} }) }
  return { db, calls }
}

const report = (over: Partial<ClientNodeReport> = {}): ClientNodeReport => clientNodeReportSchema.parse({
  schemaVersion: 1, deviceId: DEVICE, appVersion: '1.10.7', reason: 'change', selectedId: 'n1',
  nodes: [
    { id: 'n1', name: '台湾1', type: 'vless', server: 'a.example', port: 443, link: 'vless://secret@a.example:443' },
    { id: 'n2', name: '日本', type: 'trojan', server: 'b.example', port: 443, link: 'trojan://pw@b.example:443' },
  ],
  subs: [{ id: 's1', name: '机场', url: 'https://air.example/link/xxx', host: 'air.example', nodeCount: 2 }],
  ...over,
})

const changesOf = (calls: Call[]) => {
  const c = calls.find(x => x.sql.includes('INSERT INTO client_node_changes'))
  return c ? JSON.parse(String(c.params[0])) as { item_id: string; action: string; fields: string[] }[] : []
}

describe('client node inventory replace', () => {
  it('upserts present rows, marks missing ones removed, all in one transaction', async () => {
    const { db, calls } = fakeDb()
    const res = await new ClientNodesStore(db, new LinkCipher(KEY)).ingest(report(), { accountId: 'u1' })
    expect(res).toEqual({ nodes: 2, subs: 1, changes: 3, ignored: false })
    expect(calls.map(c => c.sql.trim().split(/\s+/)[0])).toEqual(['BEGIN', 'SELECT', 'SELECT', 'INSERT', 'UPDATE', 'INSERT', 'UPDATE', 'INSERT', 'COMMIT'])
    const removeNodes = calls.find(c => c.sql.startsWith('UPDATE client_nodes'))!
    expect(removeNodes.params[1]).toEqual(['n1', 'n2'])
    expect(calls.find(c => c.sql.includes('INSERT INTO client_nodes'))!.sql).toContain('removed_at=NULL') // reappear clears removed_at
    expect(changesOf(calls).map(c => c.action)).toEqual(['add', 'add', 'add'])
  })

  it('records remove, reappear (add) and update with changed field names', async () => {
    const old = report()
    const cipher = new LinkCipher(KEY)
    const hash = (l: string) => sha256Hex(l)
    const prevNodes = [
      { node_id: 'n1', name: '台湾1', type: 'vless', server: 'a.example', port: 443, network: '', security: '', sni: '', core: '', via: '', sub_id: '', official: false, source: '', link_hash: hash(old.nodes[0]!.link), removed_at: null },
      { node_id: 'n2', name: '日本', type: 'trojan', server: 'b.example', port: 443, network: '', security: '', sni: '', core: '', via: '', sub_id: '', official: false, source: '', link_hash: hash(old.nodes[1]!.link), removed_at: '2026-10-01T00:00:00Z' },
      { node_id: 'n3', name: '旧节点', removed_at: null },
    ]
    const { db, calls } = fakeDb({ nodes: prevNodes })
    const next = report({ nodes: [{ ...old.nodes[0]!, port: 8443, latency: -1 }, old.nodes[1]!] })
    await new ClientNodesStore(db, cipher).ingest(next, { accountId: 'staff-1' })
    const ch = changesOf(calls).filter(c => c.item_id.startsWith('n'))
    expect(ch).toEqual([
      expect.objectContaining({ item_id: 'n1', action: 'update', fields: ['port'] }),
      expect.objectContaining({ item_id: 'n2', action: 'add' }),
      expect.objectContaining({ item_id: 'n3', action: 'remove' }),
    ])
  })

  it('diff ignores latency / speed changes', () => {
    const row = { node_id: 'x', name: 'a', latency: 10 }
    expect(diffInventory('node', 'node_id', ['name'], [{ ...row, latency: -1 }], [{ ...row, removed_at: null }])).toEqual([])
  })

  // 2026-11-18 起只有核实过的员工账号能上报（路由判定）：清单上的账号就是这次上报的人，换了员工登录就跟着换。
  it('stamps the verified reporter on every row, replacing the previous owner', async () => {
    const { db, calls } = fakeDb({ nodes: [{ node_id: 'n1', account_id: 'owner', removed_at: null }] })
    const store = new ClientNodesStore(db, new LinkCipher(KEY))
    expect(await store.ingest(report(), { accountId: 'staff-2' })).toMatchObject({ ignored: false, nodes: 2 })
    for (const table of ['client_nodes', 'client_subs']) {
      const upsert = calls.find(c => c.sql.includes(`INSERT INTO ${table}`))
      expect(upsert?.sql, table).toContain('account_id=EXCLUDED.account_id')
      expect(upsert?.params[2], table).toBe('staff-2')
    }
  })

  it('encrypts links (never stores plaintext) and decrypts on reveal', async () => {
    const cipher = new LinkCipher(KEY)
    const { db, calls } = fakeDb()
    await new ClientNodesStore(db, cipher).ingest(report(), { accountId: 'u1' })
    const insert = calls.find(c => c.sql.includes('INSERT INTO client_nodes'))!
    expect(String(insert.params[0])).not.toContain('vless://secret')
    const rows = JSON.parse(String(insert.params[0])) as { link_enc: string; link_hash: string; selected: boolean }[]
    expect(rows[0]!.link_hash).toBe(sha256Hex('vless://secret@a.example:443'))
    expect(rows.map(r => r.selected)).toEqual([true, false])
    expect(cipher.decrypt(rows[0]!.link_enc)).toBe('vless://secret@a.example:443')
    const subInsert = calls.find(c => c.sql.includes('INSERT INTO client_subs'))!
    expect(String(subInsert.params[0])).not.toContain('link/xxx')
    const q = new ClientNodesQuery(fakeDb({ reveal: [{ link_enc: rows[0]!.link_enc }] }).db, cipher)
    expect(await q.revealNode(DEVICE, 'n1')).toEqual({ found: true, link: 'vless://secret@a.example:443' })
    expect(await new ClientNodesQuery(fakeDb().db, cipher).revealNode(DEVICE, 'nx')).toEqual({ found: false, link: null })
    expect(() => new LinkCipher(Buffer.alloc(16).toString('base64'))).toThrow()
  })

  it('without a key stores no link but keeps everything else, warning once', async () => {
    const warn = vi.fn()
    const { db, calls } = fakeDb()
    const store = new ClientNodesStore(db, new LinkCipher(undefined), warn)
    await store.ingest(report(), { accountId: 'u1' })
    await store.ingest(report(), { accountId: 'u1' })
    expect(warn).toHaveBeenCalledTimes(1)
    const rows = JSON.parse(String(calls.find(c => c.sql.includes('INSERT INTO client_nodes'))!.params[0])) as Record<string, unknown>[]
    expect(rows[0]).toMatchObject({ link_enc: null, name: '台湾1', server: 'a.example', link_hash: sha256Hex('vless://secret@a.example:443') })
  })

  it('purges changes older than 90 days in bounded batches', async () => {
    const counts = [5, 2]
    const calls: Call[] = []
    const query = async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: [], rowCount: counts.shift() ?? 0 } }
    const res = await new ClientNodesStore({ query, connect: async () => ({ query, release: () => {} }) }, new LinkCipher(KEY))
      .purge(90, { batchSize: 5, now: new Date('2026-10-28T00:00:00Z') })
    expect(res).toEqual({ changes: 7, clearedLinks: 0, staleRows: 0 })
    expect(calls.some(c => c.sql.includes("SET link_enc=NULL WHERE removed_at<"))).toBe(true)
    expect(calls[0]!.params[0]).toBe('2026-07-30T00:00:00.000Z')
  })

  it('purges alive inventory rows of devices that stopped reporting (never purged before), in bounded batches', async () => {
    const calls: Call[] = []
    const query = async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: [], rowCount: sql.startsWith('DELETE FROM client_nodes') ? 3 : sql.startsWith('DELETE FROM client_subs') ? 1 : 0 } }
    const res = await new ClientNodesStore({ query, connect: async () => ({ query, release: () => {} }) }, new LinkCipher(KEY))
      .purge(90, { batchSize: 5, now: new Date('2026-10-28T00:00:00Z'), staleDays: 30 })
    expect(res).toEqual({ changes: 0, clearedLinks: 0, staleRows: 4 })
    const del = calls.find(c => c.sql.startsWith('DELETE FROM client_nodes'))!
    expect(del.sql).toContain('removed_at IS NULL AND last_seen<$1')
    expect(del.params).toEqual(['2026-09-28T00:00:00.000Z', 5])
  })

  // 以前收进来的非员工 / 匿名设备的清单不删（等业主决定），后台统计里给出规模。
  it('stats report how many stored rows do not belong to a staff account (anonymous device, deleted or non-staff account)', async () => {
    const seen: string[] = []
    const query = async (sql: string) => {
      seen.push(sql)
      return { rows: sql === OUTSIDER_ROWS_SQL ? [{ nodes: 1200, subs: 80, changes: 3000, devices: 310 }] : [{}], rowCount: 1 }
    }
    const stats = await new ClientNodesQuery({ query, connect: async () => ({ query, release: () => {} }) }, new LinkCipher(KEY)).stats()
    expect(stats.nonStaff).toEqual({ devices: 310, nodes: 1200, subs: 80, changes: 3000 })
    for (const table of ['client_nodes', 'client_subs', 'client_node_changes']) {
      expect(OUTSIDER_ROWS_SQL).toContain(`FROM ${table} x LEFT JOIN users u ON u.id=x.account_id WHERE u.id IS NULL OR u.staff=false`)
    }
    expect(seen).toContain(OUTSIDER_ROWS_SQL)
  })

  it('list query paginates by page / pageSize and escapes LIKE', async () => {
    const { db, calls } = fakeDb()
    await new ClientNodesQuery(db, new LinkCipher(KEY)).listNodes({ q: '50%', status: 'alive', dead: true, page: 3, pageSize: 20 })
    expect(calls[0]!.params).toEqual(['%50\\%%', 20, 40])
    expect(calls[0]!.sql).toContain('n.removed_at IS NULL')
    expect(calls[0]!.sql).toContain('n.latency<0')
    expect(calls[0]!.sql).not.toContain('link_enc,')
  })
})
