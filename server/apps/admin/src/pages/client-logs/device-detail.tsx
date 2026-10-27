import * as React from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { get, listApi } from '@/lib/api'
import { dt } from '@/lib/utils'
import { DataTable } from '@/components/data-table'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { type EventRow, eventLabel, type LogChunkRow, StatusBadge, toIso } from './shared'

type Device = Record<string, unknown> & { device_id: string; username?: string | null; os?: string; app_version?: string }

/** 设备详情：事件时间线 + 日志搜索（服务端 ILIKE，限时间窗）。 */
export function DeviceDetail({ deviceId, onClose }: { deviceId: string | null; onClose: () => void }) {
  const [device, setDevice] = React.useState<Device | null>(null)
  React.useEffect(() => {
    setDevice(null)
    if (deviceId) get<Device>(`/v1/admin/telemetry/devices/${deviceId}`).then(setDevice).catch(() => setDevice(null))
  }, [deviceId])
  return (
    <Dialog open={!!deviceId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>客户端设备</DialogTitle>
          <DialogDescription className="break-all font-mono text-xs">
            {deviceId} {device && `· ${device.username ?? '未登录'} · v${device.app_version ?? '?'} · ${device.os ?? ''}`}
          </DialogDescription>
        </DialogHeader>
        {deviceId && (
          <Tabs defaultValue="events">
            <TabsList>
              <TabsTrigger value="events">事件时间线</TabsTrigger>
              <TabsTrigger value="logs">运行日志</TabsTrigger>
            </TabsList>
            <TabsContent value="events"><EventsTable deviceId={deviceId} /></TabsContent>
            <TabsContent value="logs"><LogsTable deviceId={deviceId} /></TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}

function EventsTable({ deviceId }: { deviceId: string }) {
  const [open, setOpen] = React.useState<string | null>(null)
  const columns = React.useMemo<ColumnDef<EventRow, unknown>[]>(
    () => [
      { id: 'ts', header: '时间', cell: ({ row }) => <span className="whitespace-nowrap text-xs text-muted-foreground">{dt(row.original.ts)}</span> },
      {
        id: 'type',
        header: '事件',
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{eventLabel(row.original.type)}</div>
            <div className="font-mono text-xs text-muted-foreground">{row.original.type}</div>
          </div>
        ),
      },
      { id: 'status', header: '结果', cell: ({ row }) => <StatusBadge value={row.original.status} /> },
      { id: 'dur', header: '耗时', cell: ({ row }) => <span className="text-xs tabular-nums">{row.original.durationMs != null ? `${row.original.durationMs} ms` : '—'}</span> },
      {
        id: 'error',
        header: '错误 / 详情',
        cell: ({ row }) => {
          const r = row.original
          const expanded = open === r.id
          return (
            <button type="button" className="block max-w-[420px] text-left text-xs" onClick={() => setOpen(expanded ? null : r.id)}>
              {r.errorCode && <span className="mr-1 font-mono text-destructive">{r.errorCode}</span>}
              <span className={expanded ? 'whitespace-pre-wrap break-all' : 'line-clamp-1 break-all text-muted-foreground'}>
                {r.errorText ?? ''} {expanded ? `\n${JSON.stringify(r.payload, null, 2)}` : JSON.stringify(r.payload)}
              </span>
            </button>
          )
        },
      },
    ],
    [open],
  )
  return (
    <DataTable<EventRow>
      columns={columns}
      fetcher={(q) => listApi<EventRow>(`/v1/admin/telemetry/devices/${deviceId}/events`, { q: q.q, limit: q.limit, offset: q.offset, ...q.filters })}
      searchPlaceholder="搜索错误文本 / 事件类型…"
      pageSize={50}
      emptyText="没有事件"
      getRowId={(r) => r.id}
      filters={[
        { key: 'status', label: '结果', options: [{ label: '失败', value: 'fail' }, { label: '成功', value: 'ok' }, { label: '信息', value: 'info' }] },
        { key: 'type', label: '事件', options: ['proxy.start', 'tun.create', 'core.exit', 'core.fatal', 'node.latency', 'sub.update', 'app.crash', 'env.security', 'settings.change'].map((v) => ({ label: eventLabel(v), value: v })) },
      ]}
    />
  )
}

function LogsTable({ deviceId }: { deviceId: string }) {
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const extraParams = React.useMemo(() => ({ from: toIso(from), to: toIso(to) }), [from, to])
  const columns = React.useMemo<ColumnDef<LogChunkRow, unknown>[]>(
    () => [
      {
        id: 'range',
        header: '时间段',
        cell: ({ row }) => (
          <div className="whitespace-nowrap text-xs text-muted-foreground">
            {dt(row.original.startedAt)}
            <div>{row.original.lineCount} 行</div>
          </div>
        ),
      },
      {
        id: 'text',
        header: '内容',
        cell: ({ row }) => (
          <pre className="max-h-[360px] max-w-[760px] overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-2 font-mono text-[11px]">
            {row.original.matches ? row.original.matches.join('\n') || '（无命中行）' : row.original.text}
          </pre>
        ),
      },
    ],
    [],
  )
  return (
    <DataTable<LogChunkRow>
      columns={columns}
      fetcher={(q) => listApi<LogChunkRow>(`/v1/admin/telemetry/devices/${deviceId}/logs`, { q: q.q, limit: q.limit, offset: q.offset, ...q.filters })}
      searchPlaceholder="在时间窗内搜索日志（默认最近 24 小时，最长 7 天）…"
      extraParams={extraParams}
      pageSize={10}
      emptyText="这个时间窗内没有日志"
      getRowId={(r) => r.id}
      toolbar={
        <div className="flex items-center gap-1">
          <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[190px]" title="起" />
          <span className="text-muted-foreground">–</span>
          <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-[190px]" title="止" />
        </div>
      }
    />
  )
}
