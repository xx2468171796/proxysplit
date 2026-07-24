import * as React from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { CheckCircle2, FileText, MoreHorizontal, Truck } from 'lucide-react'
import { get, post, listApi } from '@/lib/api'
import { dt, money } from '@/lib/utils'
import { DataTable, type ColumnMeta } from '@/components/data-table'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
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

/** 后台订单列表行（对应 store.listOrders 的返回结构）。 */
type Order = {
  id: string
  orderNo: string
  username: string
  planName: string
  tier: string
  billingCycle: string
  amountCents: number
  currency: string
  status: string
  providerCode: string
  providerOrderNo: string | null
  paidAt: string | null
  createdAt: string
}

type Provider = { code: string; displayName: string; enabled: boolean }

const meta = (m: ColumnMeta): ColumnMeta => m

const tierLabel = (t: string) =>
  t === 'premium' ? '超级会员' : t === 'standard' ? '普通会员' : t === 'trial' ? '试用' : t

const cycleLabel = (c: string) =>
  (({ trial: '试用', month: '月付', quarter: '季付', year: '年付', lifetime: '永久', custom: '自定义' }) as Record<
    string,
    string
  >)[c] ?? c

/** 订单状态 -> 中文标签 + Badge variant。 */
const STATUS: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
  paid: { label: '已支付', variant: 'success' },
  pending: { label: '待支付', variant: 'warning' },
  failed: { label: '支付失败', variant: 'destructive' },
  closed: { label: '已关闭', variant: 'secondary' },
  refunded: { label: '已退款', variant: 'destructive' },
}
function OrderStatus({ value }: { value: string }) {
  const s = STATUS[value] ?? { label: value, variant: 'secondary' as const }
  return <Badge variant={s.variant}>{s.label}</Badge>
}

/** 只有待支付 / 支付失败的订单可后台手动发货。 */
const canShip = (status: string) => status === 'pending' || status === 'failed'

export default function OrdersPage() {
  const [refresh, setRefresh] = React.useState(0)
  const bump = () => setRefresh((r) => r + 1)

  const [amountSum, setAmountSum] = React.useState(0)

  // 支付渠道：用于筛选下拉与列内名称展示
  const [providers, setProviders] = React.useState<Provider[]>([])
  React.useEffect(() => {
    get<{ items: Provider[] }>('/v1/admin/payment-providers')
      .then((r) => setProviders(r.items))
      .catch(() => setProviders([]))
  }, [])
  const providerName = React.useCallback(
    (code: string) => providers.find((p) => p.code === code)?.displayName ?? code,
    [providers],
  )

  // 弹窗状态
  const [detail, setDetail] = React.useState<Order | null>(null)
  const [shipRow, setShipRow] = React.useState<Order | null>(null)

  // 下单时间范围（faceted 之外）
  const [createdFrom, setCreatedFrom] = React.useState('')
  const [createdTo, setCreatedTo] = React.useState('')
  const extraParams = React.useMemo(
    () => ({
      createdFrom: createdFrom ? new Date(createdFrom).toISOString() : '',
      createdTo: createdTo ? new Date(createdTo).toISOString() : '',
    }),
    [createdFrom, createdTo],
  )

  const columns = React.useMemo<ColumnDef<Order, unknown>[]>(
    () => [
      {
        id: 'orderNo',
        header: '订单号',
        meta: meta({ sortKey: 'orderNo' }),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-mono text-xs">{row.original.orderNo}</div>
            {row.original.providerOrderNo && (
              <div className="font-mono text-xs text-muted-foreground">网关 {row.original.providerOrderNo}</div>
            )}
          </div>
        ),
      },
      {
        id: 'username',
        header: '用户',
        meta: meta({ sortKey: 'username' }),
        cell: ({ row }) => <span className="font-medium">{row.original.username}</span>,
      },
      {
        id: 'plan',
        header: '套餐 / 等级',
        cell: ({ row }) => (
          <div className="min-w-0">
            <div>{row.original.planName}</div>
            <div className="text-xs text-muted-foreground">
              {tierLabel(row.original.tier)} · {cycleLabel(row.original.billingCycle)}
            </div>
          </div>
        ),
      },
      {
        id: 'amountCents',
        header: '金额',
        meta: meta({ sortKey: 'amountCents', className: 'text-right', headerClassName: 'text-right' }),
        cell: ({ row }) => (
          <div className="text-right font-medium">
            {money(row.original.amountCents)}
            {row.original.currency && row.original.currency !== 'CNY' && (
              <span className="ml-1 text-xs text-muted-foreground">{row.original.currency}</span>
            )}
          </div>
        ),
      },
      {
        id: 'status',
        header: '状态',
        meta: meta({ sortKey: 'status' }),
        cell: ({ row }) => <OrderStatus value={row.original.status} />,
      },
      {
        id: 'provider',
        header: '支付渠道',
        cell: ({ row }) => <span className="text-sm">{providerName(row.original.providerCode)}</span>,
      },
      {
        id: 'createdAt',
        header: '下单时间',
        meta: meta({ sortKey: 'createdAt' }),
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{dt(row.original.createdAt)}</span>,
      },
      {
        id: 'paidAt',
        header: '支付时间',
        meta: meta({ sortKey: 'paidAt' }),
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{dt(row.original.paidAt)}</span>,
      },
      {
        id: 'actions',
        header: '',
        meta: meta({ className: 'text-right' }),
        cell: ({ row }) => {
          const r = row.original
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
                  <DropdownMenuLabel className="font-mono text-xs">{r.orderNo}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setDetail(r)}>
                    <FileText className="h-4 w-4" />
                    订单详情
                  </DropdownMenuItem>
                  {canShip(r.status) && (
                    <DropdownMenuItem onClick={() => setShipRow(r)}>
                      <Truck className="h-4 w-4" />
                      确认发货
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        },
      },
    ],
    [providerName],
  )

  return (
    <>
      <DataTable<Order>
        columns={columns}
        fetcher={(query) =>
          listApi<Order>('/v1/admin/orders', {
            q: query.q,
            limit: query.limit,
            offset: query.offset,
            ...(query.sort ? { sort: query.sort } : {}),
            ...(query.order ? { order: query.order } : {}),
            ...query.filters,
          })
        }
        searchPlaceholder="搜索订单号 / 用户名…"
        refreshSignal={refresh}
        extraParams={extraParams}
        initialSort={{ sort: 'createdAt', order: 'desc' }}
        onLoaded={(res) => setAmountSum(res.amountSum ?? 0)}
        filters={[
          {
            key: 'status',
            label: '状态',
            options: [
              { label: '待支付', value: 'pending' },
              { label: '已支付', value: 'paid' },
              { label: '支付失败', value: 'failed' },
              { label: '已关闭', value: 'closed' },
              { label: '已退款', value: 'refunded' },
            ],
          },
          {
            key: 'tier',
            label: '等级',
            options: [
              { label: '试用', value: 'trial' },
              { label: '普通会员', value: 'standard' },
              { label: '超级会员', value: 'premium' },
            ],
          },
          {
            key: 'providerCode',
            label: '支付渠道',
            options: providers.map((p) => ({ label: p.displayName, value: p.code })),
          },
        ]}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground">下单</span>
              <Input
                type="date"
                value={createdFrom}
                onChange={(e) => setCreatedFrom(e.target.value)}
                className="h-9 w-[150px]"
                title="下单起始日期"
              />
              <span className="text-muted-foreground">–</span>
              <Input
                type="date"
                value={createdTo}
                onChange={(e) => setCreatedTo(e.target.value)}
                className="h-9 w-[150px]"
                title="下单截止日期"
              />
            </div>
            <div className="rounded-md border px-3 py-1.5 text-sm">
              <span className="text-muted-foreground">已成交合计</span>{' '}
              <span className="font-semibold text-foreground">{money(amountSum)}</span>
            </div>
          </div>
        }
      />

      <OrderDetailDialog order={detail} onOpenChange={(o) => !o && setDetail(null)} providerName={providerName} />
      <ConfirmShipDialog order={shipRow} onOpenChange={(o) => !o && setShipRow(null)} onDone={bump} />
    </>
  )
}

