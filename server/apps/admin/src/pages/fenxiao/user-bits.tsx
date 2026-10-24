import * as React from 'react'
import { Link } from 'react-router-dom'
import { get } from '@/lib/api'
import { money, dateOnly } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Policy } from './shared'

// 「用户与会员」页里的分销小件：列表列、档案里的分销一栏。数据来自 listUsers / getUserDetail 的 fx 字段。

/** 等级代码 → 显示名（规则读一次，各处共用）。 */
let policyCache: Promise<Policy | null> | null = null
export function useTierNames(): Map<string, string> {
  const [names, setNames] = React.useState(new Map<string, string>())
  React.useEffect(() => {
    policyCache ??= get<Policy>('/v1/admin/fenxiao/policy').catch(() => null)
    void policyCache.then((p) => setNames(new Map((p?.tiers ?? []).map((t) => [t.code, t.name]))))
  }, [])
  return names
}

export const fenxiaoLink = (username: string) => `/fenxiao?q=${encodeURIComponent(username)}`

type ListRow = { username: string; fxTier?: string | null; fxEnabled?: boolean | null; inviter?: string | null; fxDirect?: number }

/** 列表「推荐 / 分销」列：身份徽章 + 上级 + 直推人数。 */
export function FenxiaoCell({ row, tierNames }: { row: ListRow; tierNames: Map<string, string> }) {
  const tier = row.fxTier ? tierNames.get(row.fxTier) ?? row.fxTier : null
  if (!tier && !row.inviter && !row.fxDirect) return <span className="text-muted-foreground">—</span>
  return (
    <div className="space-y-0.5 text-xs">
      {tier && <Badge variant={row.fxEnabled === false ? 'secondary' : 'success'}>{tier}{row.fxEnabled === false ? '（停用）' : ''}</Badge>}
      {row.inviter && <div className="text-muted-foreground">上级 {row.inviter}</div>}
      {row.fxDirect ? <div className="text-muted-foreground">直推 {row.fxDirect} 人</div> : null}
    </div>
  )
}

export type FenxiaoSummary = {
  tierCode: string | null
  enabled: boolean
  code: string | null
  inviter: string | null
  boundAt: string | null
  direct: number
  team: number
  paidOrders: number
  earnedCents: number
  availableCents: number
  frozenCents: number
  withdrawnCents: number
}

/** 用户档案里的「分销」一栏。 */
export function FenxiaoUserSection({ username, data }: { username: string; data: FenxiaoSummary | null | undefined }) {
  const tierNames = useTierNames()
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="font-medium">分销</div>
        <Button asChild size="sm" variant="outline"><Link to={fenxiaoLink(username)}>{data?.tierCode ? '分销设置' : '设为分销商'}</Link></Button>
      </div>
      {!data ? (
        <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">没有推荐关系，也不是分销商</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 rounded-md border p-3 sm:grid-cols-4">
          <Item label="身份" value={data.tierCode ? `${tierNames.get(data.tierCode) ?? data.tierCode}${data.enabled ? '' : '（停用）'}` : '普通用户'} />
          <Item label="上级" value={data.inviter ? `${data.inviter}（${dateOnly(data.boundAt)}）` : '—'} />
          <Item label="邀请码" value={data.code ?? '—'} mono />
          <Item label="直推 / 团队" value={`${data.direct} / ${data.team} 人`} />
          <Item label="累计佣金" value={money(data.earnedCents)} />
          <Item label="可提现" value={money(data.availableCents)} danger={data.availableCents < 0} />
          <Item label="冻结中" value={money(data.frozenCents)} />
          <Item label="已提现" value={money(data.withdrawnCents)} />
        </div>
      )}
    </div>
  )
}

function Item({ label, value, mono, danger }: { label: string; value: string; mono?: boolean; danger?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-0.5 truncate ${mono ? 'font-mono text-xs' : ''} ${danger ? 'text-destructive' : ''}`} title={value}>{value}</div>
    </div>
  )
}
