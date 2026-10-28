// 分销商与团队（T02 列表，放在分销页分区里）：搜索、只看分销商、点直推数下钻到他的直推下级。
import * as React from 'react'
import { ArrowLeft, GitBranch, Settings2, UserPlus, Users } from 'lucide-react'
import {
  Button, CellDate, CellText, Choice, DataTable, MoneyDisplay, QueryBar, ResourcePanel, RowActionBar, StatusBadge, type Column,
} from '@ankotti/admin-ui'
import { useServerList } from '@/lib/list'
import { minor } from '@/lib/format'
import { MemberDialog, MoveDialog } from './member-dialogs'
import { ratesText, type Member, type Policy } from './shared'

type Props = { policy: Policy; presetQ: string; onChanged: () => void }

export function MembersTab({ policy, presetQ, onChanged }: Props) {
  const [parent, setParent] = React.useState<Member | null>(null)
  const [edit, setEdit] = React.useState<Member | 'new' | null>(null)
  const [move, setMove] = React.useState<Member | null>(null)
  const list = useServerList<Member, { agentsOnly: string }>('/v1/admin/fenxiao/members', {
    filters: { agentsOnly: '' }, initialSearch: presetQ, extra: { parentUserId: parent?.userId ?? '' },
  })
  // 深链 ?q=用户名：第一次加载没有这个人，直接打开「设为分销商」并预填用户名。
  const opened = React.useRef(false)
  React.useEffect(() => {
    if (opened.current || !presetQ || list.source.loading || list.total === undefined) return
    opened.current = true
    if (list.total === 0) setEdit('new')
  }, [presetQ, list.source.loading, list.total])

  const done = () => { list.refresh(); onChanged() }
  const columns: Column<Member>[] = [
    { key: 'user', title: '用户 / 邀请码', maxWidth: 220, mobile: 'primary', render: (m) => <CellText primary={m.username} secondary={m.code ? (m.enabled ? m.code : `${m.code}（停用）`) : '无邀请码'} /> },
    { key: 'status', title: '身份', width: 180, render: (m) => (
      <CellText primary={<StatusBadge tone={m.tierCode ? (m.enabled ? 'brand' : 'neutral') : 'neutral'}>{m.tierName ?? '普通用户'}</StatusBadge>}
        secondary={m.rateOverride ? `单独 ${ratesText(m.rateOverride, policy.mode)}` : undefined} />
    ) },
    { key: 'parent', title: '上级', width: 120, render: (m) => m.parentUsername ?? '—' },
    { key: 'team', title: '直推 / 团队', width: 110, numeric: true, render: (m) => `${m.directCount} / ${m.teamCount}` },
    { key: 'earned', title: '累计（元）', width: 110, numeric: true, render: (m) => <MoneyDisplay value={minor(m.account.earnedCents - m.account.reversedCents)} /> },
    { key: 'available', title: '可提现 / 冻结', width: 150, numeric: true, render: (m) => (
      <CellText primary={<MoneyDisplay value={minor(m.account.availableCents)} />} secondary={<>冻结 <MoneyDisplay value={minor(m.account.frozenCents)} /></>} />
    ) },
    { key: 'boundAt', title: '绑定时间', width: 150, render: (m) => <CellDate value={m.boundAt} time /> },
    { key: 'actions', title: '操作', kind: 'actions', render: (m) => (
      <RowActionBar label={`${m.username}的更多操作`} actions={[
        { key: 'edit', label: '设置', icon: <Settings2 />, onSelect: () => setEdit(m) },
        { key: 'team', label: '看直推', icon: <Users />, disabled: m.directCount === 0, disabledReason: '没有直推下级', onSelect: () => setParent(m) },
        { key: 'move', label: '改上级', icon: <GitBranch />, onSelect: () => setMove(m) },
      ]} />
    ) },
  ]

  return (
    <>
      <ResourcePanel title={parent ? `${parent.username} 的直推下级` : '分销商与团队'} {...list.panel} unit="人"
        description="身份决定能拿几级、拿多少；点「看直推」看某人的下级。改身份或上级不影响已经产生的佣金。"
        actions={<>
          {parent && <Button size="sm" variant="ghost" onClick={() => setParent(null)}><ArrowLeft />返回全部</Button>}
          <Button size="sm" onClick={() => setEdit('new')}><UserPlus />设为分销商</Button>
        </>}
        filters={
          <QueryBar {...list.queryBar} placeholder="搜索用户名 / 邀请码">
            <Choice label="身份" size="sm" clearable placeholder="全部成员" value={list.query.filters.agentsOnly}
              onChange={(v) => list.setFilter('agentsOnly', v)} options={[{ value: '1', label: '只看分销商 / 经销商' }]} />
          </QueryBar>
        }>
        <DataTable caption="分销成员" columns={columns} rowKey={(m) => m.userId} {...list.table}
          emptyLabel={list.filtered ? '没有符合条件的成员' : '还没有推荐关系。设一个分销商，把他的邀请链接发出去。'} />
      </ResourcePanel>
      {edit && <MemberDialog policy={policy} target={edit} presetUsername={presetQ} onClose={() => setEdit(null)} onDone={done} />}
      {move && <MoveDialog target={move} onClose={() => setMove(null)} onDone={done} />}
    </>
  )
}
