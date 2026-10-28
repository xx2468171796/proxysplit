// 订单（T02 资源列表页）：筛选状态 / 等级 / 渠道 / 下单日期，已成交合计，行内确认发货与退款，点开看详情（T14）。
import * as React from 'react'
import { CheckCheck, Undo2 } from 'lucide-react'
import {
  CellDate, CellText, Choice, CopyableValue, DataTable, DateRangePicker, DateTimeDisplay, MoneyDisplay, PageBody,
  PageHeader, QueryBar, ResourcePanel, RowActionBar, StatusBadge, dateRangePresets, type Column, type DateRangeValue,
  type RecordLayout,
} from '@ankotti/admin-ui'
import { get } from '@/lib/api'
import { useServerList } from '@/lib/list'
import { EMPTY_RANGE, rangeParams } from '@/lib/dates'
import { ORDER_STATUS, TIER, cycle, minor, options, orderStatus, tier } from '@/lib/format'
import { UserLink } from '@/components/user-link'
import type { PageProps } from '@/shell/workspace-context'
import { ConfirmPaidDialog, RefundDialog, type Order } from './order-actions'

type Provider = { code: string; displayName: string }
const PRESETS = dateRangePresets(['today', 'last7', 'last30', 'thisMonth', 'lastMonth'])

function useProviders() {
  const [items, setItems] = React.useState<Provider[]>([])
  React.useEffect(() => {
    const ac = new AbortController()
    get<{ items: Provider[] }>('/v1/admin/payment-providers', ac.signal).then((r) => setItems(r.items)).catch(() => undefined)
    return () => ac.abort()
  }, [])
  return items
}

const money = (o: Order, cents: number | null | undefined) =>
  <MoneyDisplay value={minor(cents)} {...(o.currency && o.currency !== 'CNY' ? { symbol: `${o.currency} ` } : {})} />

function layout(providerName: (c: string) => string): Partial<RecordLayout<Order>> {
  return {
    title: (o) => `订单 ${o.orderNo}`,
    subtitle: (o) => `${o.username} · ${o.planName}`,
    status: (o) => { const s = orderStatus(o.status); return { label: s.label, tone: s.tone === 'info' ? 'brand' : s.tone } },
    highlights: (o) => [
      { key: 'amount', label: '金额', value: money(o, o.amountCents) },
      { key: 'provider', label: '支付渠道', value: providerName(o.providerCode) },
      ...(o.commissionCents ? [{ key: 'commission', label: o.groupId ? '整单佣金' : '佣金', value: money(o, o.commissionCents) }] : []),
    ],
    sections: [{ key: 'basic', title: '订单信息', fields: [
      { key: 'orderNo', label: '订单号', value: (o) => o.orderNo, copy: true, mono: true },
      { key: 'providerOrderNo', label: '网关订单号', value: (o) => o.providerOrderNo, copy: true, mono: true },
      { key: 'user', label: '用户', value: (o) => o.username },
      { key: 'plan', label: '套餐', value: (o) => o.planName },
      { key: 'tier', label: '等级', value: (o) => tier(o.tier).label },
      { key: 'cycle', label: '周期', value: (o) => cycle(o.billingCycle) },
      { key: 'currency', label: '币种', value: (o) => o.currency },
      { key: 'group', label: '拆单组', value: (o) => o.groupId, mono: true },
      { key: 'createdAt', label: '下单时间', value: (o) => <DateTimeDisplay value={o.createdAt} /> },
      { key: 'paidAt', label: '支付时间', value: (o) => (o.paidAt ? <DateTimeDisplay value={o.paidAt} /> : null) },
    ] }],
  }
}

