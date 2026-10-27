import * as React from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { Eye } from 'lucide-react'
import { listApi } from '@/lib/api'
import { dt } from '@/lib/utils'
import { DataTable } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type DeviceRow, kb, shortId, StatusBadge, toIso } from './shared'

/** 设备列表：按版本 / 最近启动结果 / 账号 / 最近上报时间筛选。 */
export function DevicesTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [version, setVersion] = React.useState('')
  const [accountInput, setAccountInput] = React.useState('')
  const [account, setAccount] = React.useState('')
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  React.useEffect(() => {
    const id = setTimeout(() => setAccount(accountInput.trim()), 300)
    return () => clearTimeout(id)
  }, [accountInput])
  const extraParams = React.useMemo(
    () => ({ version: version.trim(), account, from: toIso(from), to: toIso(to) }),
    [version, account, from, to],
  )

  const columns = React.useMemo<ColumnDef<DeviceRow, unknown>[]>(
    () => [
      {
        id: 'device',
        header: '设备',
        cell: ({ row }) => (
          <button type="button" className="font-mono text-xs hover:underline" title={row.original.deviceId} onClick={() => onOpen(row.original.deviceId)}>
            {shortId(row.original.deviceId)}
          </button>
        ),
      },
      {
        id: 'account',
        header: '账号',
        cell: ({ row }) =>
          row.original.username ? (
            <span className="font-medium">{row.original.username}</span>
          ) : row.original.accountHint ? (
            <span className="text-muted-foreground" title="客户端自报，未核实">{row.original.accountHint}?</span>
          ) : (
            <span className="text-muted-foreground">未登录</span>
          ),
      },
      { id: 'version', header: '版本', cell: ({ row }) => <Badge variant="secondary">v{row.original.appVersion || '?'}</Badge> },
      { id: 'os', header: '系统', cell: ({ row }) => <span className="block max-w-[220px] truncate text-xs" title={row.original.os}>{row.original.os || '—'}</span> },
      {
        id: 'lastStatus',
        header: '最近启动',
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <StatusBadge value={row.original.lastStatus} />
            {row.original.lastErrorCode && <div className="font-mono text-xs text-destructive">{row.original.lastErrorCode}</div>}
          </div>
        ),
      },
      { id: 'lastSeen', header: '最近上报', cell: ({ row }) => <span className="whitespace-nowrap text-sm text-muted-foreground">{dt(row.original.lastSeen)}</span> },
      { id: 'volume', header: '事件 / 日志', cell: ({ row }) => <span className="text-xs tabular-nums">{row.original.eventsCount} / {kb(Number(row.original.logBytes))}</span> },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onOpen(row.original.deviceId)}>
            <Eye className="h-4 w-4" />
            <span className="sr-only">详情</span>
          </Button>
        ),
      },
    ],
    [onOpen],
  )

  return (
    <DataTable<DeviceRow>
      columns={columns}
      fetcher={(query) => listApi<DeviceRow>('/v1/admin/telemetry/devices', { q: query.q, limit: query.limit, offset: query.offset, ...query.filters })}
      searchPlaceholder="设备 ID / 系统 / IP…"
      extraParams={extraParams}
      emptyText="暂无客户端上报"
      getRowId={(row) => row.deviceId}
      filters={[{ key: 'lastStatus', label: '最近启动', options: [{ label: '失败', value: 'fail' }, { label: '成功', value: 'ok' }, { label: '未启动', value: 'info' }] }]}
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="版本，如 1.9.96" className="h-9 w-[140px]" />
          <Input value={accountInput} onChange={(e) => setAccountInput(e.target.value)} placeholder="账号" className="h-9 w-[140px]" />
          <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[190px]" title="最近上报起" />
          <span className="text-muted-foreground">–</span>
          <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-[190px]" title="最近上报止" />
        </div>
      }
    />
  )
}
