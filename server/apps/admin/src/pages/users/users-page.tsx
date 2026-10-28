// 用户与会员（T02 资源列表页）：搜用户名 / 手机号 / 邮箱 / 备注，按状态、角色、等级、分销、会员、注册日期筛；
// 点用户名在工作标签里打开详情。手机号由服务端打码。
import * as React from 'react'
import { UserPlus } from 'lucide-react'
import {
  Button, CellDate, CellTags, CellText, Choice, DataTable, DateRangePicker, PageBody, PageHeader, QueryBar, ResourcePanel,
  RowActionBar, StatusBadge, dateRangePresets, useNotify, type Column, type DateRangeValue,
} from '@ankotti/admin-ui'
import { get } from '@/lib/api'
import { EMPTY_RANGE, rangeParams } from '@/lib/dates'
import { maskPhone, options, tier, TIER, USER_STATUS, userStatus } from '@/lib/format'
import { useServerList } from '@/lib/list'
import { UserLink } from '@/components/user-link'
import type { PageProps } from '@/shell/workspace-context'
import { CreateUserDialog } from './user-dialogs'
import { loginMethods, type UserRow } from './types'
import { useUserActions } from './use-user-actions'

type UserFilters = { status: string; role: string; tier: string; fenxiao: string; membership: string }
const FILTERS: UserFilters = { status: '', role: '', tier: '', fenxiao: '', membership: '' }
const PAID_TIERS = { trial: TIER.trial!, standard: TIER.standard!, premium: TIER.premium! }

function useFxTierNames() {
  const [names, setNames] = React.useState<Record<string, string>>({})
  React.useEffect(() => {
    const ac = new AbortController()
    get<{ tiers?: { code: string; name: string }[] }>('/v1/admin/fenxiao/policy', ac.signal)
      .then((p) => setNames(Object.fromEntries((p.tiers ?? []).map((t) => [t.code, t.name])))).catch(() => undefined)
    return () => ac.abort()
  }, [])
  return names
}

function membershipCell(u: UserRow) {
  if (!u.planName) return <CellText primary="免费版" secondary="无会员" />
  return <CellText primary={u.planName} secondary={u.lifetime ? '永久' : <CellDate value={u.expiresAt} />} />
}

function fenxiaoCell(u: UserRow, names: Record<string, string>) {
  const items: { label: string; tone?: 'blue' }[] = []
  if (u.fxTier) items.push({ label: `${names[u.fxTier] ?? u.fxTier}${u.fxEnabled === false ? '（停用）' : ''}`, tone: 'blue' })
  if (u.inviter) items.push({ label: `上级 ${u.inviter}` })
  if (u.fxDirect) items.push({ label: `直推 ${u.fxDirect} 人` })
  return items.length ? <CellTags items={items} /> : '—'
}

export function UsersPage(_: PageProps) {
  const notify = useNotify()
  const fxNames = useFxTierNames()
  const [range, setRange] = React.useState<DateRangeValue>(EMPTY_RANGE)
  const [creating, setCreating] = React.useState(false)
  const list = useServerList<UserRow, UserFilters>('/v1/admin/users', {
    filters: FILTERS, sort: { key: 'createdAt', direction: 'desc' }, extra: rangeParams(range, 'createdFrom', 'createdTo'),
  })
  const actions = useUserActions(() => list.refresh())
  const set = (k: keyof UserFilters) => (v: string) => list.setFilter(k, v)

  const columns: Column<UserRow>[] = [
    { key: 'username', title: '用户', sortable: true, maxWidth: 240, mobile: 'primary', truncate: (u) => u.username,
      render: (u) => <CellText primary={<UserLink id={u.id} name={u.username} />} secondary={[maskPhone(u.phone), u.email].filter(Boolean).join(' · ') || '未绑手机 / 邮箱'} /> },
    { key: 'membership', title: '会员 / 到期', width: 170, render: membershipCell },
    { key: 'tier', title: '等级', width: 100, render: (u) => { const t = tier(u.tier ?? 'free'); return <StatusBadge tone={t.tone}>{t.label}</StatusBadge> } },
    { key: 'login', title: '登录方式', width: 140, mobile: 'hidden', render: (u) => <CellTags items={loginMethods(u).map((label) => ({ label }))} /> },
    { key: 'fenxiao', title: '推荐 / 分销', maxWidth: 220, mobile: 'hidden', render: (u) => fenxiaoCell(u, fxNames) },
    { key: 'devices', title: '设备', width: 70, numeric: true, render: (u) => u.devices },
    { key: 'status', title: '状态', width: 90, sortable: true, render: (u) => { const s = userStatus(u.status); return <StatusBadge tone={s.tone}>{u.role === 'admin' ? `${s.label} · 管理员` : s.label}</StatusBadge> } },
    { key: 'createdAt', title: '注册日期', width: 130, sortable: true, render: (u) => <CellDate value={u.createdAt} /> },
    { key: 'actions', title: '操作', kind: 'actions', render: (u) => <RowActionBar label={`${u.username}的更多操作`} actions={actions.actionsFor(u)} /> },
  ]

  return (
    <>
      <PageHeader title="用户与会员" description="免费用户只能绑 1 台设备；会员设备数 = 免费名额 + 套餐设备数。手机号中间 4 位已打码。"
        actions={<Button onClick={() => setCreating(true)}><UserPlus />新建用户</Button>} />
      <PageBody fill>
        <ResourcePanel title="用户" {...list.panel} unit="人"
          filters={
            <QueryBar {...list.queryBar} placeholder="用户名 / 手机号 / 邮箱 / 备注">
              <Choice label="状态" size="sm" clearable placeholder="全部状态" value={list.query.filters.status} onChange={set('status')} options={options(USER_STATUS)} />
              <Choice label="会员" size="sm" clearable placeholder="会员状态" value={list.query.filters.membership} onChange={set('membership')}
                options={[{ value: 'active', label: '会员中' }, { value: 'expiring', label: '7 天内到期' }, { value: 'expired', label: '免费 / 已过期' }]} />
              <Choice label="等级" size="sm" clearable placeholder="全部等级" value={list.query.filters.tier} onChange={set('tier')} options={options(PAID_TIERS)} />
              <Choice label="分销" size="sm" clearable placeholder="分销身份" value={list.query.filters.fenxiao} onChange={set('fenxiao')}
                options={[{ value: 'agent', label: '分销商' }, { value: 'referred', label: '被推荐用户' }]} />
              <Choice label="角色" size="sm" clearable placeholder="全部角色" value={list.query.filters.role} onChange={set('role')}
                options={[{ value: 'user', label: '用户' }, { value: 'admin', label: '管理员' }]} />
              <DateRangePicker size="sm" aria-label="注册日期" fromPlaceholder="注册起" toPlaceholder="注册止" value={range} onChange={setRange}
                presets={dateRangePresets(['today', 'last7', 'last30', 'thisMonth'])} />
            </QueryBar>
          }>
          <DataTable caption="用户列表" columns={columns} rowKey={(u) => u.id} rowHeight="medium" {...list.table} />
        </ResourcePanel>
      </PageBody>
      {actions.element}
      {creating && <CreateUserDialog plans={actions.plans} onClose={() => setCreating(false)}
        onDone={() => { setCreating(false); notify('已创建用户', 'success'); list.refresh() }} />}
    </>
  )
}
