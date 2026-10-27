import * as React from 'react'
import { get } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

type Bucket = Record<string, string | number | null>
interface Analytics {
  days: number
  daily: Bucket[]
  startByVersion: Bucket[]
  startByOs: Bucket[]
  startByCapture: Bucket[]
  startByProtocol: Bucket[]
  topErrors: Bucket[]
  security: Bucket[]
  topApps: Bucket[]
  latencyByProtocol: Bucket[]
}

/** 一张小表：key 列 + 若干数值列。 */
function MiniTable({ title, rows, cols }: { title: string; rows: Bucket[]; cols: [string, string][] }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="py-4 text-center text-xs text-muted-foreground">暂无数据</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">{cols.map(([, label]) => <th key={label} className="pb-1 text-left font-normal">{label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t">
                  {cols.map(([k]) => <td key={k} className="py-1 pr-2 tabular-nums">{String(r[k] ?? '—')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}

const START: [string, string][] = [['key', '分组'], ['starts', '启动次数'], ['ok', '成功'], ['okRate', '成功率 %']]

/** 统计分析：按天活跃、启动成功率（版本 / 系统 / 模式 / 协议）、错误码、安全软件、常加应用、测速失败率。 */
export function AnalyticsTab() {
  const [days, setDays] = React.useState('7')
  const [data, setData] = React.useState<Analytics | null>(null)
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    const id = setTimeout(() => {
      get<Analytics>(`/v1/admin/telemetry/analytics?days=${Number(days) || 7}&limit=15`).then((d) => { setData(d); setError('') }).catch((e: Error) => setError(e.message))
    }, 300)
    return () => clearTimeout(id)
  }, [days])
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">最近</span>
        <Input type="number" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} className="h-9 w-[80px]" />
        <span className="text-muted-foreground">天</span>
        {error && <span className="text-destructive">{error}</span>}
      </div>
      {data && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <MiniTable title="每日活跃与启动" rows={data.daily} cols={[['day', '日期'], ['activeDevices', '活跃设备'], ['starts', '启动'], ['startOk', '成功'], ['failures', '失败事件']]} />
          <MiniTable title="启动成功率 · 版本" rows={data.startByVersion} cols={START} />
          <MiniTable title="启动成功率 · 系统" rows={data.startByOs} cols={START} />
          <MiniTable title="启动成功率 · 接管模式" rows={data.startByCapture} cols={START} />
          <MiniTable title="启动成功率 · 节点协议" rows={data.startByProtocol} cols={START} />
          <MiniTable title="错误码排行" rows={data.topErrors} cols={[['key', '错误码'], ['count', '次数'], ['devices', '设备']]} />
          <MiniTable title="安全软件分布" rows={data.security} cols={[['key', '软件'], ['devices', '设备数']]} />
          <MiniTable title="最常添加的应用" rows={data.topApps} cols={[['key', '程序'], ['devices', '设备数']]} />
          <MiniTable title="测速失败率 · 协议" rows={data.latencyByProtocol} cols={[['key', '协议'], ['tests', '测试'], ['failed', '失败'], ['failRate', '失败率 %']]} />
        </div>
      )}
    </div>
  )
}
