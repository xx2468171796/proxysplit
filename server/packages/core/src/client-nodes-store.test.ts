import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { ClientNodeReport } from '@proxysplit/contracts'
import { clientNodeReportSchema } from '@proxysplit/contracts'
import { ClientNodesStore, diffInventory, LinkCipher, sha256Hex } from './client-nodes-store.js'
import { ClientNodesQuery } from './client-nodes-query.js'
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
    await new ClientNodesStore(db, cipher).ingest(next, { accountId: null })
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

  it('refuses to replace a device bound to another account', async () => {
    const { db, calls } = fakeDb({ nodes: [{ node_id: 'n1', account_id: 'owner', removed_at: null }] })
    const store = new ClientNodesStore(db, new LinkCipher(KEY))
    expect(await store.ingest(report(), { accountId: 'intruder' })).toMatchObject({ ignored: true, nodes: 0 })
    expect(await store.ingest(report(), { accountId: null })).toMatchObject({ ignored: true })
    expect(calls.some(c => c.sql.startsWith('UPDATE') || c.sql.includes('INSERT'))).toBe(false)
    expect((await store.ingest(report(), { accountId: 'owner' })).ignored).toBe(false)
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
    expect(res).toEqual({ changes: 7 })
    expect(calls[0]!.params[0]).toBe('2026-07-30T00:00:00.000Z')
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
