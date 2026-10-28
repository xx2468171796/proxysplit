// 同事节点：共享类型、3 秒刷新钩子、查看链接弹窗（接口见 server/apps/api/src/client-nodes-routes.ts，合同 docs/节点上报.md）。
import * as React from 'react'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { listApi, post } from '@/lib/api'
import type { DataTableQuery } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

export const REFRESH_MS = 3000

/** 每 3 秒加一，传给 DataTable.refreshSignal / 统计条（页面在后台时不刷）。 */
export function useTicker(ms = REFRESH_MS) {
  const [tick, setTick] = React.useState(0)
  React.useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') setTick((t) => t + 1) }, ms)
    return () => clearInterval(id)
  }, [ms])
  return tick
}

export interface NodeRow {
  deviceId: string
  nodeId: string
  accountId: string | null
  username: string | null
  accountHint: string | null
  name: string
  type: string
  server: string
  port: number
  network: string
  security: string
  sni: string
  core: string
  via: string
  subId: string
  official: boolean
  source: string
  latency: number
  tcpLatency: number
  speed: number
  hasLink: boolean
  selected: boolean
  firstSeen: string
  lastSeen: string
  removedAt: string | null
}

export interface SubRow {
  deviceId: string
  subId: string
  username: string | null
  name: string
  host: string
  hasUrl: boolean
  nodeCount: number
  autoUpdate: boolean
  lastUpdate: string | null
  lastSeen: string
  removedAt: string | null
}

export interface Bucket { key: string; nodes: number; devices: number; dead?: number }
export interface Stats {
  devices: number
  nodes: number
  subs: number
  dead: number
  deadRate: number
  changes24h: number
  byType: Bucket[]
  byServer: Bucket[]
  canReveal: boolean
}

export const shortId = (id: string) => `${id.slice(0, 8)}…`

/** 后台按 page / pageSize 分页，DataTable 给的是 limit / offset。 */
export function pagedFetcher<T>(path: string) {
  return async (query: DataTableQuery) => {
    const res = await listApi<T>(path, { q: query.q, page: Math.floor(query.offset / query.limit) + 1, pageSize: query.limit, ...query.filters })
    return { items: res.items, total: res.total, limit: query.limit, offset: query.offset }
  }
}

export function AccountCell({ username, hint }: { username: string | null; hint?: string | null }) {
  if (username) return <span className="font-medium">{username}</span>
  if (hint) return <span className="text-muted-foreground" title="客户端自报，未核实">{hint}?</span>
  return <span className="text-muted-foreground">未登录</span>
}

export type RevealTarget = { kind: 'node'; deviceId: string; id: string; name: string } | { kind: 'sub'; deviceId: string; id: string; name: string }

/** 超管查看链接：打开时才请求解密（每次都记审计）。 */
export function RevealDialog({ target, onClose }: { target: RevealTarget | null; onClose: () => void }) {
  const [value, setValue] = React.useState<string | null>(null)
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    setValue(null)
    setError('')
    if (!target) return
    const req = target.kind === 'node'
      ? post<{ link: string | null }>('/v1/admin/client-nodes/reveal', { deviceId: target.deviceId, nodeId: target.id }).then((r) => r.link)
      : post<{ url: string | null }>('/v1/admin/client-subs/reveal', { deviceId: target.deviceId, subId: target.id }).then((r) => r.url)
    req.then((v) => setValue(v ?? '')).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [target])
  const copy = () => {
    if (!value) return
    void navigator.clipboard.writeText(value).then(() => toast.success('已复制'), () => toast.error('复制失败'))
  }
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{target?.kind === 'sub' ? '订阅地址' : '节点链接'}：{target?.name}</DialogTitle>
          <DialogDescription>这次查看已记入审计日志。</DialogDescription>
        </DialogHeader>
        {error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : value === null ? (
          <div className="text-sm text-muted-foreground">正在解密…</div>
        ) : value === '' ? (
          <div className="text-sm text-muted-foreground">没有保存链接（官方线路，或服务器没配加密密钥）。</div>
        ) : (
          <div className="space-y-2">
            <Textarea readOnly value={value} className="min-h-[120px] font-mono text-xs" />
            <Button size="sm" onClick={copy}><Copy className="mr-1 h-4 w-4" />复制</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
