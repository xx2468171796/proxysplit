import * as React from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { MonitorSmartphone, MoreHorizontal, Unlink } from 'lucide-react'
import { del, listApi } from '@/lib/api'
import { dt } from '@/lib/utils'
import { DataTable, type ColumnMeta } from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'

/** 后端 GET /v1/admin/devices 返回的单行结构（列名以 migration / store.listDevices 为准）。 */
type Device = {
  id: string
  userId: string
  username: string
  name: string
  platform: string
  appVersion: string
  revoked: boolean
  firstSeenAt: string
  lastSeenAt: string
}

const meta = (m: ColumnMeta): ColumnMeta => m

/** 与后端一致：last_seen_at 在 15 分钟内视为在线。 */
const ONLINE_WINDOW_MS = 15 * 60 * 1000
const isOnline = (lastSeenAt: string) =>
  !!lastSeenAt && new Date(lastSeenAt).getTime() > Date.now() - ONLINE_WINDOW_MS

/** 设备状态词：优先展示已解绑，其次在线 / 离线。交给 StatusBadge 上色。 */
const deviceStatus = (d: Device) => (d.revoked ? '已解绑' : isOnline(d.lastSeenAt) ? '在线' : '离线')

export default function DevicesPage() {
  const [refresh, setRefresh] = React.useState(0)
  const bump = () => setRefresh((r) => r + 1)

  // 解绑二次确认弹窗
  const [unbindRow, setUnbindRow] = React.useState<Device | null>(null)

  // 版本号为自由文本，用工具栏输入框做精确筛选（faceted 之外）
  const [appVersion, setAppVersion] = React.useState('')
  const extraParams = React.useMemo(() => ({ appVersion: appVersion.trim() }), [appVersion])

  const columns = React.useMemo<ColumnDef<Device, unknown>[]>(
    () => [
      {
        id: 'name',
        header: '设备',
        meta: meta({ sortKey: 'name' }),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-medium">{row.original.name}</div>
            <div className="text-xs text-muted-foreground">{row.original.platform}</div>
          </div>
        ),
      },
      {
        id: 'username',
        header: '所属用户',
        meta: meta({ sortKey: 'username' }),
        cell: ({ row }) => <span className="font-medium">{row.original.username}</span>,
      },
      {
        id: 'platform',
        header: '平台',
        meta: meta({ sortKey: 'platform' }),
        cell: ({ row }) => row.original.platform || '—',
      },
      {
        id: 'appVersion',
        header: '版本',
        meta: meta({ sortKey: 'appVersion' }),
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.appVersion || '—'}</span>
        ),
      },
      {
        id: 'status',
        header: '状态',
        cell: ({ row }) => <StatusBadge value={deviceStatus(row.original)} />,
      },
      {
        id: 'firstSeenAt',
        header: '首次上线',
        meta: meta({ sortKey: 'firstSeenAt' }),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{dt(row.original.firstSeenAt)}</span>
        ),
      },
      {
        id: 'lastSeenAt',
        header: '最近活跃',
        meta: meta({ sortKey: 'lastSeenAt' }),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{dt(row.original.lastSeenAt)}</span>
        ),
      },
      {
        id: 'actions',
        header: '',
        meta: meta({ className: 'text-right' }),
        cell: ({ row }) => {
          const d = row.original
          return (
            <div className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">操作</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuLabel className="truncate">{d.name}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={d.revoked}
                    onClick={() => setUnbindRow(d)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Unlink className="h-4 w-4" />
                    {d.revoked ? '已解绑' : '解绑设备'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        },
      },
    ],
    // 处理器均为闭包内稳定引用，无外部依赖
    [],
  )

  return (
    <>
      <DataTable<Device>
        columns={columns}
        fetcher={(query) =>
          listApi<Device>('/v1/admin/devices', {
            q: query.q,
            limit: query.limit,
            offset: query.offset,
            ...(query.sort ? { sort: query.sort } : {}),
            ...(query.order ? { order: query.order } : {}),
            ...query.filters,
          })
        }
        searchPlaceholder="搜索设备名 / 用户名…"
        refreshSignal={refresh}
        extraParams={extraParams}
        initialSort={{ sort: 'lastSeenAt', order: 'desc' }}
        filters={[
          {
            key: 'platform',
            label: '平台',
            options: [
              { label: 'Windows', value: 'windows' },
              { label: 'macOS', value: 'macos' },
              { label: 'Linux', value: 'linux' },
              { label: 'Android', value: 'android' },
              { label: 'iOS', value: 'ios' },
            ],
          },
          {
            key: 'online',
            label: '在线状态',
            options: [
              { label: '在线', value: 'true' },
              { label: '离线', value: 'false' },
            ],
          },
          {
            key: 'revoked',
            label: '绑定状态',
            options: [
              { label: '正常', value: 'false' },
              { label: '已解绑', value: 'true' },
            ],
          },
        ]}
        toolbar={
          <div className="flex items-center gap-1">
            <MonitorSmartphone className="h-4 w-4 text-muted-foreground" />
            <Input
              value={appVersion}
              onChange={(e) => setAppVersion(e.target.value)}
              placeholder="按版本号筛选…"
              className="h-9 w-[150px]"
              title="按 App 版本号精确筛选"
            />
          </div>
        }
      />

      <UnbindDeviceDialog
        row={unbindRow}
        onOpenChange={(o) => !o && setUnbindRow(null)}
        onDone={bump}
      />
    </>
  )
}

// ---------- 解绑设备（二次确认）----------
function UnbindDeviceDialog({
  row,
  onOpenChange,
  onDone,
}: {
  row: Device | null
  onOpenChange: (o: boolean) => void
  onDone: () => void
}) {
  const [busy, setBusy] = React.useState(false)

  async function confirmUnbind() {
    if (!row) return
    setBusy(true)
    try {
      await del<{ ok: boolean }>(`/v1/admin/devices/${row.id}`)
      toast.success(`已解绑设备 ${row.name}`)
      onOpenChange(false)
      onDone()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>解绑设备</DialogTitle>
          <DialogDescription>
            确认解绑 <span className="font-medium text-foreground">{row?.name}</span>
            （用户 {row?.username}）？该设备的登录会话将立即失效并释放名额，此操作不可撤销。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={confirmUnbind}>
            {busy ? '解绑中…' : '确认解绑'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
