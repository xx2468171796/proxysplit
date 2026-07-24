import * as React from 'react'
import {
  Activity,
  CreditCard,
  KeyRound,
  Monitor,
  ShoppingCart,
  TimerReset,
  Users,
  type LucideIcon,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { get } from '@/lib/api'
import { money } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'

// ---------- 类型 ----------
interface DashboardData {
  users?: number
  licenses?: number
  online?: number
  expiring?: number
  pendingOrders?: number
  monthRevenue?: number
}

interface Analytics {
  revenueDaily: { date: string; amountCents: number; orders: number }[]
  signupsDaily: { date: string; count: number }[]
  ordersDaily: { date: string; created: number; paid: number }[]
  orderStatus: { status: string; count: number; amountCents: number }[]
  membershipTier: { tier: string; count: number }[]
  newDevicesDaily: { date: string; count: number }[]
  platformDist: { platform: string; count: number }[]
  redeemStatus: { status: string; count: number }[]
  auditDaily: { date: string; count: number }[]
}

interface Kpi {
  label: string
  value: string
  icon: LucideIcon
}

// ---------- 主题色（CSS 变量 + 明暗均可读的固定色相调色板）----------
const PRIMARY = 'hsl(var(--primary))'
const AXIS = 'hsl(var(--muted-foreground))'
const GRID = 'hsl(var(--border))'
// 主色打头，其余为在明暗两种主题下都清晰的高饱和色相
const PALETTE = [
  PRIMARY,
  'hsl(217 91% 60%)', // blue
  'hsl(160 84% 39%)', // emerald
  'hsl(38 92% 50%)', // amber
  'hsl(280 65% 60%)', // violet
  'hsl(340 82% 60%)', // rose
  'hsl(199 89% 48%)', // sky
  'hsl(24 95% 53%)', // orange
]
/** 取色（始终返回 string，避免索引越界的 undefined）*/
const pal = (i: number): string => PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length] ?? PRIMARY

// ---------- 标签 / 格式化 ----------
const fmtDate = (d: string) => (d && d.length >= 10 ? d.slice(5) : d) // YYYY-MM-DD -> MM-DD

const tierLabel = (t: string) =>
  t === 'premium' ? '超级会员' : t === 'standard' ? '普通会员' : t === 'trial' ? '试用' : t
const orderStatusLabel = (s: string) =>
  (({
    paid: '已支付',
    pending: '待支付',
    cancelled: '已取消',
    canceled: '已取消',
    refunded: '已退款',
    expired: '已过期',
    failed: '失败',
  } as Record<string, string>)[s] ?? s)
const redeemStatusLabel = (s: string) =>
  (({ active: '未使用', used: '已使用', disabled: '已停用', expired: '已过期' } as Record<string, string>)[s] ?? s)
const platformLabel = (p: string) =>
  (({
    windows: 'Windows',
    macos: 'macOS',
    darwin: 'macOS',
    android: 'Android',
    ios: 'iOS',
    linux: 'Linux',
  } as Record<string, string>)[p] ?? (p || '未知'))

