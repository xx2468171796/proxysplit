// 分成流水：按代理商 / 状态 / 时间筛选，合计按筛选结果、按状态分开（应付 = 待结算）；勾选待结算的批量「标记已结算」（线下打款后点，写审计）。
import * as React from 'react'
import { Ban, CheckCheck, ShieldCheck } from 'lucide-react'
import {
  CellDate, CellText, Choice, ConfirmDialog, DataTable, DateRangePicker, Input, MoneyDisplay, QueryBar, ResourcePanel,
  StatusBadge, dateRangePresets, useNotify, type Column, type DateRangeValue,
} from '@ankotti/admin-ui'
import { post } from '@/lib/api'
import { useServerList } from '@/lib/list'
import { EMPTY_RANGE, rangeParams } from '@/lib/dates'
import { minor, money, options } from '@/lib/format'
import { DEALER_COMMISSION_STATUS, pct, toneOf, type DealerCommission } from './shared'

const PRESETS = dateRangePresets(['today', 'last7', 'last30'])

export function CommissionsTab({ dealer, onDealerChange }: { dealer: string; onDealerChange: (v: string) => void }) {
  const notify = useNotify()
  const [range, setRange] = React.useState<DateRangeValue>(EMPTY_RANGE)
  const validDealer = /^[a-z0-9-]{2,30}$/.test(dealer) ? dealer : ''
  const list = useServerList<DealerCommission, { status: string }>('/v1/admin/dealers/commissions', {
    filters: { status: '' }, extra: { dealer: validDealer, ...rangeParams(range, 'from', 'to') },
  })
  const rows = list.table.rows
  const [selected, setSelected] = React.useState<string[]>([])
  const [confirm, setConfirm] = React.useState<'settle' | 'approve' | 'void' | null>(null)
  // 翻页 / 筛选 / 刷新后清掉勾选（依赖数据对象本身，加载中的空数组每次都是新的）
  React.useEffect(() => { setSelected([]) }, [list.source.data])
  const picked = rows.filter((c) => selected.includes(String(c.id)))
  const pickedCents = picked.reduce((a, c) => a + c.commissionCents, 0)
  // 勾选的要么全是待结算（可结算），要么全是待复核（可复核 / 作废）；混着选时不给操作，免得点错。
  const allPending = picked.length > 0 && picked.every((c) => c.status === 'pending')
  const allReview = picked.length > 0 && picked.every((c) => c.status === 'review')
  const review = async (action: 'approve' | 'void', note: string) => {
    if (note.trim().length > 200) throw new Error('备注最多 200 字')
    const r = await post<{ changed: number; commissionCents: number }>('/v1/admin/dealers/commissions/review',
      { ids: picked.map((c) => c.id), action, note: note.trim() })
    notify(`${action === 'approve' ? '已复核通过' : '已作废'} ${r.changed} 笔，合计 ${money(r.commissionCents)}`, 'success')
    setSelected([])
    list.refresh()
  }
  // 合计按状态分开（服务端给）：应付只看待结算；待复核 / 已结算 / 已作废单列，不混进一个数。
  const sums = list.meta.sums
  const payable = minor(sums?.pendingCents ?? null)

  const columns: Column<DealerCommission>[] = [
    { key: 'createdAt', title: '时间', width: 150, render: (c) => <CellDate value={c.createdAt} time /> },
    { key: 'dealer', title: '代理商', width: 110, render: (c) => c.dealerSlug },
    { key: 'user', title: '客户', maxWidth: 220, mobile: 'primary', render: (c) => <CellText primary={c.username || c.userId} secondary={`来源 ${c.source}`} /> },
    { key: 'gross', title: '实付（元）', width: 110, numeric: true, render: (c) => <MoneyDisplay value={minor(c.grossCents)} /> },
    { key: 'bps', title: '比例', width: 80, numeric: true, render: (c) => pct(c.bps) },
    { key: 'amount', title: '分成（元）', width: 110, numeric: true, render: (c) => <MoneyDisplay value={minor(c.commissionCents)} /> },
    { key: 'status', title: '状态', width: 180, render: (c) => {
      const s = toneOf(DEALER_COMMISSION_STATUS, c.status)
      return <CellText primary={<StatusBadge tone={s.tone}>{s.label}</StatusBadge>}
        secondary={c.note || (c.settledAt ? <CellDate value={c.settledAt} time /> : undefined)} />
    } },
  ]

  return (
    <>
      <ResourcePanel title="分成流水" {...list.panel} unit="笔"
        description="每笔已付订单（拆单按整组）一行，比例是下单时的快照；退款自动作废。买家与代理商本人、或与该代理商多个客户同设备 / 同注册来源的记成「待复核」，复核通过才进应付。合计行是筛选结果里待结算的分成（应付），其余状态另列。"
        filters={
          <QueryBar {...list.queryBar} placeholder="搜索（暂不支持，按右侧筛选）">
            <Input size="sm" aria-label="代理商标识" placeholder="代理商标识，如 wen" value={dealer}
              onChange={(e) => onDealerChange(e.target.value.trim().toLowerCase())} />
            <Choice label="状态" size="sm" clearable placeholder="全部状态" value={list.query.filters.status}
              onChange={(v) => list.setFilter('status', v)} options={options(DEALER_COMMISSION_STATUS)} />
            <DateRangePicker size="sm" aria-label="时间范围" value={range} onChange={setRange} presets={PRESETS} />
          </QueryBar>
        }>
        <DataTable caption="分成流水" columns={columns} rowKey={(c) => String(c.id)} {...list.table}
          selected={selected} onSelectionChange={setSelected} isRowSelectable={(c) => c.status === 'pending' || c.status === 'review'}
          bulkNote={allPending || allReview ? `合计 ${money(pickedCents)}` : '待结算和待复核请分开勾选'}
          bulkActions={allPending ? [{ key: 'settle', label: '标记已结算', icon: <CheckCheck />, onSelect: () => setConfirm('settle') }]
            : allReview ? [
              { key: 'approve', label: '复核通过', icon: <ShieldCheck />, onSelect: () => setConfirm('approve') },
              { key: 'void', label: '作废', icon: <Ban />, onSelect: () => setConfirm('void') },
            ] : []}
          {...(payable !== null && list.total ? { summary: {
            createdAt: '待结算合计（应付）', amount: <MoneyDisplay value={payable} />,
            status: `待复核 ${money(sums?.reviewCents ?? 0)} · 已结算 ${money(sums?.settledCents ?? 0)} · 已作废 ${money(sums?.voidCents ?? 0)}`,
          } } : {})} />
      </ResourcePanel>
      <ConfirmDialog open={confirm === 'approve'} tone="info" title={`复核通过 ${picked.length} 笔分成？`} confirmLabel="复核通过"
        impact={[`合计 ${money(pickedCents)}`, '通过后进入待结算（应付），之后可以结算打款；操作写进审计']}
        reason={{ label: '备注（可选）', placeholder: '例如 已核实是不同的人，最多 200 字' }}
        onClose={() => setConfirm(null)} onConfirm={(note) => review('approve', note)} />
      <ConfirmDialog open={confirm === 'void'} tone="danger" title={`作废 ${picked.length} 笔分成？`} confirmLabel="作废"
        impact={[`合计 ${money(pickedCents)}`, '作废后不再付给代理商，不能恢复；操作写进审计']}
        reason={{ label: '备注（可选）', placeholder: '例如 代理商自己下的单，最多 200 字' }}
        onClose={() => setConfirm(null)} onConfirm={(note) => review('void', note)} />
      <ConfirmDialog open={confirm === 'settle'} tone="info" title={`把 ${picked.length} 笔分成标记为已结算？`} confirmLabel="标记已结算"
        impact={[`合计 ${money(pickedCents)}`, '确认线下已打款后再点；操作写进审计']}
        reason={{ label: '备注（可选）', placeholder: '例如 转账单号 / 结算批次，最多 200 字' }}
        onClose={() => setConfirm(null)}
        onConfirm={async (note) => {
          if (note.trim().length > 200) throw new Error('备注最多 200 字')
          const r = await post<{ settled: number; commissionCents: number }>('/v1/admin/dealers/commissions/settle',
            { ids: picked.map((c) => c.id), note: note.trim() })
          notify(`已结算 ${r.settled} 笔，合计 ${money(r.commissionCents)}`, 'success')
          setSelected([])
          list.refresh()
        }} />
    </>
  )
}
