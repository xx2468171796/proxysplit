// 提现审核（T02 列表，分销页分区）：待审核的标记已打款 / 驳回（驳回必须写原因）。
import * as React from 'react'
import { Check, X } from 'lucide-react'
import {
  CellDate, CellText, Choice, ConfirmDialog, DataTable, MoneyDisplay, QueryBar, ResourcePanel, RowActionBar, StatusBadge,
  useNotify, type Column,
} from '@ankotti/admin-ui'
import { post } from '@/lib/api'
import { useServerList } from '@/lib/list'
import { minor, money, options } from '@/lib/format'
import { METHOD, WITHDRAWAL_STATUS, toneOf, type Withdrawal } from './shared'

type Review = { row: Withdrawal; action: 'paid' | 'rejected' }

export function WithdrawalsTab({ onChanged }: { onChanged: () => void }) {
  const notify = useNotify()
  const list = useServerList<Withdrawal, { status: string }>('/v1/admin/fenxiao/withdrawals', { filters: { status: '' } })
  const [review, setReview] = React.useState<Review | null>(null)

  const columns: Column<Withdrawal>[] = [
    { key: 'createdAt', title: '申请时间', width: 150, render: (w) => <CellDate value={w.createdAt} time /> },
    { key: 'username', title: '用户', width: 130, mobile: 'primary', render: (w) => w.username },
    { key: 'amount', title: '金额（元）', width: 160, numeric: true, render: (w) => (
      <CellText primary={<MoneyDisplay value={minor(w.amountCents)} />}
        secondary={w.feeCents > 0 ? `实转 ${money(w.netCents)}（手续费 ${money(w.feeCents)}）` : undefined} />
    ) },
    { key: 'payee', title: '收款信息', maxWidth: 240, truncate: (w) => `${METHOD[w.payee.method] ?? w.payee.method} ${w.payee.account} ${w.payee.name}`,
      render: (w) => <CellText primary={`${METHOD[w.payee.method] ?? w.payee.method} · ${w.payee.name}`} secondary={w.payee.account} /> },
    { key: 'status', title: '状态', width: 170, render: (w) => {
      const s = toneOf(WITHDRAWAL_STATUS, w.status)
      return <CellText primary={<StatusBadge tone={s.tone}>{s.label}</StatusBadge>}
        secondary={w.reviewedAt ? `${new Date(w.reviewedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}${w.adminNote ? ` · ${w.adminNote}` : ''}` : undefined} />
    } },
    { key: 'actions', title: '操作', kind: 'actions', render: (w) => (
      <RowActionBar label={`${w.username}的提现操作`} actions={[
        { key: 'paid', label: '已打款', icon: <Check />, disabled: w.status !== 'pending', disabledReason: '已经审过', onSelect: () => setReview({ row: w, action: 'paid' }) },
        { key: 'reject', label: '驳回', icon: <X />, destructive: true, menuOnly: false, disabled: w.status !== 'pending', disabledReason: '已经审过', onSelect: () => setReview({ row: w, action: 'rejected' }) },
      ]} />
    ) },
  ]

  const r = review
  const reject = r?.action === 'rejected'
  return (
    <>
      <ResourcePanel title="提现审核" {...list.panel} unit="笔"
        description="先线下按「实转金额」打款到收款账户，再点「已打款」；驳回后金额退回他的可提现余额。"
        filters={
          <QueryBar {...list.queryBar} placeholder="搜索用户名">
            <Choice label="状态" size="sm" clearable placeholder="全部状态" value={list.query.filters.status} onChange={(v) => list.setFilter('status', v)} options={options(WITHDRAWAL_STATUS)} />
          </QueryBar>
        }>
        <DataTable caption="提现申请" columns={columns} rowKey={(w) => w.id} {...list.table} />
      </ResourcePanel>
      <ConfirmDialog open={!!r} tone={reject ? 'danger' : 'info'} destructive={reject}
        title={reject ? `驳回 ${r?.row.username} 的提现？` : `确认已给 ${r?.row.username} 打款 ${money(r?.row.netCents)}？`}
        confirmLabel={reject ? '驳回' : '已打款'}
        impact={r ? [`实转金额：${money(r.row.netCents)}`, `收款：${METHOD[r.row.payee.method] ?? r.row.payee.method} · ${r.row.payee.account} · ${r.row.payee.name}`,
          reject ? '金额退回他的可提现余额' : '标记后不可撤回，记入审计'] : []}
        {...(reject ? { reason: { label: '驳回原因', required: true, placeholder: '至少 2 个字，会告诉用户' } } : {})}
        onClose={() => setReview(null)}
        onConfirm={async (reason) => {
          if (!r) return
          if (reject && reason.trim().length < 2) throw new Error('驳回原因至少 2 个字')
          await post(`/v1/admin/fenxiao/withdrawals/${r.row.id}/review`, { action: r.action, ...(reason.trim() ? { note: reason.trim() } : {}) })
          notify(reject ? '已驳回' : '已标记打款', 'success')
          list.refresh()
          onChanged()
        }} />
    </>
  )
}