export function OrdersPage({ params }: PageProps) {
  const providers = useProviders()
  const providerName = (c: string) => providers.find((p) => p.code === c)?.displayName ?? c ?? '—'
  const [range, setRange] = React.useState<DateRangeValue>(EMPTY_RANGE)
  const list = useServerList<Order, { status: string; tier: string; providerCode: string }>('/v1/admin/orders', {
    filters: { status: '', tier: '', providerCode: '' },
    initialFilters: params?.status ? { status: params.status } : undefined,
    sort: { key: 'createdAt', direction: 'desc' },
    extra: rangeParams(range, 'createdFrom', 'createdTo'),
  })
  const [confirming, setConfirming] = React.useState<Order | null>(null)
  const [refunding, setRefunding] = React.useState<Order | null>(null)
  const sum = minor(list.meta.amountSum)

  const columns: Column<Order>[] = [
    { key: 'orderNo', title: '订单号', sortable: true, width: 200, mobile: 'primary', render: (o) => <CopyableValue variant="inline" value={o.orderNo} label="订单号" /> },
    { key: 'username', title: '用户', sortable: true, width: 140, render: (o) => <UserLink id={o.userId} name={o.username} /> },
    { key: 'plan', title: '套餐', maxWidth: 220, truncate: (o) => o.planName, render: (o) => <CellText primary={o.planName} secondary={`${tier(o.tier).label} · ${cycle(o.billingCycle)}`} /> },
    { key: 'amountCents', title: '金额', sortable: true, numeric: true, width: 120, render: (o) => money(o, o.amountCents) },
    { key: 'commission', title: '佣金', numeric: true, width: 120, mobile: 'hidden',
      render: (o) => (o.commissionCents ? <CellText primary={money(o, o.commissionCents)} secondary={o.groupId ? '整单佣金' : '佣金'} /> : '—') },
    { key: 'status', title: '状态', sortable: true, width: 96, render: (o) => { const s = orderStatus(o.status); return <StatusBadge tone={s.tone}>{s.label}</StatusBadge> } },
    { key: 'provider', title: '渠道', width: 120, render: (o) => providerName(o.providerCode) },
    { key: 'createdAt', title: '下单时间', sortable: true, width: 150, render: (o) => <CellDate value={o.createdAt} time /> },
    { key: 'paidAt', title: '支付时间', sortable: true, width: 150, render: (o) => (o.paidAt ? <CellDate value={o.paidAt} time /> : '—') },
    { key: 'actions', title: '操作', kind: 'actions', render: (o) => (
      <RowActionBar label={`订单 ${o.orderNo} 的更多操作`} actions={[
        { key: 'confirm', label: '确认发货', icon: <CheckCheck />, disabled: o.status !== 'pending' && o.status !== 'failed', disabledReason: '只有待支付 / 失败的订单能补单', onSelect: () => setConfirming(o) },
        { key: 'refund', label: '退款', icon: <Undo2 />, destructive: true, disabled: o.status !== 'paid', disabledReason: '只有已支付的订单能退款', onSelect: () => setRefunding(o) },
      ]} />
    ) },
  ]

  return (
    <>
      <PageHeader title="订单" description="全部订单。金额单位为元（按分存储）；拆单订单退款时整组一起退，佣金自动扣回。" />
      <PageBody fill>
        <ResourcePanel title="订单" {...list.panel} unit="笔"
          actions={sum !== null ? <CellText primary={<MoneyDisplay value={sum} />} secondary="已成交合计（当前筛选）" /> : undefined}
          filters={
            <QueryBar {...list.queryBar} placeholder="搜索订单号 / 网关订单号 / 用户名">
              <Choice label="状态" size="sm" clearable placeholder="全部状态" value={list.query.filters.status} onChange={(v) => list.setFilter('status', v)} options={options(ORDER_STATUS)} />
              <Choice label="等级" size="sm" clearable placeholder="全部等级" value={list.query.filters.tier} onChange={(v) => list.setFilter('tier', v)} options={options({ trial: TIER.trial!, standard: TIER.standard!, premium: TIER.premium! })} />
              <Choice label="渠道" size="sm" clearable placeholder="全部渠道" value={list.query.filters.providerCode} onChange={(v) => list.setFilter('providerCode', v)} options={providers.map((p) => ({ value: p.code, label: p.displayName }))} />
              <DateRangePicker size="sm" aria-label="下单日期" value={range} onChange={setRange} presets={PRESETS} clearable fromPlaceholder="下单起" toPlaceholder="下单止" />
            </QueryBar>
          }>
          <DataTable caption="订单列表" columns={columns} rowKey={(o) => o.id} expandRecord={{ layout: layout(providerName) }} {...list.table} />
        </ResourcePanel>
      </PageBody>
      <ConfirmPaidDialog order={confirming} onClose={() => setConfirming(null)} onDone={list.refresh} />
      <RefundDialog order={refunding} onClose={() => setRefunding(null)} onDone={list.refresh} />
    </>
  )
}
