import * as React from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { Eye } from 'lucide-react'
import { listApi } from '@/lib/api'
import { dt } from '@/lib/utils'
import { DataTable, type ColumnMeta } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** 审计日志一行（对应后端 GET /v1/admin/audit 返回结构）。 */
interface AuditRow {
  id: string
  action: string
  targetType: string
  targetId: string
  ip: string
  result: string
  metadata: Record<string, unknown>
  createdAt: string
  /** 操作者用户名；系统事件为 null。 */
  actor: string | null
}

const meta = (m: ColumnMeta): ColumnMeta => m

// 已知动作 -> 中文标签（也作为筛选下拉的选项来源）。未知动作回退显示原始值。
const ACTION_LABELS: Record<string, string> = {
  'auth.login': '登录',
  'auth.login.device_limit': '登录·设备已满',
  'auth.device.activate': '设备激活',
  'auth.refresh': '刷新令牌',
  'auth.logout': '登出',
  'user.redeem': '用户兑换',
  'user.device.unbind': '用户解绑设备',
  'admin.user.create': '创建用户',
  'admin.user.status': '用户状态变更',
  'admin.user.password': '重置密码',
  'admin.user.delete': '删除用户',
  'admin.license.extend': '续费授权',
  'admin.license.grant': '发放会员',
  'admin.device.unbind': '管理员解绑设备',
  'admin.plan.create': '创建套餐',
  'admin.plan.update': '更新套餐',
  'admin.plan.delete': '删除套餐',
  'admin.settings.commerce': '商业设置',
  'admin.payment-provider.update': '支付渠道更新',
  'admin.order.confirm': '手动确认订单',
  'admin.redeem.create': '创建兑换码',
  'admin.redeem.status': '兑换码状态',
  'admin.redeem.delete': '删除兑换码',
  'admin.announcement.create': '创建公告',
  'admin.announcement.update': '更新公告',
  'admin.announcement.delete': '删除公告',
  'admin.release.create': '发布版本',
  'admin.release.delete': '删除版本',
}

const actionLabel = (a: string) => ACTION_LABELS[a] ?? a

// 目标类型 -> 中文（筛选下拉选项）。
const TARGET_TYPES: { label: string; value: string }[] = [
  { label: '用户', value: 'user' },
  { label: '设备', value: 'device' },
  { label: '会话', value: 'session' },
  { label: '套餐', value: 'plan' },
  { label: '订单', value: 'order' },
  { label: '兑换码', value: 'redeem-code' },
  { label: '公告', value: 'announcement' },
  { label: '版本', value: 'release' },
  { label: '支付渠道', value: 'payment-provider' },
  { label: '设置', value: 'settings' },
]
const targetTypeLabel = (t: string) => TARGET_TYPES.find((x) => x.value === t)?.label ?? t

// 结果 -> 徽章色 + 中文标签。
type BadgeTone = 'success' | 'warning' | 'destructive' | 'secondary' | 'default'
const RESULT_META: Record<string, { label: string; tone: BadgeTone }> = {
  success: { label: '成功', tone: 'success' },
  denied: { label: '拒绝', tone: 'destructive' },
  failed: { label: '失败', tone: 'destructive' },
  locked: { label: '锁定', tone: 'warning' },
}
function ResultBadge({ value }: { value: string }) {
  const m = RESULT_META[value] ?? { label: value, tone: 'secondary' as BadgeTone }
  return <Badge variant={m.tone}>{m.label}</Badge>
}

const metaKeys = (m: Record<string, unknown> | null | undefined) => Object.keys(m ?? {})

