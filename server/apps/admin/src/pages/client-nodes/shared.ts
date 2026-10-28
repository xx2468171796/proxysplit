// 同事节点：共享类型与显示规则（接口见 server/apps/api/src/client-nodes-routes.ts，合同 docs/节点上报.md）。
export const REFRESH_MS = 3000

export type NodeRow = {
  deviceId: string; nodeId: string; accountId: string | null; username: string | null; accountHint: string | null
  name: string; type: string; server: string; port: number; network: string; security: string; sni: string; core: string
  via: string; subId: string; official: boolean; source: string; latency: number; tcpLatency: number; speed: number
  hasLink: boolean; selected: boolean; firstSeen: string; lastSeen: string; removedAt: string | null
}

export type SubRow = {
  deviceId: string; subId: string; username: string | null; name: string; host: string; hasUrl: boolean
  nodeCount: number; autoUpdate: boolean; lastUpdate: string | null; lastSeen: string; removedAt: string | null
}

export type Bucket = { key: string; nodes: number; devices: number; dead?: number }
export type Stats = {
  devices: number; nodes: number; subs: number; dead: number; deadRate: number; changes24h: number
  byType: Bucket[]; byServer: Bucket[]; canReveal: boolean
}

export type ChangeRow = { id: string; deviceId: string; username: string | null; kind: 'node' | 'sub'; name: string; action: 'add' | 'remove' | 'update'; fields: string[]; at: string }

export type RevealTarget = { kind: 'node' | 'sub'; deviceId: string; id: string; name: string }

export const NODE_TYPES = ['vless', 'vmess', 'trojan', 'shadowsocks', 'socks', 'http', 'hysteria2', 'tuic', 'anytls', 'wireguard', 'raw']

export const shortId = (id: string) => `${id.slice(0, 8)}…`

export function accountText(username: string | null, hint?: string | null) {
  if (username) return username
  return hint ? `${hint}?（客户端自报，未核实）` : '未登录'
}

export function nodeSource(r: Pick<NodeRow, 'source' | 'official' | 'via'>) {
  const src = r.source === 'sub' ? '订阅' : r.source === 'official' || r.official ? '官方' : '手动'
  return r.via ? `${src} · 有前置` : src
}

/** 延迟：< 0 不通，0 未测，其余毫秒。 */
export function latencyText(ms: number): { text: string; dead: boolean } {
  if (ms < 0) return { text: '不通', dead: true }
  if (ms === 0) return { text: '未测', dead: false }
  return { text: `${ms} ms`, dead: false }
}
