// 总览的趋势与分布图（懒加载，echarts 只在打开总览时下载）。单系列不放图例，同一张图只放同一单位，不用双 Y 轴。
import { DashboardSection, Panel, SplitLayout, useAdminTheme } from '@ankotti/admin-ui'
import { AdminChart, barOption, donutOption, timeSeriesOption } from '@ankotti/admin-ui/charts'
import { useJson } from '@/lib/use-json'
import { centsBig, toPoints, type StatsOverview } from './metrics'

type Analytics = {
  ordersDaily: { date: string; created: number; paid: number }[]
  orderStatus: { status: string; count: number; amountCents: number }[]
  membershipTier: { tier: string; count: number }[]
  newDevicesDaily: { date: string; count: number }[]
  platformDist: { platform: string; count: number }[]
  redeemStatus: { status: string; count: number }[]
  auditDaily: { date: string; count: number }[]
}
const ORDER: Record<string, string> = { pending: '待支付', paid: '已支付', failed: '失败', closed: '已关闭', refunded: '已退款' }
const TIER: Record<string, string> = { premium: '超级会员', standard: '普通会员', trial: '试用' }
const REDEEM: Record<string, string> = { active: '可用', disabled: '已停用', used: '已用完' }
const DAY = 86_400_000

type Props = { days: number; stats: StatsOverview | undefined; statsLoading: boolean; active: boolean }

export function OverviewCharts({ days, stats, statsLoading, active }: Props) {
  const { mode } = useAdminTheme()
  const an = useJson<Analytics>(`/v1/admin/analytics?days=${days}`, { active })
  const a = an.data
  const line = (id: string, name: string, rows: { date: string; value: number | null }[], unit: string) =>
    timeSeriesOption({ mode, unit, expectedIntervalMs: DAY, inProgress: true, series: [{ id, name, points: toPoints(rows) }] })
  const revenue = stats?.revenue.daily.map((r) => ({ date: r.date, value: Number(centsBig(r.value)) / 100 })) ?? []
  const signups = stats?.signups.daily ?? []
  const orders = timeSeriesOption({ mode, unit: ' 笔', expectedIntervalMs: DAY, inProgress: true, series: [
    { id: 'created', name: '下单', points: toPoints((a?.ordersDaily ?? []).map((o) => ({ date: o.date, value: o.created }))) },
    { id: 'paid', name: '成交', points: toPoints((a?.ordersDaily ?? []).map((o) => ({ date: o.date, value: o.paid }))) },
  ] })
  const tiers = [...(a?.membershipTier ?? []).map((t) => ({ name: TIER[t.tier] ?? t.tier, value: t.count })),
    ...(stats ? [{ name: '免费', value: stats.members.free }] : [])]
  const st = { loading: an.loading, ...(an.error ? { error: an.error, onRetry: an.reload } : {}) }
  return (
    <>
      <DashboardSection title="每天怎么样" description={`最近 ${days} 天，北京日；最后一天进行中（虚线）。`}>
        <SplitLayout rail={
          <Panel title="每天新注册" count="人">
            <AdminChart option={line('signups', '新注册', signups, ' 人')} label="每天新注册" height={220} loading={statsLoading} empty={!statsLoading && signups.length === 0}
              table={{ columns: ['日期', '新注册'], rows: signups.map((r) => [r.date, r.value]) }} />
          </Panel>}>
          <Panel title="每天实收" count="元">
            <AdminChart option={line('revenue', '实收', revenue, ' 元')} label="每天实收" height={220} loading={statsLoading} empty={!statsLoading && revenue.length === 0}
              table={{ columns: ['日期', '实收（元）'], rows: revenue.map((r) => [r.date, r.value]) }} />
          </Panel>
        </SplitLayout>
        <SplitLayout rail={
          <Panel title="订单状态" count="笔">
            <AdminChart option={donutOption({ items: (a?.orderStatus ?? []).map((o) => ({ name: ORDER[o.status] ?? o.status, value: o.count })), unit: ' 笔', centerLabel: '订单', maxSlices: 5 })}
              label="订单状态分布" height={220} {...st} empty={!!a && a.orderStatus.length === 0} />
          </Panel>}>
          <Panel title="下单和成交" count="笔">
            <AdminChart option={orders} label="每天下单和成交" height={220} {...st} empty={!!a && a.ordersDaily.length === 0}
              table={{ columns: ['日期', '下单', '成交'], rows: (a?.ordersDaily ?? []).map((o) => [o.date, o.created, o.paid]) }} />
          </Panel>
        </SplitLayout>
      </DashboardSection>
      <DashboardSection title="用户和客户端分布" description="会员等级与平台为当前快照；新增设备、审计量按天。">
        <SplitLayout rail={
          <Panel title="会员等级" count="人">
            <AdminChart option={donutOption({ items: tiers, unit: ' 人', centerLabel: '用户', maxSlices: 5 })} label="会员等级分布" height={220} {...st} empty={!!a && tiers.length === 0} />
          </Panel>}>
          <Panel title="每天新增设备" count="台">
            <AdminChart option={line('devices', '新增设备', (a?.newDevicesDaily ?? []).map((x) => ({ date: x.date, value: x.count })), ' 台')} label="每天新增设备" height={220} {...st}
              empty={!!a && a.newDevicesDaily.length === 0} />
          </Panel>
        </SplitLayout>
        <SplitLayout rail={
          <Panel title="兑换码状态" count="个">
            <AdminChart option={barOption({ categories: (a?.redeemStatus ?? []).map((r) => REDEEM[r.status] ?? r.status), values: (a?.redeemStatus ?? []).map((r) => r.count), unit: ' 个', labels: true })}
              label="兑换码状态" height={220} {...st} empty={!!a && a.redeemStatus.length === 0} />
          </Panel>}>
          <Panel title="平台分布" count="台 · 未解绑">
            <AdminChart option={barOption({ categories: (a?.platformDist ?? []).map((p) => p.platform), values: (a?.platformDist ?? []).map((p) => p.count), unit: ' 台', horizontal: true, labels: true })}
              label="设备平台分布" height={220} {...st} empty={!!a && a.platformDist.length === 0} />
          </Panel>
        </SplitLayout>
        <Panel title="每天审计量" count="条">
          <AdminChart option={line('audit', '审计', (a?.auditDaily ?? []).map((x) => ({ date: x.date, value: x.count })), ' 条')} label="每天审计量" height={200} {...st}
            empty={!!a && a.auditDaily.length === 0} />
        </Panel>
      </DashboardSection>
    </>
  )
}
