// 同事节点 · 节点表（随统计每 3 秒静默刷新；不带链接，超管点「查看」才解密）。
import * as React from 'react'
import { Eye } from 'lucide-react'
import {
  CellDate, CellText, Choice, CopyableValue, DataTable, Input, QueryBar, ResourcePanel, RowActionBar, StatusBadge,
  type Column,
} from '@ankotti/admin-ui'
import { useServerList } from '@/lib/list'
import { NODE_TYPES, accountText, latencyText, nodeSource, shortId, type NodeRow, type RevealTarget } from './shared'

type Props = { tick: number; canReveal: boolean; onReveal: (t: RevealTarget) => void }

function nodeColumns(canReveal: boolean, onReveal: Props['onReveal']): Column<NodeRow>[] {
  return [
    { key: 'name', title: '节点', maxWidth: 220, mobile: 'primary', truncate: (r) => r.name || '—',
      render: (r) => <CellText primary={`${r.selected ? '● ' : ''}${r.name || '—'}`} secondary={`${r.selected ? '正在用 · ' : ''}${nodeSource(r)}`} /> },
    { key: 'type', title: '协议', width: 130, render: (r) => <CellText primary={r.type || '?'} secondary={[r.network, r.security].filter(Boolean).join(' / ') || undefined} /> },
    { key: 'server', title: '服务器', maxWidth: 220, truncate: (r) => `${r.server}:${r.port}${r.sni ? ` · SNI ${r.sni}` : ''}`,
      render: (r) => <CopyableValue variant="inline" value={`${r.server}:${r.port}`} label="服务器地址" /> },
    { key: 'account', title: '账号 / 设备', maxWidth: 200, truncate: (r) => `${accountText(r.username, r.accountHint)} ${r.deviceId}`,
      render: (r) => <CellText primary={accountText(r.username, r.accountHint)} secondary={shortId(r.deviceId)} /> },
    { key: 'latency', title: '延迟', width: 90, render: (r) => { const l = latencyText(r.latency); return l.dead ? <StatusBadge tone="danger">不通</StatusBadge> : l.text } },
    { key: 'speed', title: '速度', width: 100, numeric: true, render: (r) => (r.speed > 0 ? `${r.speed.toFixed(1)} MB/s` : '—') },
    { key: 'core', title: '内核', width: 90, render: (r) => r.core || '—' },
    { key: 'status', title: '状态', width: 150, render: (r) => (r.removedAt
      ? <CellText primary={<StatusBadge tone="neutral">已删除</StatusBadge>} secondary={<CellDate value={r.removedAt} time />} />
      : <CellText primary={<CellDate value={r.lastSeen} time />} secondary="最近上报" />) },
    { key: 'link', title: '链接', width: 80, render: (r) => (r.hasLink ? '已加密' : '无') },
    { key: 'actions', title: '操作', kind: 'actions', render: (r) => (
      <RowActionBar label={`节点 ${r.name} 的更多操作`} actions={canReveal && r.hasLink
        ? [{ key: 'reveal', label: '查看', icon: <Eye />, onSelect: () => onReveal({ kind: 'node', deviceId: r.deviceId, id: r.nodeId, name: r.name }) }]
        : []} />
    ) },
  ]
}

export function NodesTab({ tick, canReveal, onReveal }: Props) {
  const [device, setDevice] = React.useState('')
  const list = useServerList<NodeRow, { type: string; status: string; dead: string }>('/v1/admin/client-nodes', {
    filters: { type: '', status: '', dead: '' }, paging: 'page', extra: { deviceId: device.trim() },
  })
  const { refresh } = list
  const first = React.useRef(true)
  React.useEffect(() => { if (first.current) { first.current = false; return } refresh() }, [tick])

  return (
    <ResourcePanel title="节点" {...list.panel} unit="个"
      filters={
        <QueryBar {...list.queryBar} placeholder="节点名 / 服务器 / 账号">
          <Choice label="协议" size="sm" clearable placeholder="全部协议" value={list.query.filters.type} onChange={(v) => list.setFilter('type', v)} options={NODE_TYPES.map((t) => ({ value: t, label: t }))} />
          <Choice label="状态" size="sm" clearable placeholder="在用（默认）" value={list.query.filters.status} onChange={(v) => list.setFilter('status', v)}
            options={[{ value: 'alive', label: '在用' }, { value: 'removed', label: '已删除' }, { value: 'all', label: '全部' }]} />
          <Choice label="连通" size="sm" clearable placeholder="全部连通状态" value={list.query.filters.dead} onChange={(v) => list.setFilter('dead', v)} options={[{ value: '1', label: '只看不通' }]} />
          <Input size="sm" width={150} aria-label="设备 ID 开头" placeholder="设备 ID 开头" clearable onClear={() => setDevice('')} value={device} onChange={(e) => setDevice(e.target.value)} />
        </QueryBar>
      }>
      <DataTable caption="同事节点" columns={nodeColumns(canReveal, onReveal)} rowKey={(r) => `${r.deviceId}:${r.nodeId}`} rowHeight="medium" emptyLabel="还没有设备上报节点" {...list.table} />
    </ResourcePanel>
  )
}
