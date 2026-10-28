// 同事节点（T03 指标 + 列表，放在 T05 分区里）：节点 / 订阅 / 最近变化。
// 统计走 useLiveResource 3 秒一刷（页面不可见或不是当前标签时停），每次拿到新统计，当前分区的列表静默刷新。
import * as React from 'react'
import { History, Rss, Share2 } from 'lucide-react'
import { LiveStatus, StatStrip, TabbedPage, useLiveResource, type StatItem } from '@ankotti/admin-ui'
import { get } from '@/lib/api'
import type { PageProps } from '@/shell/workspace-context'
import { NodesTab } from './nodes-tab'
import { ChangesList, SubsTab } from './subs-tab'
import { RevealDialog } from './reveal-dialog'
import { REFRESH_MS, type RevealTarget, type Stats } from './shared'

function useDocumentVisible() {
  const [visible, setVisible] = React.useState(() => document.visibilityState === 'visible')
  React.useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return visible
}

function statItems(s: Stats | undefined): StatItem[] {
  const top = (s?.byType ?? []).slice(0, 3).map((x) => `${x.key || '?'} ${x.nodes}`).join(' · ')
  const sharedServers = (s?.byServer ?? []).filter((b) => b.devices > 1)
  const sharedNote = sharedServers.slice(0, 3).map((b) => `${b.key} ${b.devices} 人`).join(' · ')
  return [
    { key: 'devices', label: '上报设备', value: s ? s.devices : null, unit: '台' },
    { key: 'nodes', label: '在用节点', value: s ? s.nodes : null, unit: '个', ...(top ? { note: top } : {}) },
    { key: 'subs', label: '在用订阅', value: s ? s.subs : null, unit: '个' },
    { key: 'dead', label: '不通节点', value: s ? s.dead : null, unit: '个', ...(s ? { note: `占已测的 ${s.deadRate}%` } : {}), ...(s && s.dead > 0 ? { tone: 'attention' as const } : {}) },
    { key: 'shared', label: '多人共用的服务器', value: s ? sharedServers.length : null, unit: '台', ...(sharedNote ? { note: sharedNote } : {}) },
    { key: 'changes', label: '24 小时内变化', value: s ? s.changes24h : null, unit: '次' },
  ]
}

export function ClientNodesPage({ active }: PageProps) {
  const visible = useDocumentVisible()
  const [tab, setTab] = React.useState('nodes')
  const [reveal, setReveal] = React.useState<RevealTarget | null>(null)
  const live = useLiveResource<Stats>('client-nodes:stats', (signal) => get<Stats>('/v1/admin/client-nodes/stats', signal), {
    intervalMs: REFRESH_MS, enabled: active && visible,
  })
  const tick = live.dataTime ?? 0
  const canReveal = !!live.data?.canReveal
  const onReveal = React.useCallback((t: RevealTarget) => setReveal(t), [])

  const strip = (
    <StatStrip title="同事节点概况" label="同事节点概况" items={statItems(live.data)}
      actions={<LiveStatus state={live.state} dataTime={live.dataTime} failures={live.failures} />} />
  )
  return (
    <>
      <TabbedPage title="同事节点" value={tab} onValueChange={setTab} active={active}
        description="各台客户端当前的全部节点和订阅，有变化时自动上报。链接加密保存，只有超级管理员能查看，每次查看都记审计。"
        sections={[
          { id: 'nodes', label: '节点', icon: <Share2 />, ...(live.data ? { count: live.data.nodes } : {}) },
          { id: 'subs', label: '订阅', icon: <Rss />, ...(live.data ? { count: live.data.subs } : {}) },
          { id: 'changes', label: '最近变化', icon: <History /> },
        ]}
        render={(id, sectionActive) => {
          const t = sectionActive ? tick : 0
          return (
            <>
              {strip}
              {id === 'nodes' ? <NodesTab tick={t} canReveal={canReveal} onReveal={onReveal} />
                : id === 'subs' ? <SubsTab tick={t} canReveal={canReveal} onReveal={onReveal} />
                  : <ChangesList tick={t} />}
            </>
          )
        }} />
      <RevealDialog target={reveal} onClose={() => setReveal(null)} />
    </>
  )
}
