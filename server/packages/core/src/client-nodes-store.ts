// 同事节点上报：按设备整份替换节点 / 订阅清单（一个事务、每张表一条语句）+ 变化记录 + 保留期清理。
// 合同 docs/节点上报.md，表结构 migrations/0017_client_nodes.sql，查询在 client-nodes-query.ts。
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { ClientNodeInput, ClientNodeReport, ClientSubInput } from '@proxysplit/contracts'
import { pgJson, type Db, type DbClient } from './telemetry-store.js'

export const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex')

/** 链接 / 订阅地址加密：AES-256-GCM，存 base64(iv12 | tag16 | 密文)。没配密钥时不存。 */
export class LinkCipher {
  private readonly key: Buffer | null
  constructor(keyBase64: string | undefined) {
    const key = keyBase64 ? Buffer.from(keyBase64, 'base64') : null
    if (key && key.length !== 32) throw new Error('NODE_LINK_KEY must be 32 bytes (base64)')
    this.key = key
  }
  get enabled() { return this.key !== null }
  encrypt(text: string): string | null {
    if (!this.key || !text) return null
    const iv = randomBytes(12)
    const c = createCipheriv('aes-256-gcm', this.key, iv)
    const body = Buffer.concat([c.update(text, 'utf8'), c.final()])
    return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64')
  }
  decrypt(enc: string): string {
    if (!this.key) throw new Error('NODE_LINK_KEY not configured')
    const raw = Buffer.from(enc, 'base64')
    const d = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12))
    d.setAuthTag(raw.subarray(12, 28))
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')
  }
}

type Row = Record<string, unknown>
export type NodeIngestContext = { accountId: string | null; now?: Date }
export type NodeIngestResult = { nodes: number; subs: number; changes: number; ignored: boolean }
type Change = { kind: 'node' | 'sub'; item_id: string; name: string; action: 'add' | 'remove' | 'update'; fields: string[] }

/** 变了算「更新」的字段（测速结果 / 当前选中天天在变，不记进时间线）。 */
const NODE_FIELDS = ['name', 'type', 'server', 'port', 'network', 'security', 'sni', 'core', 'via', 'sub_id', 'official', 'source', 'link_hash'] as const
const SUB_FIELDS = ['name', 'host', 'url_hash', 'auto_update'] as const
const FIELD_NAMES: Record<string, string> = { sub_id: 'subId', link_hash: 'link', url_hash: 'url', auto_update: 'autoUpdate' }

function nodeRow(n: ClientNodeInput, selectedId: string, cipher: LinkCipher) {
  return {
    node_id: n.id, name: n.name, type: n.type, server: n.server, port: n.port, network: n.network, security: n.security, sni: n.sni,
    core: n.core, via: n.via, sub_id: n.subId, official: n.official, source: n.source,
    latency: Math.round(n.latency), tcp_latency: Math.round(n.tcpLatency), speed: n.speed,
    link_enc: cipher.encrypt(n.link), link_hash: n.link ? sha256Hex(n.link) : '', selected: !!selectedId && n.id === selectedId,
  }
}

function subRow(s: ClientSubInput, cipher: LinkCipher) {
  return {
    sub_id: s.id, name: s.name, host: s.host, url_enc: cipher.encrypt(s.url), url_hash: s.url ? sha256Hex(s.url) : '',
    node_count: s.nodeCount, auto_update: s.autoUpdate, last_update: s.lastUpdate ?? null,
  }
}

/** 新清单对比旧行：新增 / 重新出现 = add，消失 = remove，关键字段变了 = update（只记字段名）。 */
export function diffInventory<T extends Row>(kind: 'node' | 'sub', idKey: string, fields: readonly string[], next: T[], prev: Row[]): Change[] {
  const old = new Map(prev.map(r => [String(r[idKey]), r]))
  const seen = new Set<string>()
  const out: Change[] = []
  for (const r of next) {
    const id = String(r[idKey]), o = old.get(id)
    seen.add(id)
    if (!o || o.removed_at) { out.push({ kind, item_id: id, name: String(r.name ?? ''), action: 'add', fields: [] }); continue }
    const changed = fields.filter(f => String(o[f] ?? '') !== String(r[f] ?? '')).map(f => FIELD_NAMES[f] ?? f)
    if (changed.length) out.push({ kind, item_id: id, name: String(r.name ?? ''), action: 'update', fields: changed })
  }
  for (const [id, o] of old) if (!seen.has(id) && !o.removed_at) out.push({ kind, item_id: id, name: String(o.name ?? ''), action: 'remove', fields: [] })
  return out
}

