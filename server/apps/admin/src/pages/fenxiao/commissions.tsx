import * as React from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { listApi, post } from '@/lib/api'
import { dt, money } from '@/lib/utils'
import { DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CommissionStatus, LEVEL_NAMES, pct, type Commission } from './shared'

type Review = { row: Commission; action: 'approve' | 'void' }

function StatusCell({ c }: { c: Commission }) {
  const sub = c.status === 'frozen' ? `${dt(c.availableAt)} 到账` : c.status === 'held' ? c.holdReason ?? '' : c.status === 'reversed' ? c.reverseReason ?? '' : ''
  return (
    <div className="space-y-0.5">
      <CommissionStatus value={c.status} />
      <div className="max-w-[220px] truncate text-xs text-muted-foreground" title={sub}>{sub}</div>
    </div>
  )
}

export function CommissionsTab({ refresh, onChanged }: { refresh: number; onChanged: () => void }) {
  const [sum, setSum] = React.useState(0)
  const [review, setReview] = React.useState<Review | null>(null)
  const [adjust, setAdjust] = React.useState(false)
  const columns = React.useMemo<ColumnDef<Commission, unknown>[]>(() => [
    {
      id: 'order', header: '订单',
      cell: ({ row: { original: c } }) => c.sourceKind === 'adjust' ? (
        <div className="min-w-0 max-w-[220px]"><div className="text-xs font-medium">手工调账</div><div className="truncate text-xs text-muted-foreground" title={c.note ?? ''}>{c.note}</div></div>
      ) : (
        <div className="min-w-0 max-w-[220px]">
          <div className="truncate font-mono text-xs">{c.orderNo ?? c.sourceRef}</div>
          <div className="truncate text-xs text-muted-foreground">{c.planName ?? ''}</div>
        </div>
      ),
    },
    { id: 'buyer', header: '付款人', cell: ({ row: { original: c } }) => c.sourceKind === 'adjust' ? '—' : c.buyer },
    {
      id: 'beneficiary', header: '拿佣金的人',
      cell: ({ row: { original: c } }) => <span><span className="font-medium">{c.beneficiary}</span> {c.level > 0 && <span className="text-xs text-muted-foreground">（{LEVEL_NAMES[c.level - 1] ?? `${c.level}级`}上级）</span>}</span>,
    },
    { id: 'base', header: '付款 × 比例', cell: ({ row: { original: c } }) => c.sourceKind === 'adjust' ? '—' : <span className="tabular-nums text-xs">{money(c.baseCents)} × {pct(c.rateBps)}</span> },
    { id: 'amount', header: '佣金', cell: ({ row: { original: c } }) => <span className="font-medium tabular-nums">{money(c.amountCents)}</span> },
    { id: 'status', header: '状态', cell: ({ row: { original: c } }) => <StatusCell c={c} /> },
    { id: 'createdAt', header: '时间', cell: ({ row: { original: c } }) => <span className="text-xs">{dt(c.createdAt)}</span> },
    {
      id: 'actions', header: '',
      cell: ({ row: { original: c } }) => c.status !== 'held' ? null : (
        <div className="flex justify-end gap-1">
          <Button size="sm" onClick={() => setReview({ row: c, action: 'approve' })}>放行</Button>
          <Button size="sm" variant="outline" onClick={() => setReview({ row: c, action: 'void' })}>作废</Button>
        </div>
      ),
    },
  ], [])
  return (
    <>
      <DataTable<Commission>
        columns={columns}
        searchable
        searchPlaceholder="按拿佣金的人的用户名筛"
        filters={[{ key: 'status', label: '状态', options: [{ label: '待复核', value: 'held' }, { label: '冻结中', value: 'frozen' }, { label: '已到账', value: 'available' }, { label: '已冲回', value: 'reversed' }] }]}
        refreshSignal={refresh}
        onLoaded={(r) => setSum(r.amountSum ?? 0)}
        emptyText="还没有佣金。分佣开启后，被推荐用户每付一笔款，这里就会多出上级的佣金。"
        toolbar={
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">筛选结果合计 <b className="text-foreground">{money(sum)}</b></span>
            <Button variant="outline" onClick={() => setAdjust(true)}><SlidersHorizontal className="h-4 w-4" />调账</Button>
          </div>
        }
        fetcher={async (q) => {
          const r = await listApi<Commission>('/v1/admin/fenxiao/commissions', { q: q.q, limit: q.limit, offset: q.offset, ...q.filters })
          return { ...r, amountSum: (r as { amountSumCents?: number }).amountSumCents ?? 0 }
        }}
      />
      <ReviewDialog review={review} onClose={() => setReview(null)} onDone={onChanged} />
      <AdjustDialog open={adjust} onClose={() => setAdjust(false)} onDone={onChanged} />
    </>
  )
}

