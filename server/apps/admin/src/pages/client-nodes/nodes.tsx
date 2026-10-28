// 同事节点：节点表（3 秒刷新，不带链接；超管点「查看」才解密）。
import * as React from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { dt } from '@/lib/utils'
import { DataTable } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AccountCell, type NodeRow, pagedFetcher, type RevealTarget, shortId } from './shared'

const TYPES = ['vless', 'vmess', 'trojan', 'shadowsocks', 'socks', 'http', 'hysteria2', 'tuic', 'anytls', 'wireguard', 'raw']
const fetchNodes = pagedFetcher<NodeRow>('/v1/admin/client-nodes')

function Latency({ row }: { row: NodeRow }) {
  if (row.latency < 0) return <Badge variant="destructive">不通</Badge>
  if (row.latency === 0) return <span className="text-xs text-muted-foreground">未测</span>
  return <span className="text-xs tabular-nums">{row.latency} ms</span>
}

export function NodesTab({ tick, canReveal, onReveal }: { tick: number; canReveal: boolean; onReveal: (t: RevealTarget) => void }) {
  const [device, setDevice] = React.useState('')
  const [deadOnly, setDeadOnly] = React.useState(false)
  const extraParams = React.useMemo(() => ({ deviceId: device.trim(), dead: deadOnly ? 1 : '' }), [device, deadOnly])

  const columns = React.useMemo<ColumnDef<NodeRow, unknown>[]>(() => [
    { id: 'name', header: '节点', cell: ({ row }) => (
      <div className="max-w-[200px]">
        <div className="truncate font-medium" title={row.original.name}>{row.original.selected && <span className="mr-1 text-primary" title="正在用">●</span>}{row.original.name || '—'}</div>
        <div className="text-xs text-muted-foreground">{row.original.source === 'sub' ? '订阅' : row.original.source === 'official' || row.original.official ? '官方' : '手动'}{row.original.via && ' · 有前置'}</div>
      </div>
    ) },
    { id: 'type', header: '协议', cell: ({ row }) => (
      <div className="space-y-0.5">
        <Badge variant="secondary">{row.original.type || '?'}</Badge>
        <div className="text-xs text-muted-foreground">{[row.original.network, row.original.security].filter(Boolean).join(' / ')}</div>
      </div>
    ) },
    { id: 'server', header: '服务器', cell: ({ row }) => <span className="block max-w-[200px] truncate font-mono text-xs" title={row.original.sni ? `SNI ${row.original.sni}` : ''}>{row.original.server}:{row.original.port}</span> },
    { id: 'account', header: '账号 / 设备', cell: ({ row }) => (
      <div><AccountCell username={row.original.username} hint={row.original.accountHint} /><div className="font-mono text-xs text-muted-foreground" title={row.original.deviceId}>{shortId(row.original.deviceId)}</div></div>
    ) },
    { id: 'latency', header: '延迟', cell: ({ row }) => <Latency row={row.original} /> },
    { id: 'speed', header: '速度', cell: ({ row }) => <span className="text-xs tabular-nums">{row.original.speed > 0 ? `${row.original.speed.toFixed(1)} MB/s` : '—'}</span> },
    { id: 'core', header: '内核', cell: ({ row }) => <span className="text-xs">{row.original.core || '—'}</span> },
    { id: 'status', header: '状态', cell: ({ row }) => row.original.removedAt
      ? <span className="text-xs text-muted-foreground" title={dt(row.original.removedAt)}>已删除</span>
      : <span className="whitespace-nowrap text-xs text-muted-foreground" title="最近上报">{dt(row.original.lastSeen)}</span> },
    { id: 'link', header: '链接', cell: ({ row }) => !row.original.hasLink
      ? <span className="text-xs text-muted-foreground">无</span>
      : (
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">已加密</span>
          {canReveal && <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => onReveal({ kind: 'node', deviceId: row.original.deviceId, id: row.original.nodeId, name: row.original.name })}>查看</Button>}
        </div>
      ) },
  ], [canReveal, onReveal])

  return (
    <DataTable<NodeRow>
      columns={columns}
      fetcher={fetchNodes}
      refreshSignal={tick}
      searchPlaceholder="节点名 / 服务器 / 账号…"
      extraParams={extraParams}
      emptyText="还没有设备上报节点"
      getRowId={(row) => `${row.deviceId}:${row.nodeId}`}
      filters={[
        { key: 'type', label: '协议', options: TYPES.map((t) => ({ label: t, value: t })) },
        { key: 'status', label: '状态', options: [{ label: '在用', value: 'alive' }, { label: '已删除', value: 'removed' }, { label: '全部', value: 'all' }] },
      ]}
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <Input value={device} onChange={(e) => setDevice(e.target.value)} placeholder="设备 ID 开头" className="h-9 w-[160px]" />
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={deadOnly} onChange={(e) => setDeadOnly(e.target.checked)} />只看不通
          </label>
        </div>
      }
    />
  )
}