/** 同一 id 出现多次只留最后一个（ON CONFLICT 一条语句里不能撞两次）。 */
const dedupe = <T extends Row>(rows: T[], key: string) => [...new Map(rows.map(r => [String(r[key]), r])).values()]

export class ClientNodesStore {
  private warned = false
  constructor(private readonly db: Db, readonly cipher: LinkCipher, private readonly warn: (msg: string) => void = () => {}) {}

  async ingest(report: ClientNodeReport, ctx: NodeIngestContext): Promise<NodeIngestResult> {
    if (!this.cipher.enabled && !this.warned) { this.warned = true; this.warn('NODE_LINK_KEY not set: node links / subscription urls are not stored') }
    const now = (ctx.now ?? new Date()).toISOString()
    const nodes = dedupe(report.nodes.map(n => nodeRow(n, report.selectedId, this.cipher)), 'node_id')
    const subs = dedupe(report.subs.map(s => subRow(s, this.cipher)), 'sub_id')
    const client = await this.db.connect()
    try {
      await client.query('BEGIN')
      const prevNodes = await client.query(`SELECT node_id,account_id,removed_at,${NODE_FIELDS.join(',')} FROM client_nodes WHERE device_id=$1 FOR UPDATE`, [report.deviceId])
      const prevSubs = await client.query(`SELECT sub_id,removed_at,${SUB_FIELDS.join(',')} FROM client_subs WHERE device_id=$1 FOR UPDATE`, [report.deviceId])
      // 用户都是同事、设备号是 64 位不可猜的指纹：清单照收（退出登录 / 换人登录后也要继续实时）。
      // 账号只在带了有效令牌时更新，匿名上报不会清掉已绑的账号（coalesce）。
      const changes = [
        ...diffInventory('node', 'node_id', NODE_FIELDS, nodes, prevNodes.rows),
        ...diffInventory('sub', 'sub_id', SUB_FIELDS, subs, prevSubs.rows),
      ]
      await this.replaceNodes(client, report.deviceId, ctx.accountId, nodes, now)
      await this.replaceSubs(client, report.deviceId, ctx.accountId, subs, now)
      if (changes.length) {
        await client.query(`INSERT INTO client_node_changes(device_id,account_id,kind,item_id,name,action,fields,at)
          SELECT $2,$3,r.kind,r.item_id,r.name,r.action,ARRAY(SELECT jsonb_array_elements_text(r.fields)),$4
          FROM jsonb_to_recordset($1::jsonb) AS r(kind text,item_id text,name text,action text,fields jsonb)`, [pgJson(changes), report.deviceId, ctx.accountId, now])
      }
      await client.query('COMMIT')
      return { nodes: nodes.length, subs: subs.length, changes: changes.length, ignored: false }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally { client.release() }
  }

  private async replaceNodes(client: DbClient, deviceId: string, accountId: string | null, nodes: Row[], now: string) {
    if (nodes.length) {
      await client.query(`INSERT INTO client_nodes(device_id,node_id,account_id,name,type,server,port,network,security,sni,core,via,sub_id,official,source,latency,tcp_latency,speed,link_enc,link_hash,selected,first_seen,last_seen,removed_at)
        SELECT $2,r.node_id,$3,r.name,r.type,r.server,r.port,r.network,r.security,r.sni,r.core,r.via,r.sub_id,r.official,r.source,r.latency,r.tcp_latency,r.speed,r.link_enc,r.link_hash,r.selected,$4,$4,NULL
        FROM jsonb_to_recordset($1::jsonb) AS r(node_id text,name text,type text,server text,port integer,network text,security text,sni text,core text,via text,sub_id text,official boolean,source text,latency integer,tcp_latency integer,speed double precision,link_enc text,link_hash text,selected boolean)
        ON CONFLICT(device_id,node_id) DO UPDATE SET account_id=coalesce(EXCLUDED.account_id,client_nodes.account_id),name=EXCLUDED.name,type=EXCLUDED.type,
          server=EXCLUDED.server,port=EXCLUDED.port,network=EXCLUDED.network,security=EXCLUDED.security,sni=EXCLUDED.sni,core=EXCLUDED.core,via=EXCLUDED.via,
          sub_id=EXCLUDED.sub_id,official=EXCLUDED.official,source=EXCLUDED.source,latency=EXCLUDED.latency,tcp_latency=EXCLUDED.tcp_latency,speed=EXCLUDED.speed,
          link_enc=EXCLUDED.link_enc,link_hash=EXCLUDED.link_hash,selected=EXCLUDED.selected,last_seen=EXCLUDED.last_seen,removed_at=NULL`,
        [pgJson(nodes), deviceId, accountId, now])
    }
    await client.query(`UPDATE client_nodes SET removed_at=$3,selected=false WHERE device_id=$1 AND removed_at IS NULL AND NOT (node_id=ANY($2::text[]))`,
      [deviceId, nodes.map(n => n.node_id), now])
  }

  private async replaceSubs(client: DbClient, deviceId: string, accountId: string | null, subs: Row[], now: string) {
    if (subs.length) {
      await client.query(`INSERT INTO client_subs(device_id,sub_id,account_id,name,host,url_enc,url_hash,node_count,auto_update,last_update,first_seen,last_seen,removed_at)
        SELECT $2,r.sub_id,$3,r.name,r.host,r.url_enc,r.url_hash,r.node_count,r.auto_update,r.last_update,$4,$4,NULL
        FROM jsonb_to_recordset($1::jsonb) AS r(sub_id text,name text,host text,url_enc text,url_hash text,node_count integer,auto_update boolean,last_update timestamptz)
        ON CONFLICT(device_id,sub_id) DO UPDATE SET account_id=coalesce(EXCLUDED.account_id,client_subs.account_id),name=EXCLUDED.name,host=EXCLUDED.host,
          url_enc=EXCLUDED.url_enc,url_hash=EXCLUDED.url_hash,node_count=EXCLUDED.node_count,auto_update=EXCLUDED.auto_update,last_update=EXCLUDED.last_update,
          last_seen=EXCLUDED.last_seen,removed_at=NULL`,
        [pgJson(subs), deviceId, accountId, now])
    }
    await client.query(`UPDATE client_subs SET removed_at=$3 WHERE device_id=$1 AND removed_at IS NULL AND NOT (sub_id=ANY($2::text[]))`,
      [deviceId, subs.map(s => s.sub_id), now])
  }

  /** 删掉 retentionDays 之前的变化记录（分批，同 TelemetryStore.purge）。 */
  async purge(retentionDays = 90, opts: { batchSize?: number; maxBatches?: number; now?: Date } = {}) {
    const batchSize = opts.batchSize ?? 5000, maxBatches = opts.maxBatches ?? 20
    const cutoff = new Date((opts.now ?? new Date()).getTime() - retentionDays * 86_400_000).toISOString()
    let changes = 0
    for (let i = 0; i < maxBatches; i++) {
      const r = await this.db.query('DELETE FROM client_node_changes WHERE id IN (SELECT id FROM client_node_changes WHERE at<$1 ORDER BY id LIMIT $2)', [cutoff, batchSize])
      changes += r.rowCount ?? 0
      if ((r.rowCount ?? 0) < batchSize) break
    }
    // 删掉超过保留期的节点 / 订阅：只清加密链接，行留着做历史统计。
    const n = await this.db.query('UPDATE client_nodes SET link_enc=NULL WHERE removed_at<$1 AND link_enc IS NOT NULL', [cutoff])
    const s = await this.db.query('UPDATE client_subs SET url_enc=NULL WHERE removed_at<$1 AND url_enc IS NOT NULL', [cutoff])
    return { changes, clearedLinks: (n.rowCount ?? 0) + (s.rowCount ?? 0) }
  }
}
