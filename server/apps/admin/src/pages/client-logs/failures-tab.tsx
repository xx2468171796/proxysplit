// 客户端日志 · 最近失败（T02 列表）：按（事件, 错误码）分组，点样例设备看详情。
import * as React from 'react'
import {
  CellDate, CellLongText, CellText, Choice, DataTable, Input, Link, NumberInput, PageHeader, QueryBar, ResourcePanel,
  type Column,
} from '@ankotti/admin-ui'
import { useServerList } from '@/lib/list'
import { FAILURE_TYPES, eventLabel, eventOptions, shortId } from './shared'

type FailureRow = {
  type: string; errorCode: string; count: number; devices: number; lastAt: string
  sampleText: string | null; sampleDevice: string; versions: string[] | null
}

export function FailuresTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [days, setDays] = React.useState<number | null>(7)
  const [version, setVersion] = React.useState('')
  const list = useServerList<FailureRow, { type: string }>('/v1/admin/telemetry/failures', {
    filters: { type: '' },
    extra: { days: Math.min(60, Math.max(1, days ?? 7)), version: version.trim() },
  })

  const columns: Column<FailureRow>[] = [
    { key: 'type', title: '事件 / 错误码', maxWidth: 240, mobile: 'primary', truncate: (r) => `${eventLabel(r.type)} ${r.errorCode}`,
      render: (r) => <CellText primary={eventLabel(r.type)} secondary={r.errorCode} /> },
    { key: 'count', title: '次数 / 设备', width: 110, numeric: true, render: (r) => `${r.count} / ${r.devices}` },
    { key: 'versions', title: '版本', maxWidth: 180, truncate: (r) => (r.versions ?? []).join(', '), render: (r) => (r.versions ?? []).join(', ') || '—' },
    { key: 'sample', title: '最近一条', maxWidth: 360, render: (r) => <CellLongText text={r.sampleText ?? '—'} /> },
    { key: 'device', title: '样例设备', width: 140, render: (r) => (
      <Link href="#" onClick={(e) => { e.preventDefault(); onOpen(r.sampleDevice) }}>{shortId(r.sampleDevice)}</Link>
    ) },
    { key: 'lastAt', title: '最近', width: 150, render: (r) => <CellDate value={r.lastAt} time /> },
  ]

  return (
    <>
      <PageHeader title="最近失败" description="最近 N 天（1–60）客户端上报的失败事件，按事件和错误码合并；点样例设备看它的事件时间线和日志。" />
      <ResourcePanel title="最近失败" {...list.panel} unit="组"
        filters={
          <QueryBar {...list.queryBar} placeholder="搜索错误文本">
            <Choice label="事件" size="sm" clearable placeholder="全部事件" value={list.query.filters.type} onChange={(v) => list.setFilter('type', v)} options={eventOptions(FAILURE_TYPES)} />
            <NumberInput size="sm" aria-label="最近天数" value={days} onChange={setDays} min={1} max={60} unit="天" />
            <Input size="sm" width={120} aria-label="版本" placeholder="版本" clearable onClear={() => setVersion('')} value={version} onChange={(e) => setVersion(e.target.value)} />
          </QueryBar>
        }>
        <DataTable caption="最近失败" columns={columns} rowKey={(r) => `${r.type}|${r.errorCode}`} rowHeight="medium" emptyLabel="这段时间没有失败上报" {...list.table} />
      </ResourcePanel>
    </>
  )
}
