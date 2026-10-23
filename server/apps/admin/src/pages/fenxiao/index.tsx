import * as React from 'react'
import { get } from '@/lib/api'
import { money } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MembersTab } from './members'
import { CommissionsTab } from './commissions'
import { WithdrawalsTab } from './withdrawals'
import { PolicyTab } from './policy'
import type { Policy } from './shared'

type Overview = {
  boundMembers: number
  agents: number
  pendingWithdrawals: number
  periodCount: number
  frozenCents: number
  availableCents: number
  withdrawingCents: number
  withdrawnCents: number
  reversedCents: number
  periodCommissionCents: number
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  )
}

export default function FenxiaoPage() {
  const [policy, setPolicy] = React.useState<Policy | null>(null)
  const [ov, setOv] = React.useState<Overview | null>(null)
  const [tab, setTab] = React.useState('members')
  const [refresh, setRefresh] = React.useState(0)
  const bump = React.useCallback(() => setRefresh((r) => r + 1), [])

  React.useEffect(() => {
    get<Policy>('/v1/admin/fenxiao/policy').then(setPolicy).catch(() => setPolicy(null))
    get<Overview>('/v1/admin/fenxiao/overview?days=30').then(setOv).catch(() => setOv(null))
  }, [refresh])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">分佣状态</span>
        {policy?.enabled ? <Badge variant="success">已开启</Badge> : <Badge variant="secondary">未开启（只记录推荐关系，不产生佣金）</Badge>}
        {policy && (
          <span className="text-muted-foreground">
            {policy.mode === 'differential' ? '级差模式' : '逐级比例'} · 最多 {policy.maxLevels} 级 · 冻结 {policy.freezeDays} 天 ·{' '}
            {policy.openToAll ? '人人可推广' : '只有分销商 / 经销商可推广'}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="近 30 天佣金" value={money(ov?.periodCommissionCents)} hint={`${ov?.periodCount ?? 0} 笔`} />
        <Stat label="冻结中" value={money(ov?.frozenCents)} hint="退款观察期内" />
        <Stat label="可提现" value={money(ov?.availableCents)} hint="负数 = 退款冲回后的欠款" />
        <Stat label="待打款" value={money(ov?.withdrawingCents)} hint={`${ov?.pendingWithdrawals ?? 0} 笔待审核`} />
        <Stat label="已打款" value={money(ov?.withdrawnCents)} />
        <Stat label="推荐关系 / 分销商" value={`${ov?.boundMembers ?? 0} / ${ov?.agents ?? 0}`} hint={`已冲回 ${money(ov?.reversedCents)}`} />
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="members">分销商与团队</TabsTrigger>
          <TabsTrigger value="commissions">佣金流水</TabsTrigger>
          <TabsTrigger value="withdrawals">
            提现审核{ov?.pendingWithdrawals ? <Badge variant="warning" className="ml-1.5">{ov.pendingWithdrawals}</Badge> : null}
          </TabsTrigger>
          <TabsTrigger value="policy">分佣规则</TabsTrigger>
        </TabsList>
        <TabsContent value="members">{policy && <MembersTab policy={policy} refresh={refresh} onChanged={bump} />}</TabsContent>
        <TabsContent value="commissions"><CommissionsTab refresh={refresh} /></TabsContent>
        <TabsContent value="withdrawals"><WithdrawalsTab refresh={refresh} onChanged={bump} /></TabsContent>
        <TabsContent value="policy">{policy && <PolicyTab policy={policy} onSaved={(p) => { setPolicy(p); bump() }} />}</TabsContent>
      </Tabs>
    </div>
  )
}
