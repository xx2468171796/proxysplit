import * as React from 'react'
import { Link } from 'react-router-dom'
import { Network } from 'lucide-react'
import { get } from '@/lib/api'
import { money } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

type Overview = { boundMembers: number; agents: number; pendingWithdrawals: number; withdrawingCents: number; periodCommissionCents: number; periodCount: number; availableCents: number }

/** 运营概览里的一行分销摘要：近 30 天佣金、待审核提现（有就标黄）、推荐关系；点进「分销」页。 */
export function FenxiaoDashboardStrip() {
  const [ov, setOv] = React.useState<Overview | null>(null)
  const [enabled, setEnabled] = React.useState(false)
  React.useEffect(() => {
    get<Overview>('/v1/admin/fenxiao/overview?days=30').then(setOv).catch(() => setOv(null))
    get<{ enabled: boolean }>('/v1/admin/fenxiao/policy').then((p) => setEnabled(p.enabled)).catch(() => setEnabled(false))
  }, [])
  if (!ov) return null
  return (
    <Link to="/fenxiao" className="block">
      <Card className="transition-colors hover:bg-muted/40">
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
          <span className="flex items-center gap-2 font-medium">
            <Network className="h-4 w-4 text-muted-foreground" />
            分销
            {enabled ? <Badge variant="success">分佣中</Badge> : <Badge variant="secondary">未开启</Badge>}
          </span>
          <span>近 30 天佣金 <b className="tabular-nums">{money(ov.periodCommissionCents)}</b>（{ov.periodCount} 笔）</span>
          <span>
            待审核提现{' '}
            {ov.pendingWithdrawals ? <Badge variant="warning">{ov.pendingWithdrawals} 笔 · {money(ov.withdrawingCents)}</Badge> : <b>0</b>}
          </span>
          <span>推荐关系 <b className="tabular-nums">{ov.boundMembers}</b> · 分销商 <b className="tabular-nums">{ov.agents}</b></span>
          <span className="ml-auto text-xs text-muted-foreground">去分销页 →</span>
        </CardContent>
      </Card>
    </Link>
  )
}