// ---------- 确认发货（二次确认）----------
function ConfirmShipDialog({
  order,
  onOpenChange,
  onDone,
}: {
  order: Order | null
  onOpenChange: (o: boolean) => void
  onDone: () => void
}) {
  const [busy, setBusy] = React.useState(false)
  async function confirm() {
    if (!order) return
    setBusy(true)
    try {
      const res = await post<{ ok: boolean; duplicate?: boolean }>(
        `/v1/admin/orders/${order.orderNo}/confirm`,
      )
      if (res.duplicate) toast.info(`订单 ${order.orderNo} 已是已支付状态，无需重复发货`)
      else toast.success(`已确认发货并发放权益 · ${order.orderNo}`)
      onOpenChange(false)
      onDone()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={!!order} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>确认发货</DialogTitle>
          <DialogDescription>
            将订单 <span className="font-mono text-foreground">{order?.orderNo}</span> 直接标记为已支付，
            并为 <span className="font-medium text-foreground">{order?.username}</span> 发放
            「{order?.planName}」权益，无需等待支付网关回调。此操作用于手动补单。
          </DialogDescription>
        </DialogHeader>
        {order && (
          <div className="rounded-md border p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">金额</span>
              <span className="font-medium">{money(order.amountCents)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-muted-foreground">当前状态</span>
              <OrderStatus value={order.status} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={busy} onClick={confirm}>
            <CheckCircle2 className="h-4 w-4" />
            {busy ? '发货中…' : '确认发货'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- 订单详情 ----------
function OrderDetailDialog({
  order,
  onOpenChange,
  providerName,
}: {
  order: Order | null
  onOpenChange: (o: boolean) => void
  providerName: (code: string) => string
}) {
  return (
    <Dialog open={!!order} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>订单详情</DialogTitle>
          <DialogDescription className="font-mono">{order?.orderNo}</DialogDescription>
        </DialogHeader>
        {order && (
          <div className="space-y-4 text-sm">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <div className="text-xs text-muted-foreground">成交金额</div>
                <div className="mt-1 text-2xl font-semibold">{money(order.amountCents)}</div>
              </div>
              <OrderStatus value={order.status} />
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="用户" value={order.username} />
              <Field label="套餐" value={order.planName} />
              <Field label="会员等级" value={tierLabel(order.tier)} />
              <Field label="计费周期" value={cycleLabel(order.billingCycle)} />
              <Field label="币种" value={order.currency || 'CNY'} />
              <Field label="支付渠道" value={providerName(order.providerCode)} />
              <Field label="下单时间" value={dt(order.createdAt)} />
              <Field label="支付时间" value={dt(order.paidAt)} />
              <Field label="网关订单号" value={order.providerOrderNo || '—'} mono className="col-span-2" />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  value,
  mono,
  className,
}: {
  label: string
  value: string
  mono?: boolean
  className?: string
}) {
  return (
    <div className={className}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={mono ? 'mt-0.5 font-mono text-xs' : 'mt-0.5'}>{value}</div>
    </div>
  )
}