export default function AuditPage() {
  const [detail, setDetail] = React.useState<AuditRow | null>(null)

  // 操作者搜索（username ILIKE / actor UUID 精确）——本地防抖后并入 extraParams。
  const [actorInput, setActorInput] = React.useState('')
  const [actor, setActor] = React.useState('')
  React.useEffect(() => {
    const id = setTimeout(() => setActor(actorInput.trim()), 300)
    return () => clearTimeout(id)
  }, [actorInput])

  // 时间范围（datetime-local -> ISO）。
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const toIso = (v: string) => {
    if (!v) return ''
    const d = new Date(v)
    return isNaN(d.getTime()) ? '' : d.toISOString()
  }
  const extraParams = React.useMemo(
    () => ({ actor, from: toIso(from), to: toIso(to) }),
    [actor, from, to],
  )

  const columns = React.useMemo<ColumnDef<AuditRow, unknown>[]>(
    () => [
      {
        id: 'createdAt',
        header: '时间',
        meta: meta({ sortKey: 'createdAt' }),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {dt(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: 'actor',
        header: '操作者',
        cell: ({ row }) =>
          row.original.actor ? (
            <span className="font-medium">{row.original.actor}</span>
          ) : (
            <span className="text-muted-foreground">系统</span>
          ),
      },
      {
        id: 'action',
        header: '动作',
        meta: meta({ sortKey: 'action' }),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-medium">{actionLabel(row.original.action)}</div>
            <div className="font-mono text-xs text-muted-foreground">{row.original.action}</div>
          </div>
        ),
      },
      {
        id: 'target',
        header: '目标',
        meta: meta({ sortKey: 'targetType' }),
        cell: ({ row }) => (
          <div className="min-w-0">
            <Badge variant="secondary">{targetTypeLabel(row.original.targetType)}</Badge>
            <div
              className="mt-1 max-w-[220px] truncate font-mono text-xs text-muted-foreground"
              title={row.original.targetId}
            >
              {row.original.targetId}
            </div>
          </div>
        ),
      },
      {
        id: 'result',
        header: '结果',
        meta: meta({ sortKey: 'result' }),
        cell: ({ row }) => <ResultBadge value={row.original.result} />,
      },
      {
        id: 'ip',
        header: 'IP',
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">{row.original.ip || '—'}</span>
        ),
      },
      {
        id: 'metadata',
        header: '元数据',
        cell: ({ row }) => {
          const keys = metaKeys(row.original.metadata)
          if (keys.length === 0) return <span className="text-muted-foreground">—</span>
          const preview = JSON.stringify(row.original.metadata)
          return (
            <button
              type="button"
              onClick={() => setDetail(row.original)}
              className="block max-w-[240px] truncate rounded px-1 text-left font-mono text-xs text-muted-foreground hover:text-foreground"
              title={preview}
            >
              {preview}
            </button>
          )
        },
      },
      {
        id: 'actions',
        header: '',
        meta: meta({ className: 'text-right' }),
        cell: ({ row }) => (
          <div className="text-right">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setDetail(row.original)}
            >
              <Eye className="h-4 w-4" />
              <span className="sr-only">详情</span>
            </Button>
          </div>
        ),
      },
    ],
    [],
  )

  return (
    <>
      <DataTable<AuditRow>
        columns={columns}
        fetcher={(query) =>
          listApi<AuditRow>('/v1/admin/audit', {
            q: query.q,
            limit: query.limit,
            offset: query.offset,
            ...(query.sort ? { sort: query.sort } : {}),
            ...(query.order ? { order: query.order } : {}),
            ...query.filters,
          })
        }
        searchPlaceholder="搜索动作 / 目标类型 / 目标 ID…"
        extraParams={extraParams}
        initialSort={{ sort: 'createdAt', order: 'desc' }}
        getRowId={(row) => row.id}
        filters={[
          {
            key: 'action',
            label: '动作',
            options: Object.entries(ACTION_LABELS).map(([value, label]) => ({ label, value })),
          },
          {
            key: 'targetType',
            label: '目标类型',
            options: TARGET_TYPES,
          },
          {
            key: 'result',
            label: '结果',
            options: [
              { label: '成功', value: 'success' },
              { label: '拒绝', value: 'denied' },
              { label: '失败', value: 'failed' },
              { label: '锁定', value: 'locked' },
            ],
          },
        ]}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={actorInput}
              onChange={(e) => setActorInput(e.target.value)}
              placeholder="操作者用户名 / ID"
              className="h-9 w-[190px]"
              title="按操作者用户名或用户 ID 筛选"
            />
            <div className="flex items-center gap-1">
              <Input
                type="datetime-local"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-9 w-[190px]"
                title="起始时间"
              />
              <span className="text-muted-foreground">–</span>
              <Input
                type="datetime-local"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-9 w-[190px]"
                title="截止时间"
              />
            </div>
          </div>
        }
      />

      <AuditDetailDialog row={detail} onOpenChange={(o) => !o && setDetail(null)} />
    </>
  )
}

// ---------- 详情（含 metadata JSON）----------
function AuditDetailDialog({
  row,
  onOpenChange,
}: {
  row: AuditRow | null
  onOpenChange: (o: boolean) => void
}) {
  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{row ? actionLabel(row.action) : '审计详情'}</DialogTitle>
          <DialogDescription>{row ? `${row.id} · ${dt(row.createdAt)}` : ''}</DialogDescription>
        </DialogHeader>

        {row && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Field label="动作">
                <span className="font-mono text-xs">{row.action}</span>
              </Field>
              <Field label="结果">
                <ResultBadge value={row.result} />
              </Field>
              <Field label="操作者">
                {row.actor || <span className="text-muted-foreground">系统</span>}
              </Field>
              <Field label="IP">
                <span className="font-mono text-xs">{row.ip || '—'}</span>
              </Field>
              <Field label="目标类型">
                <Badge variant="secondary">{targetTypeLabel(row.targetType)}</Badge>
              </Field>
              <Field label="目标 ID">
                <span className="break-all font-mono text-xs">{row.targetId}</span>
              </Field>
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="font-medium">元数据</div>
              {metaKeys(row.metadata).length === 0 ? (
                <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                  无附加数据
                </div>
              ) : (
                <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs">
                  {JSON.stringify(row.metadata, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  )
}
