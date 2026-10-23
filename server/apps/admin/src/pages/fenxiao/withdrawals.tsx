import * as React from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { toast } from 'sonner'
import { listApi, post } from '@/lib/api'
import { dt, money } from '@/lib/utils'
import { DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { METHOD, WithdrawalStatus, type Withdrawal } from './shared'

type Review = { row: Withdrawal; action: 'paid' | 'rejected' }

export function WithdrawalsTab({ refresh, onChanged }: { refresh: number; onChanged: () => void }) {
  const [review, setReview] = React.useState<Review | null>(null)
  const columns = React.useMemo<ColumnDef<Withdrawal, unknown>[]>(() => [
    { id: 'user', header: '申请人', cell: ({ row: { original: w } }) => <span className="font-medium">{w.username}</span> },
    { id: 'amount', header: '金额', cell: ({ row: { original: w } }) => <span className="font-semibold tabular-nums">{money(w.amountCents)}</span> },
    {
      id: 'payee', header: '收款信息',
      cell: ({ row: { original: w } }) => (
        <div className="text-xs">
          <div>{METHOD[w.payee.method] ?? w.payee.method} · {w.payee.name}</div>
          <div className="font-mono text-muted-foreground">{w.payee.account}</div>
        </div>
      ),
    },
    {
      id: 'status', header: '状态',
      cell: ({ row: { original: w } }) => <div className="space-y-0.5"><WithdrawalStatus value={w.status} /><div className="text-xs text-muted-foreground">{w.adminNote ?? ''}</div></div>,
    },
    { id: 'createdAt', header: '申请时间', cell: ({ row: { original: w } }) => <span className="text-xs">{dt(w.createdAt)}</span> },
    {
      id: 'actions', header: '',
      cell: ({ row: { original: w } }) => w.status !== 'pending' ? <span className="text-xs text-muted-foreground">{dt(w.reviewedAt)}</span> : (
        <div className="flex justify-end gap-1">
          <Button size="sm" onClick={() => setReview({ row: w, action: 'paid' })}>已打款</Button>
          <Button size="sm" variant="outline" onClick={() => setReview({ row: w, action: 'rejected' })}>驳回</Button>
        </div>
      ),
    },
  ], [])
  return (
    <>
      <DataTable<Withdrawal>
        columns={columns}
        searchable
        searchPlaceholder="按申请人用户名筛"
        filters={[{ key: 'status', label: '状态', options: [{ label: '待审核', value: 'pending' }, { label: '已打款', value: 'paid' }, { label: '已驳回', value: 'rejected' }] }]}
        refreshSignal={refresh}
        emptyText="没有提现申请。"
        fetcher={(q) => listApi<Withdrawal>('/v1/admin/fenxiao/withdrawals', { q: q.q, limit: q.limit, offset: q.offset, ...q.filters })}
      />
      <ReviewDialog review={review} onClose={() => setReview(null)} onDone={onChanged} />
    </>
  )
}

function ReviewDialog({ review, onClose, onDone }: { review: Review | null; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => setNote(''), [review])
  const paid = review?.action === 'paid'
  async function submit() {
    if (!review) return
    setBusy(true)
    try {
      await post(`/v1/admin/fenxiao/withdrawals/${review.row.id}/review`, { action: review.action, ...(note.trim() ? { note: note.trim() } : {}) })
      toast.success(paid ? '已记为打款' : '已驳回，金额退回他的可提现余额')
      onClose(); onDone()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Dialog open={!!review} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{paid ? '确认已打款' : '驳回提现'}</DialogTitle>
          <DialogDescription>
            {paid
              ? '系统不会自动转账：请先在支付宝 / 银行把钱转给对方，转完再点确认。'
              : '驳回后这笔钱退回他的可提现余额，他可以改好收款信息再申请。'}
          </DialogDescription>
        </DialogHeader>
        {review && (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border p-3">
              <div className="text-2xl font-semibold">{money(review.row.amountCents)}</div>
              <div className="mt-1">{METHOD[review.row.payee.method] ?? review.row.payee.method} · {review.row.payee.name} · <span className="font-mono">{review.row.payee.account}</span></div>
            </div>
            <Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={paid ? '备注（可填转账流水号）' : '驳回原因（他能看到）'} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button variant={paid ? 'default' : 'destructive'} disabled={busy || (!paid && note.trim().length < 2)} onClick={submit}>{busy ? '处理中…' : paid ? '确认已打款' : '确认驳回'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
