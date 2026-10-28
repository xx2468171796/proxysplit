// 分销（T05 分区合并页）：分销商与团队 / 佣金流水 / 提现审核 / 分佣规则；上方是分佣状态与近 30 天指标。
import * as React from 'react'
import { BadgePercent, FileCog, ReceiptText, Users, Wallet } from 'lucide-react'
import { ContentSkeleton, KpiCard, KpiGrid, PageBody, StatePanel, StatusBadge, TabbedPage, errorText } from '@ankotti/admin-ui'
import { get } from '@/lib/api'
import { money } from '@/lib/format'
import type { PageProps } from '@/shell/workspace-context'
import { CommissionsTab } from './commissions'
import { MembersTab } from './members'
import { PolicyTab } from './policy'
import { WithdrawalsTab } from './withdrawals'
import type { Overview, Policy } from './shared'

function OverviewCards({ ov }: { ov: Overview | null }) {
  const m = (v: number | undefined) => (ov ? money(v ?? 0) : null)
  const note = (text: (o: Overview) => string) => (ov ? { detail: text(ov) } : {})
  return (
    <KpiGrid>
      <KpiCard size="sm" title="近 30 天佣金" value={m(ov?.periodCommissionCents)} {...note((o) => `${o.periodCount} 笔`)} icon={BadgePercent} />
      <KpiCard size="sm" title="冻结中" value={m(ov?.frozenCents)} {...note((o) => `待复核 ${o.heldCommissions} 笔 · ${money(o.heldCents)}`)} />
      <KpiCard size="sm" title="可提现" value={m(ov?.availableCents)} icon={Wallet} />
      <KpiCard size="sm" title="提现中" value={m(ov?.withdrawingCents)} {...note((o) => `${o.pendingWithdrawals} 笔待审核`)} />
      <KpiCard size="sm" title="已提现" value={m(ov?.withdrawnCents)} {...note((o) => `已冲回 ${money(o.reversedCents)}`)} />
      <KpiCard size="sm" title="推荐关系" value={ov ? String(ov.boundMembers) : null} unit="人" {...note((o) => `分销商 ${o.agents} 人`)} icon={Users} />
    </KpiGrid>
  )
}

function policyLine(p: Policy) {
  return `${p.enabled ? '分佣中' : '未开启'} · ${p.mode === 'differential' ? '级差' : '逐级'} · 最多 ${p.maxLevels} 级 · 冻结 ${p.freezeDays} 天 · ${p.openToAll ? '人人可推广' : '仅分销商可推广'}`
}

export function FenxiaoPage({ active, params }: PageProps) {
  const [policy, setPolicy] = React.useState<Policy | null>(null)
  const [ov, setOv] = React.useState<Overview | null>(null)
  const [error, setError] = React.useState('')
  const [tab, setTab] = React.useState('members')
  const load = React.useCallback(() => {
    setError('')
    Promise.all([get<Policy>('/v1/admin/fenxiao/policy'), get<Overview>('/v1/admin/fenxiao/overview?days=30')])
      .then(([p, o]) => { setPolicy(p); setOv(o) })
      .catch((e: unknown) => setError(errorText(e, '分销数据加载失败')))
  }, [])
  const reloadOverview = React.useCallback(() => {
    get<Overview>('/v1/admin/fenxiao/overview?days=30').then(setOv).catch(() => undefined)
  }, [])
  React.useEffect(() => { load() }, [load])
  const presetQ = params?.q ?? ''
  React.useEffect(() => { if (presetQ) setTab('members') }, [presetQ])

  if (error) return <PageBody><StatePanel kind="error" title="分销数据加载失败" message={error} onRetry={load} /></PageBody>
  if (!policy) return <PageBody><ContentSkeleton rows={6} /></PageBody>

  return (
    <TabbedPage title="分销" active={active} value={tab} onValueChange={setTab}
      description={`分佣状态：${policyLine(policy)}。指标为近 30 天。`}
      actions={<StatusBadge tone={policy.enabled ? 'success' : 'neutral'} variant="soft">{policy.enabled ? '分佣中' : '未开启'}</StatusBadge>}
      sections={[
        { id: 'members', label: '分销商与团队', icon: <Users /> },
        { id: 'commissions', label: '佣金流水', icon: <ReceiptText />, ...(ov?.heldCommissions ? { count: ov.heldCommissions, countTone: 'attention' as const } : {}) },
        { id: 'withdrawals', label: '提现审核', icon: <Wallet />, ...(ov?.pendingWithdrawals ? { count: ov.pendingWithdrawals, countTone: 'attention' as const } : {}) },
        { id: 'policy', label: '分佣规则', icon: <FileCog /> },
      ]}
      render={(id) => (
        <>
          {id !== 'policy' && <OverviewCards ov={ov} />}
          {id === 'members' && <MembersTab key={presetQ} policy={policy} presetQ={presetQ} onChanged={reloadOverview} />}
          {id === 'commissions' && <CommissionsTab onChanged={reloadOverview} />}
          {id === 'withdrawals' && <WithdrawalsTab onChanged={reloadOverview} />}
          {id === 'policy' && <PolicyTab policy={policy} onSaved={setPolicy} />}
        </>
      )} />
  )
}
