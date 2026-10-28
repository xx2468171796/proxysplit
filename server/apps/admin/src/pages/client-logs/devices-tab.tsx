// 客户端日志 · 设备（T02 列表）：版本 / 最近启动结果 / 账号 / 最近上报时间筛选，点设备看详情。
import * as React from 'react'
import { Eye } from 'lucide-react'
import {
  CellDate, CellText, Choice, DataTable, DateRangePicker, Input, Link, PageHeader, QueryBar, ResourcePanel, RowActionBar,
  StatusBadge, dateRangePresets, type Column, type DateRangeValue,
} from '@ankotti/admin-ui'
import { useServerList } from '@/lib/list'
import { EMPTY_RANGE, rangeParams } from '@/lib/dates'
import { kb, shortId, statusBadge, type TelemetryDeviceRow } from './shared'

const PRESETS = dateRangePresets(['today', 'last7', 'last30'])

export function useDebounced(value: string, ms = 300) {
  const [v, setV] = React.useState(value)
  React.useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

function accountText(r: TelemetryDeviceRow) {
  if (r.username) return r.username
  return r.accountHint ? `${r.accountHint}?（客户端自报，未核实）` : '未登录'
}

export function DevicesTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [version, setVersion] = React.useState('')
  const [accountInput, setAccountInput] = React.useState('')
  const account = useDebounced(accountInput.trim())
  const [range, setRange] = React.useState<DateRangeValue>(EMPTY_RANGE)
  const list = useServerList<TelemetryDeviceRow, { lastStatus: string }>('/v1/admin/telemetry/devices', {
    filters: { lastStatus: '' },
    extra: { version: version.trim(), account, ...rangeParams(range, 'from', 'to') },
  })

  const columns: Column<TelemetryDeviceRow>[] = [
    { key: 'device', title: '设备', width: 150, mobile: 'primary', truncate: (r) => r.deviceId,
      render: (r) => <Link href="#" onClick={(e) => { e.preventDefault(); onOpen(r.deviceId) }}>{shortId(r.deviceId)}</Link> },
    { key: 'account', title: '账号', maxWidth: 200, truncate: accountText, render: accountText },
    { key: 'version', title: '版本', width: 100, render: (r) => `v${r.appVersion || '?'}` },
    { key: 'os', title: '系统', maxWidth: 220, truncate: (r) => r.os || '—', render: (r) => r.os || '—' },
    { key: 'status', title: '最近启动', width: 150, render: (r) => {
      const s = statusBadge(r.lastStatus, '未启动')
      return <CellText primary={<StatusBadge tone={s.tone}>{s.label}</StatusBadge>} secondary={r.lastErrorCode ?? undefined} />
    } },
    { key: 'lastSeen', title: '最近上报', width: 150, render: (r) => <CellDate value={r.lastSeen} time /> },
    { key: 'volume', title: '事件 / 日志', width: 120, numeric: true, render: (r) => `${r.eventsCount} / ${kb(Number(r.logBytes))}` },
    { key: 'actions', title: '操作', kind: 'actions', render: (r) => (
      <RowActionBar label={`设备 ${shortId(r.deviceId)} 的更多操作`} actions={[{ key: 'open', label: '详情', icon: <Eye />, onSelect: () => onOpen(r.deviceId) }]} />
    ) },
  ]

  return (
    <>
      <PageHeader title="设备" description="客户端上报过日志的设备。账号带「?」的是客户端自报、未核实；时间范围按最近上报时间筛。" />
      <ResourcePanel title="客户端设备" {...list.panel} unit="台"
        filters={
          <QueryBar {...list.queryBar} placeholder="设备 ID / 系统 / IP">
            <Choice label="最近启动" size="sm" clearable placeholder="全部启动结果" value={list.query.filters.lastStatus} onChange={(v) => list.setFilter('lastStatus', v)}
              options={[{ value: 'fail', label: '失败' }, { value: 'ok', label: '成功' }, { value: 'info', label: '未启动' }]} />
            <Input size="sm" width={130} aria-label="版本" placeholder="版本，如 1.9.96" clearable onClear={() => setVersion('')} value={version} onChange={(e) => setVersion(e.target.value)} />
            <Input size="sm" width={130} aria-label="账号" placeholder="账号" clearable onClear={() => setAccountInput('')} value={accountInput} onChange={(e) => setAccountInput(e.target.value)} />
            <DateRangePicker size="sm" aria-label="最近上报时间" value={range} onChange={setRange} presets={PRESETS} />
          </QueryBar>
        }>
        <DataTable caption="客户端设备" columns={columns} rowKey={(r) => r.deviceId} emptyLabel="暂无客户端上报" {...list.table} />
      </ResourcePanel>
    </>
  )
}
