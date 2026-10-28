// 客户端日志（T05 分区合并页）：设备 / 最近失败 / 统计分析；设备详情是大弹框。
import * as React from 'react'
import { AlertTriangle, BarChart3, Laptop } from 'lucide-react'
import { TabbedPage } from '@ankotti/admin-ui'
import type { PageProps } from '@/shell/workspace-context'
import { DevicesTab } from './devices-tab'
import { FailuresTab } from './failures-tab'
import { AnalyticsTab } from './analytics-tab'
import { DeviceDetail } from './device-detail'

export function ClientLogsPage({ active }: PageProps) {
  const [tab, setTab] = React.useState('devices')
  const [open, setOpen] = React.useState<string | null>(null)
  return (
    <>
      <TabbedPage title="客户端日志" value={tab} onValueChange={setTab} active={active}
        description="客户端上报的启动结果、事件和运行日志，用来排查用户反馈的连不上、启动失败。"
        sections={[
          { id: 'devices', label: '设备', icon: <Laptop /> },
          { id: 'failures', label: '最近失败', icon: <AlertTriangle /> },
          { id: 'analytics', label: '统计分析', icon: <BarChart3 /> },
        ]}
        render={(id) => (id === 'devices' ? <DevicesTab onOpen={setOpen} /> : id === 'failures' ? <FailuresTab onOpen={setOpen} /> : <AnalyticsTab />)} />
      <DeviceDetail deviceId={open} onClose={() => setOpen(null)} />
    </>
  )
}
