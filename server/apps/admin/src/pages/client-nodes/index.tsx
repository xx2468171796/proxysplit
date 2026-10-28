// 同事节点：各设备当前的节点 / 订阅（内部功能，docs/节点上报.md）。统计条和表格每 3 秒刷新。
import * as React from 'react'
import { get } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { NodesTab } from './nodes'
import { ChangesList, SubsTab } from './subs'
import { RevealDialog, type RevealTarget, type Stats, useTicker } from './shared'

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string | undefined }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {hint && <div className="truncate text-xs text-muted-foreground" title={hint}>{hint}</div>}
      </CardContent>
    </Card>
  )
}

function StatStrip({ stats }: { stats: Stats | null }) {
  const top = (b: Stats['byType'] | undefined) => (b ?? []).slice(0, 3).map((x) => `${x.key || '?'} ${x.nodes}`).join(' · ')
  const shared = (stats?.byServer ?? []).filter((s) => s.devices > 1).slice(0, 3).map((s) => `${s.key} ${s.devices} 人`).join(' · ')
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Stat label="上报设备" value={stats?.devices ?? '—'} />
      <Stat label="在用节点" value={stats?.nodes ?? '—'} hint={top(stats?.byType)} />
      <Stat label="在用订阅" value={stats?.subs ?? '—'} />
      <Stat label="不通节点" value={stats ? `${stats.dead}` : '—'} hint={stats ? `占已测的 ${stats.deadRate}%` : undefined} />
      <Stat label="多人共用的服务器" value={(stats?.byServer ?? []).filter((s) => s.devices > 1).length} hint={shared || undefined} />
      <Stat label="24 小时内变化" value={stats?.changes24h ?? '—'} />
    </div>
  )
}

export default function ClientNodesPage() {
  const tick = useTicker()
  const [stats, setStats] = React.useState<Stats | null>(null)
  const [reveal, setReveal] = React.useState<RevealTarget | null>(null)
  const onReveal = React.useCallback((t: RevealTarget) => setReveal(t), [])
  React.useEffect(() => { get<Stats>('/v1/admin/client-nodes/stats').then(setStats, () => {}) }, [tick])
  const canReveal = !!stats?.canReveal
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">各台客户端当前的全部节点和订阅，有变化时自动上报。链接加密保存，只有超级管理员能查看，每次查看都记审计。</p>
      <StatStrip stats={stats} />
      <Tabs defaultValue="nodes">
        <TabsList>
          <TabsTrigger value="nodes">节点</TabsTrigger>
          <TabsTrigger value="subs">订阅</TabsTrigger>
          <TabsTrigger value="changes">最近变化</TabsTrigger>
        </TabsList>
        <TabsContent value="nodes"><NodesTab tick={tick} canReveal={canReveal} onReveal={onReveal} /></TabsContent>
        <TabsContent value="subs"><SubsTab tick={tick} canReveal={canReveal} onReveal={onReveal} /></TabsContent>
        <TabsContent value="changes"><ChangesList tick={tick} /></TabsContent>
      </Tabs>
      <RevealDialog target={reveal} onClose={() => setReveal(null)} />
    </div>
  )
}
