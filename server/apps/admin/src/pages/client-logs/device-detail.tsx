// 客户端设备详情（大弹框，T14 的弹框档）：事件时间线（每页 50，展开看 payload）+ 运行日志（每页 10，服务端按时间窗搜索）。
import * as React from 'react'
import {
  CellDate, CellText, Choice, DataTable, DateTimePicker, Dialog, QueryBar, StatusBadge, Tabs, type Column,
} from '@ankotti/admin-ui'
import { CodeBlock, JsonViewer } from '@ankotti/admin-ui/display'
import { get } from '@/lib/api'
import { localToIso } from '@/lib/dates'
import { useServerList } from '@/lib/list'
import { TIMELINE_TYPES, eventLabel, eventOptions, statusBadge, type EventRow, type LogChunkRow } from './shared'

type DeviceInfo = { device_id: string; username?: string | null; os?: string; app_version?: string }

export function DeviceDetail({ deviceId, onClose }: { deviceId: string | null; onClose: () => void }) {
  const [info, setInfo] = React.useState<DeviceInfo | null>(null)
  const [tab, setTab] = React.useState('events')
  React.useEffect(() => {
    setInfo(null)
    setTab('events')
    if (!deviceId) return
    const ctl = new AbortController()
    get<DeviceInfo>(`/v1/admin/telemetry/devices/${deviceId}`, ctl.signal).then(setInfo).catch(() => undefined)
    return () => ctl.abort()
  }, [deviceId])
  const summary = info ? ` · ${info.username ?? '未登录'} · v${info.app_version ?? '?'} · ${info.os ?? ''}` : ''
  return (
    <Dialog open={!!deviceId} onClose={onClose} size="xl" title="客户端设备" description={`${deviceId ?? ''}${summary}`}>
      {deviceId && (
        <Tabs label="设备详情" value={tab} onValueChange={setTab}
          items={[{ value: 'events', label: '事件时间线' }, { value: 'logs', label: '运行日志' }]}>
          {tab === 'events' ? <EventsTable key={deviceId} deviceId={deviceId} /> : <LogsTable key={deviceId} deviceId={deviceId} />}
        </Tabs>
      )}
    </Dialog>
  )
}

function EventsTable({ deviceId }: { deviceId: string }) {
  const [expanded, setExpanded] = React.useState<string[]>([])
  const list = useServerList<EventRow, { status: string; type: string }>(`/v1/admin/telemetry/devices/${deviceId}/events`, {
    filters: { status: '', type: '' }, pageSize: 50,
  })
  const columns: Column<EventRow>[] = [
    { key: 'ts', title: '时间', width: 150, render: (r) => <CellDate value={r.ts} time /> },
    { key: 'type', title: '事件', maxWidth: 200, mobile: 'primary', truncate: (r) => eventLabel(r.type), render: (r) => <CellText primary={eventLabel(r.type)} secondary={r.type} /> },
    { key: 'status', title: '结果', width: 80, render: (r) => { const s = statusBadge(r.status); return <StatusBadge tone={s.tone}>{s.label}</StatusBadge> } },
    { key: 'dur', title: '耗时', width: 90, numeric: true, render: (r) => (r.durationMs !== null ? `${r.durationMs} ms` : '—') },
    { key: 'error', title: '错误 / 详情', maxWidth: 420, truncate: (r) => `${r.errorCode ?? ''} ${r.errorText ?? ''}`.trim() || '—',
      render: (r) => <CellText primary={r.errorCode ?? '—'} secondary={r.errorText ?? undefined} /> },
  ]
  return (
    <>
      <QueryBar {...list.queryBar} variant="flush" placeholder="搜索错误文本 / 事件类型">
        <Choice label="结果" size="sm" clearable placeholder="全部结果" value={list.query.filters.status} onChange={(v) => list.setFilter('status', v)}
          options={[{ value: 'fail', label: '失败' }, { value: 'ok', label: '成功' }, { value: 'info', label: '信息' }]} />
        <Choice label="事件" size="sm" clearable placeholder="全部事件" value={list.query.filters.type} onChange={(v) => list.setFilter('type', v)} options={eventOptions(TIMELINE_TYPES)} />
      </QueryBar>
      <DataTable caption="事件时间线" columns={columns} rowKey={(r) => r.id} rowHeight="medium" emptyLabel="没有事件" {...list.table}
        expandable={{ expanded, onExpandedChange: setExpanded, label: (r) => `展开 ${eventLabel(r.type)} 的载荷`,
          render: (r) => <JsonViewer value={r.payload} label="事件载荷" rootName="payload" defaultExpandDepth={2} maxHeight={320} /> }} />
    </>
  )
}

function LogsTable({ deviceId }: { deviceId: string }) {
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const list = useServerList<LogChunkRow, Record<string, string>>(`/v1/admin/telemetry/devices/${deviceId}/logs`, {
    filters: {}, pageSize: 10, extra: { from: localToIso(from), to: localToIso(to) },
  })
  const columns: Column<LogChunkRow>[] = [
    { key: 'range', title: '时间段', width: 170, render: (r) => <CellText primary={<CellDate value={r.startedAt} time />} secondary={`${r.lineCount} 行`} /> },
    { key: 'text', title: '内容', render: (r) => {
      const body = r.matches ? r.matches.join('\n') || '（无命中行）' : r.text ?? ''
      return <CodeBlock code={body} label={r.matches ? '命中的日志行' : '日志内容'} language="text" maxHeight={360} defaultWrap />
    } },
  ]
  return (
    <>
      <QueryBar {...list.queryBar} variant="flush" searchMode="enter" placeholder="在时间窗内搜索日志（默认最近 24 小时，最长 7 天）">
        <DateTimePicker size="sm" aria-label="起" placeholder="起" clearable value={from} onChange={setFrom} />
        <DateTimePicker size="sm" aria-label="止" placeholder="止" clearable value={to} onChange={setTo} />
      </QueryBar>
      <DataTable caption="运行日志" columns={columns} rowKey={(r) => r.id} rowHeight="auto" mobile="table" emptyLabel="这个时间窗内没有日志" {...list.table} />
    </>
  )
}
