// 运营总览（T04 统计看板，经营复盘）。分类卡见 docs/admin-rebuild.md：订阅会员 + 支付对账 + 推广返利 + 客户端运维。
// 对比基准：窗口 = 最近 N×24 小时（含今天进行中），和紧挨着的前 N×24 小时比；快照类指标（付费会员、绑定率）不带变化值。
import * as React from 'react'
import { RefreshCw } from 'lucide-react'
import { Button, ContentSkeleton, InlineAlert, PageBody, PageHeader, SegmentedControl, StatePanel, StatStrip } from '@ankotti/admin-ui'
import { money } from '@/lib/format'
import { useJson } from '@/lib/use-json'
import { useWorkspace, type PageProps } from '@/shell/workspace-context'
import type { Dashboard, StatsOverview } from './metrics'
import { KpiSections } from './kpi-sections'

const OverviewCharts = React.lazy(async () => ({ default: (await import('./overview-charts')).OverviewCharts }))
const DAYS = [{ value: '7', label: '7 天' }, { value: '30', label: '30 天' }, { value: '90', label: '90 天' }]

type FxOverview = { periodCommissionCents: number; periodCount: number; pendingWithdrawals: number; withdrawingCents: number; boundMembers: number; agents: number; heldCommissions: number }

export function OverviewPage({ active }: PageProps) {
  const ws = useWorkspace()
  const [days, setDays] = React.useState('30')
  const stats = useJson<StatsOverview>(`/v1/admin/stats/overview?days=${days}`, { intervalMs: 60_000, active })
  const now = useJson<Dashboard>('/v1/admin/dashboard', { intervalMs: 60_000, active })
  const fx = useJson<FxOverview>('/v1/admin/fenxiao/overview?days=30', { active })
  const refresh = () => { stats.refresh(); now.refresh(); fx.refresh() }
  const asOf = stats.data ? new Date(stats.data.asOf).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—'

  return (
    <>
      <PageHeader title="运营总览"
        description={`经营复盘看板：会员、收入、手机号与云端配置、推广和客户端。时间按北京时间，窗口含今天（进行中）。数据截至 ${asOf}，每分钟自动刷新。`}
        actions={<>
          <SegmentedControl size="sm" label="时间范围" value={days} onValueChange={setDays} options={DAYS} />
          <Button size="sm" variant="ghost" loading={stats.refreshing} onClick={refresh}><RefreshCw />刷新</Button>
        </>} />
      <PageBody>
        {stats.staleError && <InlineAlert tone="warning" title="刷新失败，下面是上一次的数据">{stats.staleError}</InlineAlert>}
        <StatStrip title="此刻" label="此刻的运营状态" items={[
          { key: 'online', label: '在线设备', value: now.data ? String(now.data.online) : null, unit: '台', note: '15 分钟内有心跳' },
          { key: 'pending', label: '待支付订单', value: now.data ? String(now.data.pendingOrders) : null, unit: '笔', note: '打开订单页处理', onSelect: () => ws.openPage('orders', { status: 'pending' }) },
          { key: 'expiring', label: '7 天内到期', value: now.data ? String(now.data.expiring) : null, unit: '人', ...(now.data?.expiring ? { tone: 'attention' as const } : {}), note: '会员即将到期', onSelect: () => ws.openPage('users', { membership: 'expiring' }) },
          { key: 'month', label: '本月实收', value: now.data ? money(now.data.monthRevenue) : null, note: '自然月，已支付订单' },
          { key: 'fx', label: '待审提现', value: fx.data ? String(fx.data.pendingWithdrawals) : null, unit: '笔',
            ...(fx.data?.pendingWithdrawals ? { tone: 'attention' as const } : {}), note: fx.data ? `提现中 ${money(fx.data.withdrawingCents)}` : '推广返利', onSelect: () => ws.openPage('fenxiao') },
          { key: 'held', label: '待审佣金', value: fx.data ? String(fx.data.heldCommissions) : null, unit: '笔', note: fx.data ? `近 30 天佣金 ${money(fx.data.periodCommissionCents)}` : '推广返利', onSelect: () => ws.openPage('fenxiao') },
        ]} />
        {stats.error && !stats.data
          ? <StatePanel kind="error" title="总览数据加载失败" message={stats.error} onRetry={stats.reload} />
          : <KpiSections data={stats.data} loading={stats.loading} openPage={ws.openPage} fx={fx.data} />}
        <React.Suspense fallback={<ContentSkeleton rows={6} label="正在加载图表" />}>
          <OverviewCharts days={Number(days)} stats={stats.data} statsLoading={stats.loading} active={active} />
        </React.Suspense>
      </PageBody>
    </>
  )
}