// ---------- 自定义 Tooltip（主题化，明暗均可读）----------
interface TipEntry {
  name?: string | number
  value?: number | string
  color?: string
  dataKey?: string | number
}
function ChartTooltip({
  active,
  payload,
  label,
  fmt,
  showLabel = true,
}: {
  active?: boolean
  payload?: TipEntry[]
  label?: string | number
  fmt?: (v: number) => string
  showLabel?: boolean
}) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="rounded-md border bg-card px-2.5 py-2 text-xs shadow-md">
      {showLabel && label != null && (
        <div className="mb-1 font-medium text-foreground">{fmtDate(String(label))}</div>
      )}
      <div className="space-y-1">
        {payload.map((e, i) => (
          <div key={i} className="flex items-center gap-2 text-muted-foreground">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: e.color }} />
            <span>{e.name}</span>
            <span className="ml-auto font-medium text-foreground">
              {fmt ? fmt(Number(e.value)) : String(e.value ?? '')}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

const tickStyle = { fill: AXIS, fontSize: 11 } as const

// ---------- 图表容器（标题 + 简述 + 骨架 + 空数据兜底）----------
function ChartCard({
  title,
  desc,
  loading,
  empty,
  className,
  children,
}: {
  title: string
  desc: string
  loading: boolean
  empty: boolean
  className?: string
  children: React.ReactElement
}) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{desc}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[260px] w-full">
          {loading ? (
            <Skeleton className="h-full w-full" />
          ) : empty ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              该区间暂无数据
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              {children}
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------- 页面 ----------
const RANGES = [7, 30, 90] as const

export default function DashboardPage() {
  const [data, setData] = React.useState<DashboardData | null>(null)
  const [error, setError] = React.useState('')

  const [days, setDays] = React.useState<number>(30)
  const [a, setA] = React.useState<Analytics | null>(null)
  const [aError, setAError] = React.useState('')

  React.useEffect(() => {
    get<DashboardData>('/v1/admin/dashboard')
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  React.useEffect(() => {
    let alive = true
    setA(null)
    setAError('')
    get<Analytics>(`/v1/admin/analytics?days=${days}`)
      .then((r) => {
        if (alive) setA(r)
      })
      .catch((e: unknown) => {
        if (alive) setAError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [days])

  const kpis: Kpi[] = [
    { label: '用户总数', value: data?.users != null ? String(data.users) : '—', icon: Users },
    { label: '有效授权', value: data?.licenses != null ? String(data.licenses) : '—', icon: KeyRound },
    { label: '在线设备', value: data?.online != null ? String(data.online) : '—', icon: Monitor },
    { label: '即将到期', value: data?.expiring != null ? String(data.expiring) : '—', icon: TimerReset },
    { label: '待支付订单', value: data?.pendingOrders != null ? String(data.pendingOrders) : '—', icon: ShoppingCart },
    { label: '本月实收', value: data ? money(data.monthRevenue) : '—', icon: CreditCard },
  ]

  const loading = a === null && !aError

  // 派生数据（金额分 -> 元）
  const revenueDaily = (a?.revenueDaily ?? []).map((r) => ({ date: r.date, amount: r.amountCents / 100, orders: r.orders }))
  const signupsDaily = a?.signupsDaily ?? []
  const ordersDaily = (a?.ordersDaily ?? []).map((r) => ({
    date: r.date,
    created: r.created,
    paid: r.paid,
    rate: r.created ? Math.round((r.paid / r.created) * 100) : 0,
  }))
  const orderStatus = (a?.orderStatus ?? []).map((r) => ({ name: orderStatusLabel(r.status), value: r.count }))
  const membershipTier = (a?.membershipTier ?? []).map((r) => ({ name: tierLabel(r.tier), value: r.count }))
  const newDevicesDaily = a?.newDevicesDaily ?? []
  const platformDist = (a?.platformDist ?? []).map((r) => ({ name: platformLabel(r.platform), value: r.count }))
  const redeemStatus = (a?.redeemStatus ?? []).map((r) => ({ name: redeemStatusLabel(r.status), value: r.count }))
  const auditDaily = a?.auditDaily ?? []

  return (
    <div className="space-y-6">
      {/* KPI 卡 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{k.label}</CardTitle>
              <k.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {data ? (
                <div className="text-2xl font-bold">{k.value}</div>
              ) : (
                <Skeleton className="h-8 w-20" />
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {error && <div className="text-sm text-destructive">{error}</div>}

      {/* 图表区标题 + 时间范围切换 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">运营趋势</h2>
          <p className="text-sm text-muted-foreground">最近 {days} 天 · 上海时区按日聚合</p>
        </div>
        <div className="inline-flex rounded-lg border p-0.5">
          {RANGES.map((r) => (
            <Button
              key={r}
              size="sm"
              variant={days === r ? 'default' : 'ghost'}
              className="h-7 px-3"
              onClick={() => setDays(r)}
            >
              {r} 天
            </Button>
          ))}
        </div>
      </div>

      {aError && <div className="text-sm text-destructive">{aError}</div>}

      {/* 图表网格（响应式自适应）*/}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* 每日营收（面积）*/}
        <ChartCard
          title="每日营收"
          desc="已成交订单按日实收金额（元）"
          loading={loading}
          empty={revenueDaily.length === 0}
          className="lg:col-span-2"
        >
          <AreaChart data={revenueDaily} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="gRevenue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={pal(1)} stopOpacity={0.35} />
                <stop offset="95%" stopColor={pal(1)} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={tickStyle} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
            <YAxis tick={tickStyle} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => `¥${v}`} />
            <Tooltip content={<ChartTooltip fmt={(v) => money(Math.round(v * 100))} />} />
            <Area type="monotone" dataKey="amount" name="营收" stroke={pal(1)} strokeWidth={2} fill="url(#gRevenue)" />
          </AreaChart>
        </ChartCard>

        {/* 每日新增用户（折线）*/}
        <ChartCard title="每日新增用户" desc="按注册时间统计的新用户数" loading={loading} empty={signupsDaily.length === 0}>
          <LineChart data={signupsDaily} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={tickStyle} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
            <YAxis tick={tickStyle} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} />
            <Line type="monotone" dataKey="count" name="新增用户" stroke={pal(2)} strokeWidth={2} dot={false} />
          </LineChart>
        </ChartCard>

        {/* 下单 vs 成交（双线 + 转化率）*/}
        <ChartCard title="下单 vs 成交" desc="每日创建 / 成交订单数与成交转化率" loading={loading} empty={ordersDaily.length === 0}>
          <ComposedChart data={ordersDaily} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={tickStyle} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
            <YAxis yAxisId="left" tick={tickStyle} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
            <YAxis yAxisId="right" orientation="right" tick={tickStyle} tickLine={false} axisLine={false} width={40} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip content={<ChartTooltip fmt={(v) => String(v)} />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line yAxisId="left" type="monotone" dataKey="created" name="下单" stroke={pal(3)} strokeWidth={2} dot={false} />
            <Line yAxisId="left" type="monotone" dataKey="paid" name="成交" stroke={pal(2)} strokeWidth={2} dot={false} />
            <Line yAxisId="right" type="monotone" dataKey="rate" name="转化率(%)" stroke={pal(4)} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
          </ComposedChart>
        </ChartCard>

        {/* 订单状态分布（环形饼）*/}
        <ChartCard title="订单状态分布" desc="区间内订单按状态计数" loading={loading} empty={orderStatus.length === 0}>
          <PieChart>
            <Pie data={orderStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2} stroke="hsl(var(--card))" strokeWidth={2}>
              {orderStatus.map((_, i) => (
                <Cell key={i} fill={pal(i % PALETTE.length)} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip showLabel={false} />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ChartCard>

        {/* 会员等级分布（饼）*/}
        <ChartCard title="会员等级分布" desc="当前有效授权按套餐等级" loading={loading} empty={membershipTier.length === 0}>
          <PieChart>
            <Pie data={membershipTier} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} paddingAngle={2} stroke="hsl(var(--card))" strokeWidth={2}>
              {membershipTier.map((_, i) => (
                <Cell key={i} fill={pal((i + 2) % PALETTE.length)} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip showLabel={false} />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ChartCard>

        {/* 每日新增设备（柱）*/}
        <ChartCard title="每日新增设备" desc="设备首次激活按日统计" loading={loading} empty={newDevicesDaily.length === 0}>
          <BarChart data={newDevicesDaily} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={tickStyle} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
            <YAxis tick={tickStyle} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} />
            <Bar dataKey="count" name="新增设备" fill={pal(6)} radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ChartCard>

        {/* 平台分布（环形饼）*/}
        <ChartCard title="平台分布" desc="在册设备按操作系统平台" loading={loading} empty={platformDist.length === 0}>
          <PieChart>
            <Pie data={platformDist} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2} stroke="hsl(var(--card))" strokeWidth={2}>
              {platformDist.map((_, i) => (
                <Cell key={i} fill={pal((i + 1) % PALETTE.length)} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip showLabel={false} />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ChartCard>

        {/* 兑换码状态（柱）*/}
        <ChartCard title="兑换码状态" desc="全部兑换码按当前状态" loading={loading} empty={redeemStatus.length === 0}>
          <BarChart data={redeemStatus} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="name" tick={tickStyle} tickLine={false} axisLine={{ stroke: GRID }} />
            <YAxis tick={tickStyle} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
            <Tooltip content={<ChartTooltip showLabel={false} />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} />
            <Bar dataKey="value" name="数量" radius={[4, 4, 0, 0]} maxBarSize={48}>
              {redeemStatus.map((_, i) => (
                <Cell key={i} fill={pal((i + 3) % PALETTE.length)} />
              ))}
            </Bar>
          </BarChart>
        </ChartCard>

        {/* 审计量趋势（折线）*/}
        <ChartCard
          title="审计量趋势"
          desc="后台审计日志按日写入量"
          loading={loading}
          empty={auditDaily.length === 0}
          className="lg:col-span-2"
        >
          <LineChart data={auditDaily} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={tickStyle} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
            <YAxis tick={tickStyle} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} />
            <Line type="monotone" dataKey="count" name="审计条数" stroke={pal(5)} strokeWidth={2} dot={false} />
          </LineChart>
        </ChartCard>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Activity className="h-3.5 w-3.5" />
        金额均为服务端实收（分/100 显示为 ¥）；日期按上海时区聚合并以 MM-DD 展示。
      </div>
    </div>
  )
}
