// 客户端日志：每台客户端自动上报的运行日志与事件（docs/memory/telemetry.md）。
import * as React from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DevicesTab } from './devices'
import { FailuresTab } from './failures'
import { AnalyticsTab } from './analytics'
import { DeviceDetail } from './device-detail'

export default function ClientLogsPage() {
  const [open, setOpen] = React.useState<string | null>(null)
  const openDevice = React.useCallback((id: string) => setOpen(id), [])
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        客户端每分钟上传一次运行日志与操作事件（失败立刻上传），已在客户端脱敏（不含节点密码、账号密钥）；保留 15 天。
      </p>
      <Tabs defaultValue="devices">
        <TabsList>
          <TabsTrigger value="devices">设备</TabsTrigger>
          <TabsTrigger value="failures">最近失败</TabsTrigger>
          <TabsTrigger value="analytics">统计分析</TabsTrigger>
        </TabsList>
        <TabsContent value="devices"><DevicesTab onOpen={openDevice} /></TabsContent>
        <TabsContent value="failures"><FailuresTab onOpen={openDevice} /></TabsContent>
        <TabsContent value="analytics"><AnalyticsTab /></TabsContent>
      </Tabs>
      <DeviceDetail deviceId={open} onClose={() => setOpen(null)} />
    </div>
  )
}
