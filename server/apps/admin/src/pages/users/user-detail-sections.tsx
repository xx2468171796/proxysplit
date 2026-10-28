// 用户详情的「资料」「会员与订单」「设备」三个分区。
import { BadgePercent, CalendarClock, Laptop, ReceiptText, Wallet } from 'lucide-react'
import {
  Button, CellDate, CellText, CopyableValue, DataTable, DateTimeDisplay, DescriptionList, MoneyDisplay, Panel, StatStrip,
  StatePanel, StatusBadge, type Column,
} from '@ankotti/admin-ui'
import { cycle, isOnline, licenseStatus, maskPhone, minor, money, orderStatus, platform, tier, userStatus } from '@/lib/format'
import { useWorkspace } from '@/shell/workspace-context'
import { currentLicense, type UserDetail, type UserDevice, type UserLicense, type UserOrder } from './types'

export function ProfileSection({ detail: d }: { detail: UserDetail }) {
  const lic = currentLicense(d.licenses)
  const st = userStatus(d.user.status)
  const phone = maskPhone(d.user.phone)
  return (
    <>
      <StatStrip title="概况" items={[
        { key: 'plan', label: '会员', icon: <BadgePercent />, value: lic ? lic.planName : '免费版', note: lic ? tier(lic.tier).label : '只能绑 1 台设备，不能云同步' },
        { key: 'exp', label: '到期', icon: <CalendarClock />, value: lic ? (lic.lifetime ? '永久' : <DateTimeDisplay value={lic.expiresAt} />) : null, note: lic ? undefined : '没有生效中的会员' },
        { key: 'dev', label: '在用设备', icon: <Laptop />, value: String(d.stats.activeDevices), unit: '台', note: lic ? `套餐 ${lic.maxDevices} 台 + 免费名额` : '免费名额' },
        { key: 'paid', label: '累计实付', icon: <Wallet />, value: <MoneyDisplay value={minor(d.stats.paidAmountCents)} />, note: `${d.stats.paidOrders} 笔已支付订单` },
      ]} />
      <Panel title="基本资料">
        <DescriptionList columns={2} items={[
          { label: '用户名', value: <CopyableValue value={d.user.username} label="用户名" /> },
          { label: '手机号', value: phone ?? <StatusBadge tone="warning">未绑定</StatusBadge>, hint: phone ? '中间 4 位已打码' : '老账号登录后会被提示补绑' },
          { label: '邮箱', value: d.user.email || '—' },
          { label: '状态', value: <StatusBadge tone={st.tone}>{st.label}</StatusBadge> },
          { label: '角色', value: d.user.role === 'admin' ? '管理员' : '用户' },
          { label: '注册时间', value: <DateTimeDisplay value={d.user.createdAt} /> },
          { label: '试用期', value: d.user.trialStartedAt ? <><DateTimeDisplay value={d.user.trialStartedAt} /> 至 <DateTimeDisplay value={d.user.trialEndsAt} /></> : '—' },
          { label: '资料更新', value: <DateTimeDisplay value={d.user.updatedAt} /> },
          { label: '用户 ID', value: <CopyableValue value={d.user.id} label="用户 ID" />, full: true },
          { label: '备注', value: d.user.note || '—', full: true },
        ]} />
      </Panel>
      <FenxiaoPanel detail={d} />
    </>
  )
}

function FenxiaoPanel({ detail: d }: { detail: UserDetail }) {
  const ws = useWorkspace()
  const fx = d.fenxiao
  const open = <Button size="sm" variant="ghost" onClick={() => ws.openPage('fenxiao', { q: d.user.username })}>{fx?.tierCode ? '分销设置' : '设为分销商'}</Button>
  if (!fx) return <Panel title="推荐与分销" actions={open}><StatePanel kind="empty" title="没有推荐关系" message="不是分销商，也不是被推荐注册的用户。" /></Panel>
  return (
    <Panel title="推荐与分销" actions={open}>
      <DescriptionList columns={3} items={[
        { label: '分销身份', value: fx.tierCode ? `${fx.tierCode}${fx.enabled ? '' : '（停用）'}` : '普通用户' },
        { label: '邀请码', value: fx.code ? <CopyableValue value={fx.code} label="邀请码" /> : '—' },
        { label: '上级', value: fx.inviter ?? '—', hint: fx.boundAt ? <>绑定于 <DateTimeDisplay value={fx.boundAt} /></> : undefined },
        { label: '直推 / 团队', value: `${fx.direct} / ${fx.team} 人`, hint: `团队已付 ${fx.paidOrders} 笔` },
        { label: '累计佣金', value: money(fx.earnedCents) },
        { label: '可提现', value: money(fx.availableCents), hint: fx.availableCents < 0 ? '为负：退款扣回超过余额' : undefined },
        { label: '冻结中', value: money(fx.frozenCents) },
        { label: '已提现', value: money(fx.withdrawnCents) },
      ]} />
    </Panel>
  )
}

