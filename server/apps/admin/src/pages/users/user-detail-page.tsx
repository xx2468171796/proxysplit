// 用户详情（工作标签，T05 分区合并页）：资料 / 会员与订单 / 设备 / 云端配置 / 日志·审计。
// 数据：GET /v1/admin/users/:id（一次拿全）+ 进入「云端配置」时才请求 /users/:id/cloud。
import * as React from 'react'
import { BadgeCheck, Cloud, FileClock, IdCard, Laptop, ReceiptText } from 'lucide-react'
import { Button, ContentSkeleton, MoreMenu, StatePanel, TabbedPage, errorText } from '@ankotti/admin-ui'
import { get } from '@/lib/api'
import { useWorkspace } from '@/shell/workspace-context'
import { currentLicense, type UserDetail } from './types'
import { useUserActions } from './use-user-actions'
import { DevicesSection, MembershipSection, ProfileSection } from './user-detail-sections'
import { CloudSection, LogsSection } from './user-detail-cloud'

function useUserDetail(userId: string) {
  const [state, setState] = React.useState<{ data?: UserDetail; error?: string; loading: boolean }>({ loading: true })
  const [nonce, setNonce] = React.useState(0)
  React.useEffect(() => {
    const ac = new AbortController()
    setState((s) => ({ ...s, loading: true }))
    get<UserDetail>(`/v1/admin/users/${userId}`, ac.signal)
      .then((data) => setState({ data, loading: false }))
      .catch((e: unknown) => { if (!ac.signal.aborted) setState((s) => ({ ...s, loading: false, error: errorText(e, '用户详情加载失败') })) })
    return () => ac.abort()
  }, [userId, nonce])
  return { ...state, reload: () => setNonce((n) => n + 1) }
}

export function UserDetailPage({ userId, active }: { userId: string; active: boolean }) {
  const ws = useWorkspace()
  const detail = useUserDetail(userId)
  const [tab, setTab] = React.useState('profile')
  const actions = useUserActions((kind) => (kind === 'delete' ? ws.close(`user:${userId}`) : detail.reload()), { inDetail: true })

  if (!detail.data) {
    if (detail.loading) return <ContentSkeleton rows={8} label="正在加载用户详情" />
    const notFound = detail.error?.includes('不存在')
    return <StatePanel size="page" kind={notFound ? 'not-found' : 'error'} title={notFound ? '用户不存在' : '用户详情加载失败'}
      message={detail.error ?? ''} {...(notFound ? {} : { onRetry: detail.reload })} />
  }
  const d = detail.data
  const u = { id: d.user.id, username: d.user.username, status: d.user.status, fxTier: d.fenxiao?.tierCode ?? null }
  const [grant, ...rest] = actions.actionsFor(u)
  const lic = currentLicense(d.licenses)

  return (
    <>
      <TabbedPage
        title={d.user.username}
        description={`用户 ID ${d.user.id}`}
        active={active}
        value={tab}
        onValueChange={setTab}
        actions={<>
          <Button size="sm" onClick={grant?.onSelect}><BadgeCheck />{lic ? '续发 / 改发会员' : '发放会员'}</Button>
          <MoreMenu label={`${d.user.username}的更多操作`} sections={[
            { items: rest.filter((a) => !a.destructive).map((a) => ({ key: a.key, label: a.label, icon: a.icon, onSelect: a.onSelect })) },
            { items: rest.filter((a) => a.destructive).map((a) => ({ key: a.key, label: a.label, icon: a.icon, danger: true, onSelect: a.onSelect })) },
          ]} />
        </>}
        sections={[
          { id: 'profile', label: '资料', icon: <IdCard /> },
          { id: 'membership', label: '会员与订单', icon: <ReceiptText />, count: d.orders.length },
          { id: 'devices', label: '设备', icon: <Laptop />, count: d.devices.filter((x) => !x.revoked).length },
          { id: 'cloud', label: '云端配置', icon: <Cloud /> },
          { id: 'logs', label: '日志·审计', icon: <FileClock />, count: d.activity.length },
        ]}
        render={(id, isActive) => {
          if (id === 'profile') return <ProfileSection detail={d} />
          if (id === 'membership') return <MembershipSection detail={d} />
          if (id === 'devices') return <DevicesSection detail={d} />
          if (id === 'cloud') return <CloudSection userId={d.user.id} active={isActive} member={!!lic && lic.tier !== 'trial'} />
          return <LogsSection detail={d} />
        }}
      />
      {actions.element}
    </>
  )
}
