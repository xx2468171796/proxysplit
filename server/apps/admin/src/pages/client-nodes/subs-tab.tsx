// 同事节点 · 订阅表 + 最近变化（都随统计每 3 秒静默刷新）。
import * as React from 'react'
import { Eye } from 'lucide-react'
import {
  CellDate, CellText, DataTable, Panel, QueryBar, ResourcePanel, RowActionBar, StatusBadge, errorText, type Column,
} from '@ankotti/admin-ui'
import { get } from '@/lib/api'
import { useServerList } from '@/lib/list'
import { accountText, shortId, type ChangeRow, type RevealTarget, type SubRow } from './shared'

type Props = { tick: number; canReveal: boolean; onReveal: (t: RevealTarget) => void }

function useTickRefresh(tick: number, refresh: () => void) {
  const first = React.useRef(true)
  const ref = React.useRef(refresh)
  ref.current = refresh
  React.useEffect(() => { if (first.current) { first.current = false; return } ref.current() }, [tick])
}

export function SubsTab({ tick, canReveal, onReveal }: Props) {
  const list = useServerList<SubRow, Record<string, string>>('/v1/admin/client-subs', { filters: {}, paging: 'page' })
  useTickRefresh(tick, list.refresh)
  const columns: Column<SubRow>[] = [
    { key: 'name', title: '订阅', maxWidth: 240, mobile: 'primary', truncate: (r) => r.name || '—', render: (r) => <CellText primary={r.name || '—'} secondary={r.host} /> },
    { key: 'account', title: '账号 / 设备', maxWidth: 200, truncate: (r) => accountText(r.username), render: (r) => <CellText primary={accountText(r.username)} secondary={shortId(r.deviceId)} /> },
    { key: 'count', title: '节点数', width: 90, numeric: true, render: (r) => r.nodeCount },
    { key: 'auto', title: '自动更新', width: 90, render: (r) => (r.autoUpdate ? '开' : '关') },
    { key: 'lastUpdate', title: '上次更新', width: 150, render: (r) => <CellDate value={r.lastUpdate} time /> },
    { key: 'status', title: '状态', width: 90, render: (r) => (r.removedAt ? <StatusBadge tone="neutral">已删除</StatusBadge> : <StatusBadge tone="success">在用</StatusBadge>) },
    { key: 'url', title: '地址', width: 80, render: (r) => (r.hasUrl ? '已加密' : '无') },
    { key: 'actions', title: '操作', kind: 'actions', render: (r) => (
      <RowActionBar label={`订阅 ${r.name} 的更多操作`} actions={canReveal && r.hasUrl
        ? [{ key: 'reveal', label: '查看', icon: <Eye />, onSelect: () => onReveal({ kind: 'sub', deviceId: r.deviceId, id: r.subId, name: r.name }) }]
        : []} />
    ) },
  ]
  return (
    <ResourcePanel title="订阅" {...list.panel} unit="个" filters={<QueryBar {...list.queryBar} placeholder="订阅名 / 域名 / 账号" />}>
      <DataTable caption="同事订阅" columns={columns} rowKey={(r) => `${r.deviceId}:${r.subId}`} rowHeight="medium" emptyLabel="还没有设备上报订阅" {...list.table} />
    </ResourcePanel>
  )
}

const ACTION: Record<ChangeRow['action'], { label: string; tone: 'success' | 'danger' | 'neutral' }> = {
  add: { label: '新增', tone: 'success' }, remove: { label: '删除', tone: 'danger' }, update: { label: '修改', tone: 'neutral' },
}

export function ChangesList({ tick }: { tick: number }) {
  const [rows, setRows] = React.useState<ChangeRow[] | null>(null)
  const [error, setError] = React.useState('')
  const [nonce, setNonce] = React.useState(0)
  React.useEffect(() => {
    const ctl = new AbortController()
    get<{ items: ChangeRow[] }>('/v1/admin/client-nodes/changes?limit=100', ctl.signal)
      .then((r) => { setRows(r.items); setError('') }, (e: unknown) => { if (!ctl.signal.aborted) setError(errorText(e, '加载失败')) })
    return () => ctl.abort()
  }, [tick, nonce])
  const columns: Column<ChangeRow>[] = [
    { key: 'at', title: '时间', width: 150, render: (r) => <CellDate value={r.at} time /> },
    { key: 'action', title: '变化', width: 110, render: (r) => <StatusBadge tone={ACTION[r.action].tone}>{`${ACTION[r.action].label}${r.kind === 'sub' ? '订阅' : '节点'}`}</StatusBadge> },
    { key: 'name', title: '名称', maxWidth: 260, mobile: 'primary', truncate: (r) => r.name || '—',
      render: (r) => <CellText primary={r.name || '—'} secondary={r.action === 'update' && r.fields.length > 0 ? `改了 ${r.fields.join('、')}` : undefined} /> },
    { key: 'who', title: '账号 / 设备', maxWidth: 200, truncate: (r) => accountText(r.username), render: (r) => <CellText primary={r.username ?? '未登录'} secondary={shortId(r.deviceId)} /> },
  ]
  return (
    <Panel title="最近变化" count="最近 100 条">
      <DataTable caption="最近变化" columns={columns} rows={rows ?? []} rowKey={(r) => r.id} rowHeight="medium" loading={rows === null && !error}
        {...(error && !rows ? { error } : {})} onRetry={() => setNonce((n) => n + 1)} emptyLabel="暂无变化" pagination={{ mode: 'all' }} />
    </Panel>
  )
}
