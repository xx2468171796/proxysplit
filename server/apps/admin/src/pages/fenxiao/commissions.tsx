// 佣金流水（T02 列表，分销页分区）：状态筛选、筛选结果合计；待复核的放行 / 作废（作废写原因）；手工调账。
import * as React from 'react'
import { Check, Plus, X } from 'lucide-react'
import {
  Button, CellDate, CellText, Choice, ConfirmDialog, DataTable, FormDialog, FormField, Input, MoneyDisplay, QueryBar,
  ResourcePanel, RowActionBar, StatusBadge, Textarea, useNotify, type Column,
} from '@ankotti/admin-ui'
import { post } from '@/lib/api'
import { useServerList } from '@/lib/list'
import { minor, money, options, yuanToCents } from '@/lib/format'
import { COMMISSION_STATUS, pct, toneOf, type Commission } from './shared'

type Review = { row: Commission; action: 'approve' | 'void' }

function statusNote(c: Commission): string | undefined {
  if (c.status === 'frozen') return `${new Date(c.availableAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} 到账`
  if (c.status === 'held') return c.holdReason ?? undefined
  if (c.status === 'reversed') return c.reverseReason ?? undefined
  return undefined
}

export function CommissionsTab({ onChanged }: { onChanged: () => void }) {
  const notify = useNotify()
  const list = useServerList<Commission, { status: string }>('/v1/admin/fenxiao/commissions', { filters: { status: '' } })
  const [review, setReview] = React.useState<Review | null>(null)
  const [adjust, setAdjust] = React.useState(false)
  const done = () => { list.refresh(); onChanged() }
  const sum = minor(list.meta.amountSumCents ?? null)

  const columns: Column<Commission>[] = [
    { key: 'createdAt', title: '时间', width: 150, render: (c) => <CellDate value={c.createdAt} time /> },
    { key: 'beneficiary', title: '拿佣金的人', width: 130, mobile: 'primary', render: (c) => c.beneficiary },
    { key: 'source', title: '来源', maxWidth: 240, render: (c) => c.sourceKind === 'adjust'
      ? <CellText primary="手工调账" secondary={c.note ?? undefined} />
      : <CellText primary={c.orderNo ?? c.sourceRef} secondary={`${c.planName ?? '—'} · 买家 ${c.buyer}`} /> },
    { key: 'rate', title: '级别 / 比例', width: 140, render: (c) => c.sourceKind === 'adjust' ? '—'
      : <CellText primary={`${c.level} 级 · ${pct(c.rateBps)}`} secondary={<>基数 <MoneyDisplay value={minor(c.baseCents)} /></>} /> },
    { key: 'amount', title: '金额（元）', width: 110, numeric: true, render: (c) => <MoneyDisplay value={minor(c.amountCents)} /> },
    { key: 'status', title: '状态', width: 180, render: (c) => {
      const s = toneOf(COMMISSION_STATUS, c.status)
      return <CellText primary={<StatusBadge tone={s.tone}>{s.label}</StatusBadge>} secondary={statusNote(c)} />
    } },
    { key: 'actions', title: '操作', kind: 'actions', render: (c) => (
      <RowActionBar label={`佣金 ${c.id} 的更多操作`} actions={[
        { key: 'approve', label: '放行', icon: <Check />, disabled: c.status !== 'held', disabledReason: '只有待复核的佣金能放行', onSelect: () => setReview({ row: c, action: 'approve' }) },
        { key: 'void', label: '作废', icon: <X />, destructive: true, menuOnly: false, disabled: c.status !== 'held', disabledReason: '只有待复核的佣金能作废', onSelect: () => setReview({ row: c, action: 'void' }) },
      ]} />
    ) },
  ]

  const r = review
  return (
    <>
      <ResourcePanel title="佣金流水" {...list.panel} unit="笔"
        description="大额单的佣金先挂起「待复核」，放行后按冻结期到账；作废不可恢复。合计按当前筛选的全部结果算。"
        actions={<Button size="sm" variant="ghost" onClick={() => setAdjust(true)}><Plus />手工调账</Button>}
        filters={
          <QueryBar {...list.queryBar} placeholder="搜索拿佣金的人">
            <Choice label="状态" size="sm" clearable placeholder="全部状态" value={list.query.filters.status} onChange={(v) => list.setFilter('status', v)} options={options(COMMISSION_STATUS)} />
          </QueryBar>
        }>
        <DataTable caption="佣金流水" columns={columns} rowKey={(c) => c.id} {...list.table}
          {...(sum !== null && list.total ? { summary: { amount: <MoneyDisplay value={sum} />, createdAt: '筛选结果合计' } } : {})} />
      </ResourcePanel>
      <ConfirmDialog open={!!r} tone={r?.action === 'void' ? 'danger' : 'info'} destructive={r?.action === 'void'}
        title={r?.action === 'void' ? `作废这笔 ${money(r.row.amountCents)} 的佣金？` : `放行这笔 ${money(r?.row.amountCents)} 的佣金？`}
        confirmLabel={r?.action === 'void' ? '作废' : '放行'}
        impact={r ? [`拿佣金的人：${r.row.beneficiary}`, r.action === 'void' ? '作废后不会再到账，原因写进审计' : '放行后按冻结期规则到账'] : []}
        {...(r?.action === 'void' ? { reason: { label: '作废原因', required: true, placeholder: '至少 2 个字，最多 200 字' } } : {})}
        onClose={() => setReview(null)}
        onConfirm={async (reason) => {
          if (!r) return
          if (r.action === 'void' && (reason.trim().length < 2 || reason.trim().length > 200)) throw new Error('作废原因写 2–200 个字')
          await post(`/v1/admin/fenxiao/commissions/${r.row.id}/review`, { action: r.action, ...(r.action === 'void' ? { note: reason.trim() } : {}) })
          notify(r.action === 'void' ? '已作废' : '已放行', 'success')
          done()
        }} />
      {adjust && <AdjustDialog onClose={() => setAdjust(false)} onDone={done} />}
    </>
  )
}

function AdjustDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const notify = useNotify()
  const [d, setD] = React.useState({ username: '', amount: '', reason: '' })
  const set = (p: Partial<typeof d>) => setD((x) => ({ ...x, ...p }))
  return (
    <FormDialog open title="手工调账" description="正数 = 补发佣金（直接可提现），负数 = 扣减。写进佣金流水和审计。"
      dirty={!!(d.username || d.amount || d.reason)} submitLabel="确认调账" onClose={onClose}
      onSubmit={async () => {
        if (!d.username.trim()) throw new Error('请填写用户名')
        const cents = /^-?\d+(\.\d{1,2})?$/.test(d.amount.trim()) ? yuanToCents(d.amount) : null
        if (cents === null || cents === 0) throw new Error('金额填元，最多两位小数，不能为 0（负数表示扣减）')
        if (d.reason.trim().length < 2 || d.reason.trim().length > 200) throw new Error('原因写 2–200 个字')
        await post('/v1/admin/fenxiao/adjustments', { username: d.username.trim(), amountCents: cents, reason: d.reason.trim() })
        notify(`已${cents > 0 ? '补发' : '扣减'} ${money(Math.abs(cents))}`, 'success')
        onDone()
        onClose()
      }}>
      <FormField label="用户名" htmlFor="adj-user" required>
        <Input id="adj-user" value={d.username} onChange={(e) => set({ username: e.target.value })} />
      </FormField>
      <FormField label="金额（元）" htmlFor="adj-amount" required hint="例如 50 或 -12.5">
        <Input id="adj-amount" value={d.amount} inputMode="decimal" onChange={(e) => set({ amount: e.target.value })} />
      </FormField>
      <FormField label="原因" htmlFor="adj-reason" required count={{ value: d.reason.length, max: 200 }}>
        <Textarea id="adj-reason" value={d.reason} maxLength={200} onChange={(e) => set({ reason: e.target.value })} />
      </FormField>
    </FormDialog>
  )
}
