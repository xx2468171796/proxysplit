// 总览的三组 KPI：订阅会员、收入与支付、手机号·云端·短信。口径见 docs/admin-rebuild.md 指标字典。
import { Cloud, CreditCard, MessageSquare, Smartphone, UserPlus, Users, Wallet } from 'lucide-react'
import { DashboardSection, KpiCard, KpiGrid } from '@ankotti/admin-ui'
import { comparisonLabel, conversionDelta, countDelta, MIN_COHORT, moneyDelta, pctText, ratio, yuanText, type StatsOverview } from './metrics'

type Props = { data: StatsOverview | undefined; loading: boolean; openPage: (id: string) => void; fx?: unknown }

export function KpiSections({ data: d, loading, openPage }: Props) {
  const cmp = d ? comparisonLabel(d.days) : ''
  const conv = d ? ratio(d.conversion.cur.converted, d.conversion.cur.cohort) : null
  const bound = d ? ratio(d.phone.bound, d.phone.total) : null
  const paidShare = d ? ratio(d.members.paid, d.members.users) : null
  return (
    <>
      <DashboardSection title="会员是在增长吗" description="订阅会员：付费会员 = 有生效中的普通 / 超级会员（不含试用）的用户；免费用户 = 其余普通用户。">
        <KpiGrid>
          <KpiCard size="lg" icon={Users} title="付费会员" loading={loading} value={d ? String(d.members.paid) : null} unit="人" tag="北极星"
            detail={d ? `占注册用户 ${pctText(paidShare) ?? '—'}%（${d.members.paid} / ${d.members.users}）` : undefined}
            footnote="当前快照，没有历史基线" onActivate={() => openPage('users')} activateLabel="查看用户" />
          <KpiCard icon={Users} title="免费用户" loading={loading} value={d ? String(d.members.free) : null} unit="人" footnote="当前快照" />
          <KpiCard icon={UserPlus} title="新注册" loading={loading} value={d ? String(d.signups.cur) : null} unit="人"
            delta={d ? countDelta(d.signups.cur, d.signups.prev) : null} comparison={cmp}
            trend={d?.signups.daily.map((x) => x.value) ?? []} trendInProgress />
          <KpiCard icon={UserPlus} title="免费→会员转化" loading={loading} value={pctText(conv)} unit="%"
            delta={d ? conversionDelta(d.conversion) : null} comparison={cmp}
            detail={d ? `${d.conversion.cur.converted} / ${d.conversion.cur.cohort} 位本期新注册已付费` : undefined}
            {...(d && d.conversion.cur.cohort < MIN_COHORT ? { insufficient: `新注册少于 ${MIN_COHORT} 人，样本不足不判断` } : {})}
            definition="本期注册的用户里，在本期内有已支付订单的比例；和上一期注册批次比，变化用百分点。" />
        </KpiGrid>
      </DashboardSection>
      <DashboardSection title="收入和支付正常吗" description="支付对账：实收 = 窗口内已支付订单金额（已退款的订单不计），以分为单位精确累加。">
        <KpiGrid>
          <KpiCard size="lg" icon={Wallet} title="实收" loading={loading} value={d ? yuanText(d.revenue.curCents) : null}
            delta={d ? moneyDelta(d.revenue.curCents, d.revenue.prevCents) : null} comparison={cmp}
            detail={d ? `上期 ${yuanText(d.revenue.prevCents)}` : undefined} onActivate={() => openPage('orders')} activateLabel="查看订单" />
          <KpiCard icon={CreditCard} title="已支付订单" loading={loading} value={d ? String(d.revenue.paidOrders.cur) : null} unit="笔"
            delta={d ? countDelta(d.revenue.paidOrders.cur, d.revenue.paidOrders.prev) : null} comparison={cmp} />
          <KpiCard icon={UserPlus} title="新增付费用户" loading={loading} value={d ? String(d.members.newPaid.cur) : null} unit="人"
            delta={d ? countDelta(d.members.newPaid.cur, d.members.newPaid.prev) : null} comparison={cmp}
            definition="第一笔已支付订单落在本期的用户数。" />
          <KpiCard icon={Smartphone} title="在线设备" loading={loading} value={d ? String(d.online.devices15m) : null} unit="台"
            footnote="客户端运维：15 分钟内有心跳" onActivate={() => openPage('devices')} activateLabel="查看设备" />
        </KpiGrid>
      </DashboardSection>
      <DashboardSection title="手机号和云端配置用起来了吗" description="手机号注册、云同步、云端命名配置与分享（2026-10-29 上线）。短信记录只保留约 2 天，所以固定看最近 24 小时。">
        <KpiGrid>
          <KpiCard icon={Smartphone} title="手机号绑定率" loading={loading} value={pctText(bound)} unit="%"
            detail={d ? `${d.phone.bound} / ${d.phone.total} 位用户已绑定` : undefined} footnote="当前快照" />
          <KpiCard icon={Cloud} title="云端命名配置" loading={loading} value={d ? String(d.cloud.profiles) : null} unit="份"
            detail={d ? `${d.cloud.profileUsers} 位用户 · 已分享 ${d.cloud.shared} · 设恢复密码 ${d.cloud.locked}` : undefined} />
          <KpiCard icon={Cloud} title="开着云同步" loading={loading} value={d ? String(d.cloud.syncUsers) : null} unit="人"
            detail={d ? `占付费会员 ${pctText(ratio(d.cloud.syncUsers, d.members.paid)) ?? '—'}%` : undefined} />
          <KpiCard icon={MessageSquare} title="短信发送（24 小时）" loading={loading} value={d ? String(d.sms.sent24h) : null} unit="条"
            delta={d ? countDelta(d.sms.sent24h, d.sms.prev24h) : null} comparison="比前 24 小时"
            detail={d ? `验证成功 ${d.sms.verified24h} 条${d.sms.byPurpose.length ? ' · ' + d.sms.byPurpose.map((p) => `${PURPOSE[p.purpose] ?? p.purpose} ${p.count}`).join(' · ') : ''}` : undefined}
            footnote="发送失败目前不落库，暂无失败数" />
        </KpiGrid>
      </DashboardSection>
    </>
  )
}

const PURPOSE: Record<string, string> = { register: '注册', reset: '找回', bind: '绑定' }
