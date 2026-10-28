// 同事节点：订阅表 + 最近变化时间线（都 3 秒刷新）。
import * as React from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { get } from '@/lib/api'
import { dt } from '@/lib/utils'
import { DataTable } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AccountCell, pagedFetcher, type RevealTarget, shortId, type SubRow } from './shared'

const fetchSubs = pagedFetcher<SubRow>('/v1/admin/client-subs')

export function SubsTab({ tick, canReveal, onReveal }: { tick: number; canReveal: boolean; onReveal: (t: RevealTarget) => void }) {
  const columns = React.useMemo<ColumnDef<SubRow, unknown>[]>(() => [
    { id: 'name', header: '订阅', cell: ({ row }) => <div><div className="font-medium">{row.original.name || '—'}</div><div className="text-xs text-muted-foreground">{row.original.host}</div></div> },
    { id: 'account', header: '账号 / 设备', cell: ({ row }) => <div><AccountCell username={row.original.username} /><div className="font-mono text-xs text-muted-foreground">{shortId(row.original.deviceId)}</div></div> },
    { id: 'count', header: '节点数', cell: ({ row }) => <span className="tabular-nums">{row.original.nodeCount}</span> },
    { id: 'auto', header: '自动更新', cell: ({ row }) => (row.original.autoUpdate ? '开' : '关') },
    { id: 'lastUpdate', header: '上次更新', cell: ({ row }) => <span className="whitespace-nowrap text-xs text-muted-foreground">{row.original.lastUpdate ? dt(row.original.lastUpdate) : '—'}</span> },
    { id: 'status', header: '状态', cell: ({ row }) => (row.original.removedAt ? <span className="text-xs text-muted-foreground">已删除</span> : <Badge variant="success">在用</Badge>) },
    { id: 'url', header: '地址', cell: ({ row }) => !row.original.hasUrl
      ? <span className="text-xs text-muted-foreground">无</span>
      : (
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">已加密</span>
          {canReveal && <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => onReveal({ kind: 'sub', deviceId: row.original.deviceId, id: row.original.subId, name: row.original.name })}>查看</Button>}
        </div>
      ) },
  ], [canReveal, onReveal])
  return (
    <DataTable<SubRow>
      columns={columns}
      fetcher={fetchSubs}
      refreshSignal={tick}
      searchPlaceholder="订阅名 / 域名 / 账号…"
      emptyText="还没有设备上报订阅"
      getRowId={(row) => `${row.deviceId}:${row.subId}`}
    />
  )
}

interface ChangeRow { id: string; deviceId: string; username: string | null; kind: 'node' | 'sub'; name: string; action: 'add' | 'remove' | 'update'; fields: string[]; at: string }
const ACTION: Record<ChangeRow['action'], string> = { add: '新增', remove: '删除', update: '修改' }

export function ChangesList({ tick }: { tick: number }) {
  const [rows, setRows] = React.useState<ChangeRow[]>([])
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    get<{ items: ChangeRow[] }>('/v1/admin/client-nodes/changes?limit=100').then((r) => { setRows(r.items); setError('') }, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [tick])
  if (error) return <div className="text-sm text-destructive">{error}</div>
  if (!rows.length) return <div className="py-6 text-center text-sm text-muted-foreground">暂无变化</div>
  return (
    <div className="divide-y rounded-md border">
      {rows.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
          <span className="w-[150px] shrink-0 text-xs text-muted-foreground">{dt(r.at)}</span>
          <Badge variant={r.action === 'remove' ? 'destructive' : r.action === 'add' ? 'success' : 'secondary'}>{ACTION[r.action]}{r.kind === 'sub' ? '订阅' : '节点'}</Badge>
          <span className="font-medium">{r.name || '—'}</span>
          {r.action === 'update' && r.fields.length > 0 && <span className="text-xs text-muted-foreground">改了 {r.fields.join('、')}</span>}
          <span className="ml-auto text-xs text-muted-foreground">{r.username ?? '未登录'} · <span className="font-mono">{shortId(r.deviceId)}</span></span>
        </div>
      ))}
    </div>
  )
}