function ReviewDialog({ review, onClose, onDone }: { review: Review | null; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => setNote(''), [review])
  const approve = review?.action === 'approve'
  async function submit() {
    if (!review) return
    setBusy(true)
    try {
      await post(`/v1/admin/fenxiao/commissions/${review.row.id}/review`, { action: review.action, ...(note.trim() ? { note: note.trim() } : {}) })
      toast.success(approve ? '已放行' : '已作废，这笔佣金不再发放')
      onClose(); onDone()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Dialog open={!!review} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{approve ? '放行这笔佣金' : '作废这笔佣金'}</DialogTitle>
          <DialogDescription>
            {approve ? '放行后按正常流程走：冻结期没过先冻结，过了直接可提现。' : '作废后这笔佣金不再发给他，记为冲回；他能看到作废原因。'}
          </DialogDescription>
        </DialogHeader>
        {review && (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border p-3">
              <div className="text-2xl font-semibold">{money(review.row.amountCents)}</div>
              <div className="mt-1">{review.row.beneficiary} · 付款人 {review.row.buyer} · {review.row.orderNo ?? review.row.sourceRef}</div>
              {review.row.holdReason && <div className="mt-1 text-xs text-muted-foreground">挂起原因：{review.row.holdReason}</div>}
            </div>
            <Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={approve ? '备注（可不填）' : '作废原因（他能看到）'} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button variant={approve ? 'default' : 'destructive'} disabled={busy || (!approve && note.trim().length < 2)} onClick={submit}>{busy ? '处理中…' : approve ? '确认放行' : '确认作废'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AdjustDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [username, setUsername] = React.useState('')
  const [yuan, setYuan] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => { if (open) { setUsername(''); setYuan(''); setReason('') } }, [open])
  const cents = Math.round(Number(yuan) * 100)
  const valid = username.trim() && Number.isFinite(cents) && cents !== 0 && /^-?\d+(\.\d{1,2})?$/.test(yuan.trim()) && reason.trim().length >= 2
  async function submit() {
    setBusy(true)
    try {
      await post('/v1/admin/fenxiao/adjustments', { username: username.trim(), amountCents: cents, reason: reason.trim() })
      toast.success(cents > 0 ? `已给 ${username.trim()} 补发 ${money(cents)}` : `已从 ${username.trim()} 扣减 ${money(-cents)}`)
      onClose(); onDone()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>手工调账</DialogTitle>
          <DialogDescription>正数补发、负数扣减，直接进他的可提现余额（扣成负数就是欠款，后面的佣金先抵）。原因他能看到，操作会记审计。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <label className="grid gap-1.5"><span className="text-muted-foreground">用户名</span><Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="推广人的账号" /></label>
          <label className="grid gap-1.5"><span className="text-muted-foreground">金额（元，负数为扣减）</span><Input value={yuan} onChange={(e) => setYuan(e.target.value)} placeholder="例如 50 或 -20" inputMode="decimal" /></label>
          <label className="grid gap-1.5"><span className="text-muted-foreground">原因</span><Input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="例如：10 月活动奖励" /></label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={busy || !valid} onClick={submit}>{busy ? '处理中…' : '确认调账'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
