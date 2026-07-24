import * as React from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Download, Eye, Fingerprint, Globe } from 'lucide-react'
import { get } from '@/lib/api'
import { dt } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'

interface DownloadStats {
  summary: {
    downloads: number
    downloadUniqueIps: number
    downloadUniqueVisitors: number
    views: number
    viewUniqueIps: number
    viewUniqueVisitors: number
  }
  daily: { date: string; downloads: number; views: number; downloadIps: number }[]
  versions: { version: string; total: number; uniqueIps: number }[]
  referers: { source: string; total: number }[]
  recent: { kind: string; file: string; version: string; referer: string; createdAt: string }[]
}

const PRIMARY = 'hsl(var(--primary))'
const AXIS = 'hsl(var(--muted-foreground))'
const GRID = 'hsl(var(--border))'
const PALETTE = [
  PRIMARY,
  'hsl(217 91% 60%)',
  'hsl(160 84% 39%)',
  'hsl(38 92% 50%)',
  'hsl(280 65% 60%)',
  'hsl(340 82% 60%)',
  'hsl(199 89% 48%)',
  'hsl(24 95% 53%)',
]
const pal = (i: number): string => PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length] ?? PRIMARY
const tickStyle = { fill: AXIS, fontSize: 11 } as const
const fmtDate = (d: string) => (d && d.length >= 10 ? d.slice(5) : d)

interface TipEntry { name?: string | number; value?: number | string; color?: string }
function ChartTooltip({
  active,
  payload,
  label,
  showLabel = true,
}: {
  active?: boolean
  payload?: TipEntry[]
  label?: string | number
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
            <span className="ml-auto font-medium text-foreground">{String(e.value ?? '')}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

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

const RANGES = [7, 30, 90] as const

export default function DownloadsPage() {
  const [days, setDays] = React.useState<number>(30)
  const [d, setD] = React.useState<DownloadStats | null>(null)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    let alive = true
    setD(null)
    setError('')
    get<DownloadStats>(`/v1/admin/downloads?days=${days}`)
      .then((r) => alive && setD(r))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [days])

  const loading = d === null && !error
  const s = d?.summary
  const daily = d?.daily ?? []
  const versions = (d?.versions ?? []).map((v) => ({ name: `v${v.version}`, total: v.total, uniqueIps: v.uniqueIps }))
  const referers = (d?.referers ?? []).map((r) => ({ name: r.source, value: r.total }))
  const recent = d?.recent ?? []

  const kpis = [
    { label: '下载总次数', value: s ? String(s.downloads) : '—', icon: Download, hint: '含同一 IP 重复下载' },
    { label: '独立 IP 下载', value: s ? String(s.downloadUniqueIps) : '—', icon: Fingerprint, hint: '按 IP 去重' },
    { label: '独立访客下载', value: s ? String(s.downloadUniqueVisitors) : '—', icon: Fingerprint, hint: '按浏览器指纹去重' },
    { label: '页面浏览量', value: s ? String(s.views) : '—', icon: Eye, hint: 'PV，含刷新' },
    { label: '独立 IP 浏览', value: s ? String(s.viewUniqueIps) : '—', icon: Globe, hint: '按 IP 去重' },
    { label: '独立访客浏览', value: s ? String(s.viewUniqueVisitors) : '—', icon: Globe, hint: 'UV，按指纹去重' },
  ]

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{k.label}</CardTitle>
              <k.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {d ? (
                <>
                  <div className="text-2xl font-bold">{k.value}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{k.hint}</div>
                </>
              ) : (
                <Skeleton className="h-8 w-20" />
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">下载与浏览趋势</h2>
          <p className="text-sm text-muted-foreground">最近 {days} 天 · 上海时区按日聚合 · IP 仅存哈希值</p>
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

      {error && <div className="text-sm text-destructive">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="每日下载 / 浏览"
          desc="下载次数、独立 IP 下载数与页面浏览量"
          loading={loading}
          empty={daily.length === 0}
          className="lg:col-span-2"
        >
          <ComposedChart data={daily} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={tickStyle} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
            <YAxis tick={tickStyle} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="downloads" name="下载次数" fill={pal(0)} radius={[4, 4, 0, 0]} maxBarSize={24} />
            <Line type="monotone" dataKey="downloadIps" name="独立IP下载" stroke={pal(3)} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="views" name="浏览量" stroke={pal(1)} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ChartCard>

        <ChartCard title="各版本下载量" desc="下载按版本号统计（总次数 / 独立 IP）" loading={loading} empty={versions.length === 0}>
          <BarChart data={versions} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="name" tick={tickStyle} tickLine={false} axisLine={{ stroke: GRID }} />
            <YAxis tick={tickStyle} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
            <Tooltip content={<ChartTooltip showLabel={false} />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="total" name="下载次数" fill={pal(0)} radius={[4, 4, 0, 0]} maxBarSize={36} />
            <Bar dataKey="uniqueIps" name="独立IP" fill={pal(2)} radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ChartCard>

        <ChartCard title="来源分布" desc="下载 / 浏览按来源域名（Referer）" loading={loading} empty={referers.length === 0}>
          <PieChart>
            <Pie data={referers} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2} stroke="hsl(var(--card))" strokeWidth={2}>
              {referers.map((_, i) => (
                <Cell key={i} fill={pal(i % PALETTE.length)} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip showLabel={false} />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ChartCard>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">最近事件</CardTitle>
          <CardDescription>最新 50 条下载 / 浏览记录（不含 IP 明文）</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : recent.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">该区间暂无记录</div>
          ) : (
            <div className="max-h-80 overflow-y-auto text-sm">
              <table className="w-full">
                <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 text-left font-medium">类型</th>
                    <th className="py-2 text-left font-medium">文件 / 版本</th>
                    <th className="py-2 text-left font-medium">来源</th>
                    <th className="py-2 text-right font-medium">时间</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1.5">
                        <span className={r.kind === 'download' ? 'text-primary' : 'text-muted-foreground'}>
                          {r.kind === 'download' ? '下载' : '浏览'}
                        </span>
                      </td>
                      <td className="py-1.5 font-mono text-xs">{r.file || (r.version ? `v${r.version}` : '—')}</td>
                      <td className="max-w-[240px] truncate py-1.5 text-xs text-muted-foreground" title={r.referer}>
                        {r.referer || '直接访问'}
                      </td>
                      <td className="py-1.5 text-right text-xs text-muted-foreground">{dt(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Fingerprint className="h-3.5 w-3.5" />
        独立 IP 按 IP 的盐值哈希去重（不保存原始地址）；独立访客按浏览器持久化的匿名指纹去重。
      </div>
    </div>
  )
}
