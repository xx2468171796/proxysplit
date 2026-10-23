import * as React from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { listApi } from '@/lib/api'
import { dt, money } from '@/lib/utils'
import { DataTable } from '@/components/data-table'
import { CommissionStatus, LEVEL_NAMES, pct, type Commission } from './shared'

export function CommissionsTab({ refresh }: { refresh: number }) {
  const [sum, setSum] = React.useState(0)
  const columns = React.useMemo<ColumnDef<Commission, unknown>[]>(() => [
    {
      id: 'order', header: '订单',
      cell: ({ row: { original: c } }) => (
        <div className="min-w-0 max-w-[220px]">
          <div className="truncate font-mono text-xs">{c.orderNo ?? c.sourceRef}</div>
          <div className="truncate text-xs text-muted-foreground">{c.planName ?? ''}</div>
        </div>
      ),
    },
    { id: 'buyer', header: '付款人', cell: ({ row: { original: c } }) => c.buyer },
    {
      id: 'beneficiary', header: '拿佣金的人',
      cell: ({ row: { original: c } }) => <span><span className="font-medium">{c.beneficiary}</span> <span className="text-xs text-muted-foreground">（{LEVEL_NAMES[c.level - 1] ?? `${c.level}级`}上级）</span></span>,
    },
    { id: 'base', header: '付款 × 比例', cell: ({ row: { original: c } }) => <span className="tabular-nums text-xs">{money(c.baseCents)} × {pct(c.rateBps)}</span> },
    { id: 'amount', header: '佣金', cell: ({ row: { original: c } }) => <span className="font-medium tabular-nums">{money(c.amountCents)}</span> },
    {
      id: 'status', header: '状态',
      cell: ({ row: { original: c } }) => (
        <div className="space-y-0.5">
          <CommissionStatus value={c.status} />
          <div className="text-xs text-muted-foreground">
            {c.status === 'frozen' ? `${dt(c.availableAt)} 到账` : c.status === 'reversed' ? c.reverseReason ?? '' : ''}
          </div>
        </div>
      ),
    },
    { id: 'createdAt', header: '时间', cell: ({ row: { original: c } }) => <span className="text-xs">{dt(c.createdAt)}</span> },
  ], [])
  return (
    <DataTable<Commission>
      columns={columns}
      searchable
      searchPlaceholder="按拿佣金的人的用户名筛"
      filters={[{ key: 'status', label: '状态', options: [{ label: '冻结中', value: 'frozen' }, { label: '已到账', value: 'available' }, { label: '已冲回', value: 'reversed' }] }]}
      refreshSignal={refresh}
      onLoaded={(r) => setSum(r.amountSum ?? 0)}
      emptyText="还没有佣金。分佣开启后，被推荐用户每付一笔款，这里就会多出上级的佣金。"
      toolbar={<span className="text-sm text-muted-foreground">筛选结果合计 <b className="text-foreground">{money(sum)}</b></span>}
      fetcher={async (q) => {
        const r = await listApi<Commission>('/v1/admin/fenxiao/commissions', { q: q.q, limit: q.limit, offset: q.offset, ...q.filters })
        return { ...r, amountSum: (r as { amountSumCents?: number }).amountSumCents ?? 0 }
      }}
    />
  )
}
