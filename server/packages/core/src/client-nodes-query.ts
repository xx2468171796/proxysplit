// 同事节点上报：后台列表 / 统计 / 变化 / 解密（分页、限条数，不在循环里查库）。列表永远不带链接密文。
import type { ClientNodeChangesQuery, ClientNodeListQuery, ClientSubListQuery } from '@proxysplit/contracts'
import type { Db } from './telemetry-store.js'
import type { LinkCipher } from './client-nodes-store.js'

type Row = Record<string, unknown>
export type NodePage = { items: Row[]; total: number; page: number; pageSize: number }
/** found=false：没有这一行；link=null：这一行没存链接（没配密钥 / 官方线路）。 */
export type RevealResult = { found: boolean; link: string | null }

const likeEscape = (s: string) => s.replace(/[\\%_]/g, m => '\\' + m)

function toPage(rows: Row[], page: number, pageSize: number): NodePage {
  const total = rows[0] ? Number(rows[0].totalCount) : 0
  return { items: rows.map(({ totalCount: _t, ...rest }) => rest), total, page, pageSize }
}

export class ClientNodesQuery {
  constructor(private readonly db: Db, private readonly cipher: LinkCipher) {}

  async listNodes(p: ClientNodeListQuery): Promise<NodePage> {
    const conds: string[] = [], vals: unknown[] = []
    const add = (sql: string, v: unknown) => { vals.push(v); conds.push(sql.replaceAll('$?', `$${vals.length}`)) }
    if (p.status === 'alive') conds.push('n.removed_at IS NULL')
    if (p.status === 'removed') conds.push('n.removed_at IS NOT NULL')
    if (p.dead) conds.push('n.latency<0')
    if (p.type) add('n.type=$?', p.type)
    if (p.deviceId) add('n.device_id = $?', p.deviceId)
    if (p.accountId) add('n.account_id=$?', p.accountId)
    if (p.q) add('(n.name ILIKE $? OR n.server ILIKE $? OR u.username ILIKE $? OR d.account_hint ILIKE $?)', `%${likeEscape(p.q)}%`)
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
    vals.push(p.pageSize, (p.page - 1) * p.pageSize)
    const r = await this.db.query(`SELECT n.device_id AS "deviceId",n.node_id AS "nodeId",n.account_id AS "accountId",u.username,d.account_hint AS "accountHint",
      n.name,n.type,n.server,n.port,n.network,n.security,n.sni,n.core,n.via,n.sub_id AS "subId",n.official,n.source,n.latency,n.tcp_latency AS "tcpLatency",n.speed,
      (n.link_enc IS NOT NULL) AS "hasLink",n.link_hash AS "linkHash",n.selected,n.first_seen AS "firstSeen",n.last_seen AS "lastSeen",n.removed_at AS "removedAt",
      (count(*) OVER())::int AS "totalCount"
      FROM client_nodes n LEFT JOIN users u ON u.id=n.account_id LEFT JOIN client_devices d ON d.device_id=n.device_id ${where}
      ORDER BY n.removed_at IS NOT NULL,n.last_seen DESC,n.device_id,n.node_id LIMIT $${vals.length - 1} OFFSET $${vals.length}`, vals)
    return toPage(r.rows, p.page, p.pageSize)
  }

  async listSubs(p: ClientSubListQuery): Promise<NodePage> {
    const conds: string[] = [], vals: unknown[] = []
    const add = (sql: string, v: unknown) => { vals.push(v); conds.push(sql.replaceAll('$?', `$${vals.length}`)) }
    if (p.deviceId) add('s.device_id = $?', p.deviceId)
    if (p.q) add('(s.name ILIKE $? OR s.host ILIKE $? OR u.username ILIKE $?)', `%${likeEscape(p.q)}%`)
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
    vals.push(p.pageSize, (p.page - 1) * p.pageSize)
    const r = await this.db.query(`SELECT s.device_id AS "deviceId",s.sub_id AS "subId",s.account_id AS "accountId",u.username,s.name,s.host,
      (s.url_enc IS NOT NULL) AS "hasUrl",s.node_count AS "nodeCount",s.auto_update AS "autoUpdate",s.last_update AS "lastUpdate",
      s.first_seen AS "firstSeen",s.last_seen AS "lastSeen",s.removed_at AS "removedAt",(count(*) OVER())::int AS "totalCount"
      FROM client_subs s LEFT JOIN users u ON u.id=s.account_id ${where}
      ORDER BY s.removed_at IS NOT NULL,s.last_seen DESC,s.device_id,s.sub_id LIMIT $${vals.length - 1} OFFSET $${vals.length}`, vals)
    return toPage(r.rows, p.page, p.pageSize)
  }