const licenseColumns: Column<UserLicense>[] = [
  { key: 'plan', title: '套餐', maxWidth: 220, mobile: 'primary', render: (l) => <CellText primary={l.planName} secondary={`${tier(l.tier).label} · ${l.planCode}`} /> },
  { key: 'status', title: '状态', width: 90, render: (l) => { const s = licenseStatus(l.status); return <StatusBadge tone={s.tone}>{s.label}</StatusBadge> } },
  { key: 'devices', title: '套餐设备', width: 90, numeric: true, render: (l) => l.maxDevices },
  { key: 'starts', title: '开始', width: 150, render: (l) => <CellDate value={l.startsAt} time /> },
  { key: 'expires', title: '到期', width: 150, render: (l) => (l.lifetime ? '永久' : <CellDate value={l.expiresAt} time />) },
  { key: 'source', title: '来源', width: 100, render: (l) => l.source || '—' },
]
const orderColumns: Column<UserOrder>[] = [
  { key: 'orderNo', title: '订单号', width: 200, mobile: 'primary', render: (o) => <CopyableValue variant="inline" value={o.orderNo} label="订单号" /> },
  { key: 'plan', title: '套餐', maxWidth: 200, render: (o) => <CellText primary={o.planName} secondary={o.lifetime ? '永久' : cycle(o.billingCycle)} /> },
  { key: 'amount', title: '金额（元）', numeric: true, width: 110, render: (o) => <MoneyDisplay value={minor(o.amountCents)} /> },
  { key: 'status', title: '状态', width: 90, render: (o) => { const s = orderStatus(o.status); return <StatusBadge tone={s.tone}>{s.label}</StatusBadge> } },
  { key: 'time', title: '支付 / 下单', width: 150, render: (o) => <CellDate value={o.paidAt ?? o.createdAt} time /> },
]

export function MembershipSection({ detail: d }: { detail: UserDetail }) {
  const ws = useWorkspace()
  return (
    <>
      <Panel title="会员授权" count={d.licenses.length}>
        <DataTable caption="会员授权" columns={licenseColumns} rows={d.licenses} rowKey={(l) => l.id} pagination={{ mode: 'all' }}
          emptyLabel="没有会员记录，当前按免费版使用" />
      </Panel>
      <Panel title="订单" count={d.orders.length} actions={<Button size="sm" variant="ghost" onClick={() => ws.openPage('orders')}><ReceiptText />全部订单</Button>}>
        <DataTable caption="订单" columns={orderColumns} rows={d.orders} rowKey={(o) => o.orderNo} pagination={{ mode: 'all' }} emptyLabel="没有订单" />
      </Panel>
    </>
  )
}

const deviceColumns: Column<UserDevice>[] = [
  { key: 'name', title: '设备', maxWidth: 240, mobile: 'primary', render: (x) => <CellText primary={x.name} secondary={`${platform(x.platform)} · ${x.appVersion || '—'}`} /> },
  { key: 'status', title: '状态', width: 90, render: (x) => (x.revoked ? <StatusBadge>已解绑</StatusBadge>
    : isOnline(x.lastSeenAt) ? <StatusBadge tone="success">在线</StatusBadge> : <StatusBadge>离线</StatusBadge>) },
  { key: 'sessions', title: '有效会话', width: 90, numeric: true, render: (x) => x.activeSessions },
  { key: 'first', title: '首次上线', width: 150, render: (x) => <CellDate value={x.firstSeenAt} time /> },
  { key: 'last', title: '最近活跃', width: 150, render: (x) => <CellDate value={x.lastSeenAt} time /> },
]

export function DevicesSection({ detail: d }: { detail: UserDetail }) {
  return (
    <Panel title="设备" count={d.devices.length}>
      <DataTable caption="设备" columns={deviceColumns} rows={d.devices} rowKey={(x) => x.id} pagination={{ mode: 'all' }} emptyLabel="还没有登录过任何设备" />
    </Panel>
  )
}
