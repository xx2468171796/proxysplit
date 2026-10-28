// 订单的两个动作：确认发货（补单）与退款（原因必填、写进审计，拆单整组退）。
import { ConfirmDialog, errorText, useNotify } from '@ankotti/admin-ui'
import { post } from '@/lib/api'
import { money } from '@/lib/format'

export type Order = {
  id: string; orderNo: string; username: string; userId?: string | null; planName: string; tier: string; billingCycle: string
  amountCents: number; currency: string; status: string; providerCode: string; providerOrderNo: string | null
  paidAt: string | null; createdAt: string; commissionCents?: number | null; groupId?: string | null
}
type RefundResult = { ok: boolean; orders: number; licenseAdjusted: boolean; removedDays?: number | null }

export function ConfirmPaidDialog({ order, onClose, onDone }: { order: Order | null; onClose: () => void; onDone: () => void }) {
  const notify = useNotify()
  return (
    <ConfirmDialog
      open={!!order}
      title={`确认订单 ${order?.orderNo ?? ''} 已收款并发货？`}
      tone="warning"
      confirmLabel="确认发货"
      impact={[`用户 ${order?.username ?? ''} 将获得「${order?.planName ?? ''}」会员权益`, '只在确认钱已到账（商户后台能查到）时使用，会写进审计日志']}
      onClose={onClose}
      onConfirm={async () => {
        if (!order) return
        try {
          const r = await post<{ ok: boolean; duplicate?: boolean }>(`/v1/admin/orders/${order.orderNo}/confirm`)
          notify(r.duplicate ? '该订单已是已支付，无需重复发货' : '已确认收款并发放会员', r.duplicate ? 'info' : 'success')
          onDone()
        } catch (e) {
          throw new Error(errorText(e, '确认失败'))
        }
      }}
    />
  )
}

function refundMessage(r: RefundResult): { title: string; tone: 'success' | 'warning' } {
  const parts = r.orders > 1 ? `（含同一笔拆单的 ${r.orders} 张子单）` : ''
  if (!r.licenseAdjusted) return { title: `已标记退款${parts}。该订单早于权益流水记录，会员时长未自动扣回，请到用户页手动调整`, tone: 'warning' }
  if (r.removedDays === -1) return { title: `已退款${parts}，已撤销永久会员，恢复到购买前的到期时间`, tone: 'success' }
  if (r.removedDays) return { title: `已退款${parts}，扣回未使用的 ${r.removedDays} 天会员`, tone: 'success' }
  return { title: `已退款${parts}。这笔订单的时长已用完，无需扣回`, tone: 'success' }
}

export function RefundDialog({ order, onClose, onDone }: { order: Order | null; onClose: () => void; onDone: () => void }) {
  const notify = useNotify()
  const impact = [
    `金额 ${money(order?.amountCents)}；钱请在支付宝商户后台原路退回`,
    `扣回 ${order?.username ?? ''} 这笔「${order?.planName ?? ''}」还没用掉的会员时间（已用掉的不扣）；拆单订单整组退款`,
    ...(order?.commissionCents ? [`这笔给上级分过 ${money(order.commissionCents)} 佣金，退款后会自动扣回（已提现的记成欠款）`] : []),
  ]
  return (
    <ConfirmDialog
      open={!!order}
      title={`退款订单 ${order?.orderNo ?? ''}？`}
      tone="danger"
      destructive
      confirmLabel="确认退款"
      impact={impact}
      reason={{ label: '退款原因（会写进审计日志，2–200 字）', required: true, placeholder: '例如：用户重复购买，已在支付宝原路退回' }}
      onClose={onClose}
      onConfirm={async (reason) => {
        if (!order) return
        const text = reason.trim()
        if (text.length < 2 || text.length > 200) throw new Error('退款原因需要 2–200 个字')
        try {
          const r = await post<RefundResult>(`/v1/admin/orders/${order.orderNo}/refund`, { reason: text })
          const m = refundMessage(r)
          notify.show({ title: m.title, tone: m.tone })
          onDone()
        } catch (e) {
          throw new Error(errorText(e, '退款失败'))
        }
      }}
    />
  )
}