  async changes(p: ClientNodeChangesQuery) {
    const vals: unknown[] = []
    let where = ''
    if (p.deviceId) { vals.push(p.deviceId); where = 'WHERE c.device_id = $1' }
    vals.push(p.limit)
    const r = await this.db.query(`SELECT c.id::text,c.device_id AS "deviceId",c.account_id AS "accountId",u.username,c.kind,c.item_id AS "itemId",c.name,c.action,c.fields,c.at
      FROM client_node_changes c LEFT JOIN users u ON u.id=c.account_id ${where} ORDER BY c.at DESC,c.id DESC LIMIT $${vals.length}`, vals)
    return { items: r.rows }
  }

  /** 实时汇总：固定几条聚合，并发查询。 */
  async stats() {
    const since = new Date(Date.now() - 86_400_000).toISOString()
    const [totals, byType, byServer, changes] = await Promise.all([
      this.db.query(`SELECT count(DISTINCT device_id)::int AS devices,count(*)::int AS nodes,count(*) FILTER (WHERE latency<0)::int AS dead,
        count(*) FILTER (WHERE latency<>0)::int AS tested,(SELECT count(*)::int FROM client_subs WHERE removed_at IS NULL) AS subs
        FROM client_nodes WHERE removed_at IS NULL`),
      this.db.query(`SELECT type AS key,count(*)::int AS nodes,count(DISTINCT device_id)::int AS devices FROM client_nodes WHERE removed_at IS NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 20`),
      this.db.query(`SELECT server AS key,count(*)::int AS nodes,count(DISTINCT device_id)::int AS devices,count(*) FILTER (WHERE latency<0)::int AS dead
        FROM client_nodes WHERE removed_at IS NULL AND server<>'' GROUP BY 1 ORDER BY 3 DESC,2 DESC LIMIT 20`),
      this.db.query(`SELECT count(*)::int AS n FROM client_node_changes WHERE at>=$1`, [since]),
    ])
    const t = totals.rows[0] ?? {}
    const tested = Number(t.tested ?? 0), dead = Number(t.dead ?? 0)
    return {
      devices: Number(t.devices ?? 0), nodes: Number(t.nodes ?? 0), subs: Number(t.subs ?? 0), dead,
      deadRate: tested ? Math.round((1000 * dead) / tested) / 10 : 0,
      changes24h: Number(changes.rows[0]?.n ?? 0), byType: byType.rows, byServer: byServer.rows,
    }
  }

  async revealNode(deviceId: string, nodeId: string): Promise<RevealResult> {
    const r = await this.db.query('SELECT link_enc FROM client_nodes WHERE device_id=$1 AND node_id=$2', [deviceId, nodeId])
    return this.open(r.rows[0], 'link_enc')
  }

  async revealSub(deviceId: string, subId: string): Promise<RevealResult> {
    const r = await this.db.query('SELECT url_enc FROM client_subs WHERE device_id=$1 AND sub_id=$2', [deviceId, subId])
    return this.open(r.rows[0], 'url_enc')
  }

  private open(row: Row | undefined, col: string): RevealResult {
    if (!row) return { found: false, link: null }
    const enc = row[col]
    if (typeof enc !== 'string' || !enc || !this.cipher.enabled) return { found: true, link: null }
    return { found: true, link: this.cipher.decrypt(enc) }
  }
}
