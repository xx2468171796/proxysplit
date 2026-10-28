// 审计日志（T06 日志页，表格形态：要按动作 / 对象 / 结果 / 操作人 / 时间筛选，并有真实总数分页）。
// 展开一行看 metadata（JsonViewer）。
import * as React from 'react'
import {
  CellDate, CellText, Choice, CopyableValue, DataTable, DateRangePicker, DescriptionList, Input, PageBody, PageHeader,
  QueryBar, ResourcePanel, StatusBadge, dateRangePresets, type Column, type DateRangeValue,
} from '@ankotti/admin-ui'
import { JsonViewer } from '@ankotti/admin-ui/display'
import { useServerList } from '@/lib/list'
import { EMPTY_RANGE, rangeParams } from '@/lib/dates'
import type { PageProps } from '@/shell/workspace-context'
import { ACTION_LABELS, RESULTS, TARGET_TYPES, auditActionLabel, auditResult, targetTypeLabel } from './audit/labels'

export type AuditRow = {
  id: string; action: string; targetType: string; targetId: string; ip: string; result: string
  metadata: Record<string, unknown> | null; createdAt: string; actor: string | null
}

const toOptions = (m: Record<string, string>) => Object.entries(m).map(([value, label]) => ({ value, label }))
const PRESETS = dateRangePresets(['today', 'yesterday', 'last7', 'last30'])

function useDebounced(value: string, ms = 300) {
  const [v, setV] = React.useState(value)
  React.useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

function AuditExpand({ row }: { row: AuditRow }) {
  return (
    <>
      <DescriptionList columns={3} items={[
        { label: '操作者', value: row.actor ?? '系统' },
        { label: 'IP', value: row.ip || '—' },
        { label: '对象 ID', value: row.targetId || '—' },
      ]} />
      <JsonViewer value={row.metadata ?? {}} label="附加信息" rootName="metadata" defaultExpandDepth={2} maxHeight={320} />
    </>
  )
}

export function AuditPage(_: PageProps) {
  const [actorInput, setActorInput] = React.useState('')
  const actor = useDebounced(actorInput.trim())
  const [range, setRange] = React.useState<DateRangeValue>(EMPTY_RANGE)
  const [expanded, setExpanded] = React.useState<string[]>([])
  const list = useServerList<AuditRow, { action: string; targetType: string; result: string }>('/v1/admin/audit', {
    filters: { action: '', targetType: '', result: '' },
    sort: { key: 'createdAt', direction: 'desc' },
    extra: { actor, ...rangeParams(range, 'from', 'to') },
  })

  const columns: Column<AuditRow>[] = [
    { key: 'createdAt', title: '时间', sortable: true, width: 160, render: (r) => <CellDate value={r.createdAt} time /> },
    { key: 'actor', title: '操作者', width: 140, truncate: (r) => r.actor ?? '系统', render: (r) => r.actor ?? '系统' },
    { key: 'action', title: '动作', sortable: true, maxWidth: 220, mobile: 'primary', truncate: (r) => auditActionLabel(r.action),
      render: (r) => <CellText primary={auditActionLabel(r.action)} secondary={r.action} /> },
    { key: 'targetType', title: '对象', sortable: true, maxWidth: 240, truncate: (r) => `${targetTypeLabel(r.targetType)} ${r.targetId}`,
      render: (r) => <CellText primary={targetTypeLabel(r.targetType)} secondary={r.targetId ? <CopyableValue variant="inline" value={r.targetId} label="对象 ID" /> : undefined} /> },
    { key: 'ip', title: 'IP', width: 130, render: (r) => r.ip || '—' },
    { key: 'result', title: '结果', sortable: true, width: 90, render: (r) => { const s = auditResult(r.result); return <StatusBadge tone={s.tone}>{s.label}</StatusBadge> } },
  ]

  return (
    <>
      <PageHeader title="审计日志" description="后台与账号的关键操作记录。操作者可填用户名（模糊）或用户 ID（精确）；时间按北京日整天计。" />
      <PageBody fill>
        <ResourcePanel title="审计日志" {...list.panel} unit="条"
          filters={
            <QueryBar {...list.queryBar} placeholder="搜索对象 ID / IP">
              <Choice label="动作" size="sm" clearable placeholder="全部动作" value={list.query.filters.action} onChange={(v) => list.setFilter('action', v)} options={toOptions(ACTION_LABELS)} />
              <Choice label="对象" size="sm" clearable placeholder="全部对象" value={list.query.filters.targetType} onChange={(v) => list.setFilter('targetType', v)} options={toOptions(TARGET_TYPES)} />
              <Choice label="结果" size="sm" clearable placeholder="全部结果" value={list.query.filters.result} onChange={(v) => list.setFilter('result', v)} options={Object.entries(RESULTS).map(([value, r]) => ({ value, label: r.label }))} />
              <Input size="sm" width={160} aria-label="操作者" placeholder="操作者用户名 / ID" clearable onClear={() => setActorInput('')} value={actorInput} onChange={(e) => setActorInput(e.target.value)} />
              <DateRangePicker size="sm" aria-label="时间范围" value={range} onChange={setRange} presets={PRESETS} />
            </QueryBar>
          }>
          <DataTable caption="审计日志" columns={columns} rowKey={(r) => r.id} rowHeight="medium" {...list.table}
            expandable={{ expanded, onExpandedChange: setExpanded, label: (r) => `展开 ${auditActionLabel(r.action)} 的详情`, render: (r) => <AuditExpand row={r} /> }} />
        </ResourcePanel>
      </PageBody>
    </>
  )
}
