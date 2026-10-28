// 用户的行操作（列表和详情共用）：详情、发放会员、续费 30 天、分销设置、修改密码、暂停 / 恢复、删除。
import * as React from 'react'
import { BadgeCheck, BadgePercent, CalendarPlus, KeyRound, Pause, Play, Trash2, UserRound } from 'lucide-react'
import { ConfirmDialog, errorText, useNotify, type RowAction } from '@ankotti/admin-ui'
import { del, get, patch, post, toQuery, type ListEnvelope } from '@/lib/api'
import { useWorkspace } from '@/shell/workspace-context'
import { GrantDialog, PasswordDialog } from './user-dialogs'
import type { PlanLite } from './types'

export type ActionUser = { id: string; username: string; status: string; fxTier?: string | null }
type Open = { kind: 'grant' | 'password' | 'delete'; user: ActionUser } | null

export function usePlans() {
  const [plans, setPlans] = React.useState<PlanLite[]>([])
  React.useEffect(() => {
    const ac = new AbortController()
    get<ListEnvelope<PlanLite>>('/v1/admin/plans' + toQuery({ limit: 100 }), ac.signal).then((r) => setPlans(r.items)).catch(() => undefined)
    return () => ac.abort()
  }, [])
  return plans
}

export function useUserActions(onChanged: (kind: 'update' | 'delete', user: ActionUser) => void, opts: { inDetail?: boolean } = {}) {
  const notify = useNotify()
  const ws = useWorkspace()
  const plans = usePlans()
  const [open, setOpen] = React.useState<Open>(null)

  const run = async (label: string, user: ActionUser, fn: () => Promise<unknown>) => {
    try { await fn(); notify(label, 'success'); onChanged('update', user) }
    catch (e) { notify(errorText(e, '操作失败'), 'error') }
  }

  const actionsFor = (u: ActionUser): RowAction[] => [
    ...(opts.inDetail ? [] : [{ key: 'detail', label: '详情', icon: <UserRound />, menuOnly: true, onSelect: () => ws.openUser(u.id, u.username) }]),
    { key: 'grant', label: '发放会员', icon: <BadgeCheck />, onSelect: () => setOpen({ kind: 'grant', user: u }) },
    { key: 'extend', label: '续费 30 天', icon: <CalendarPlus />, onSelect: () => void run('已续费 30 天', u, () => post(`/v1/admin/users/${u.id}/extend`, { days: 30 })) },
    { key: 'fenxiao', label: u.fxTier ? '分销设置' : '设为分销商', icon: <BadgePercent />, onSelect: () => ws.openPage('fenxiao', { q: u.username }) },
    { key: 'password', label: '修改密码', icon: <KeyRound />, onSelect: () => setOpen({ kind: 'password', user: u }) },
    u.status === 'active'
      ? { key: 'suspend', label: '暂停账号', icon: <Pause />, onSelect: () => void run('已暂停账号', u, () => patch(`/v1/admin/users/${u.id}/status`, { status: 'suspended' })) }
      : { key: 'resume', label: '恢复账号', icon: <Play />, onSelect: () => void run('已恢复账号', u, () => patch(`/v1/admin/users/${u.id}/status`, { status: 'active' })) },
    { key: 'delete', label: '删除用户', icon: <Trash2 />, destructive: true, onSelect: () => setOpen({ kind: 'delete', user: u }) },
  ]

  const close = () => setOpen(null)
  const element = open && (
    open.kind === 'grant' ? <GrantDialog user={open.user} plans={plans} onClose={close} onDone={() => { notify('已发放会员', 'success'); onChanged('update', open.user) }} />
    : open.kind === 'password' ? <PasswordDialog user={open.user} onClose={close} onDone={() => { notify('密码已修改，原会话已失效', 'success'); onChanged('update', open.user) }} />
    : <ConfirmDialog open tone="danger" destructive title={`删除用户「${open.user.username}」？`} confirmLabel="删除" typeToConfirm={open.user.username}
        impact={['同时删除他的会员授权、设备和登录会话', '有订单等关联记录时不能删除，可改为暂停', '删除后无法恢复']}
        onClose={close}
        onConfirm={async () => {
          try { await del(`/v1/admin/users/${open.user.id}`) } catch (e) { throw new Error(errorText(e, '删除失败')) }
          notify('已删除用户', 'success')
          onChanged('delete', open.user)
        }} />
  )
  return { actionsFor, element, plans }
}
