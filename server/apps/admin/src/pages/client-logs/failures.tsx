import * as React from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { listApi } from '@/lib/api'
import { dt } from '@/lib/utils'
import { DataTable } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { eventLabel, shortId } from './shared'

interface FailureRow {
  type: string
  errorCode: string
  count: number
  devices: number
  lastAt: string
  sampleText: string | null
  sampleDevice: string
  versions: string[] | null
}

/** 最近失败：按（事件, 错误码）分组，点样例设备看详情。 */
export function FailuresTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [days, setDays] = React.useState('7')
  const [version, setVersion] = React.useState('')
  const extraParams = React.useMemo(() => ({ days, version: version.trim() }), [days, version])
  const columns = React.useMemo<ColumnDef<FailureRow, unknown>[]>(
    () => [
      { id: 'type', header: '事件', cell: ({ row }) => <span className="font-medium">{eventLabel(row.original.type)}</span> },
      { id: 'code', header: '错误码', cell: ({ row }) => <Badge variant="destructive">{row.original.errorCode}</Badge> },
      { id: 'count', header: '次数 / 设备', cell: ({ row }) => <span className="tabular-nums">{row.original.count} / {row.original.devices}</span> },
      { id: 'versions', header: '版本', cell: ({ row }) => <span className="text-xs">{(row.original.versions ?? []).join(', ')}</span> },
      { id: 'sample', header: '最近一条', cell: ({ row }) => <span className="line-clamp-2 max-w-[360px] break-all text-xs text-muted-foreground" title={row.original.sampleText ?? ''}>{row.original.sampleText ?? '—'}</span> },
      {
        id: 'device',
        header: '样例设备',
        cell: ({ row }) => (
          <button type="button" className="font-mono text-xs hover:underline" onClick={() => onOpen(row.original.sampleDevice)}>
            {shortId(row.original.sampleDevice)}
          </button>
        ),
      },
      { id: 'lastAt', header: '最近', cell: ({ row }) => <span className="whitespace-nowrap text-xs text-muted-foreground">{dt(row.original.lastAt)}</span> },
    ],
    [onOpen],
  )
  return (
    <DataTable<FailureRow>
      columns={columns}
      fetcher={(q) => listApi<FailureRow>('/v1/admin/telemetry/failures', { q: q.q, limit: q.limit, offset: q.offset, ...q.filters })}
      searchPlaceholder="搜索错误文本…"
      extraParams={extraParams}
      emptyText="这段时间没有失败上报"
      getRowId={(r) => `${r.type}|${r.errorCode}`}
      filters={[{ key: 'type', label: '事件', options: ['proxy.start', 'tun.create', 'core.fatal', 'node.latency', 'sub.update', 'app.update', 'app.crash', 'net.blocked'].map((v) => ({ label: eventLabel(v), value: v })) }]}
      toolbar={
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">最近</span>
          <Input type="number" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} className="h-9 w-[80px]" />
          <span className="text-sm text-muted-foreground">天</span>
          <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="版本" className="h-9 w-[120px]" />
        </div>
      }
    />
  )
}
