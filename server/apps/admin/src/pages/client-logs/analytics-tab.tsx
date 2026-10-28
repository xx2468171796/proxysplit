// 客户端日志 · 统计分析（T04 统计页的明细表部分）：按天活跃、启动成功率（版本 / 系统 / 模式 / 协议）、错误码、
// 安全软件、常加应用、测速失败率。数据小（每组 ≤ 15 行），一次取全。
import * as React from 'react'
import { DataTable, NumberInput, PageHeader, Panel, StatePanel, errorText, type Column } from '@ankotti/admin-ui'
import { get } from '@/lib/api'
import { useDebounced } from './devices-tab'

type Cell = string | number | null
type Bucket = Record<string, Cell>
type Analytics = {
  days: number; daily: Bucket[]; startByVersion: Bucket[]; startByOs: Bucket[]; startByCapture: Bucket[]; startByProtocol: Bucket[]
  topErrors: Bucket[]; security: Bucket[]; topApps: Bucket[]; latencyByProtocol: Bucket[]
}
type Spec = { key: keyof Omit<Analytics, 'days'>; title: string; cols: [string, string][] }

const START: [string, string][] = [['key', '分组'], ['starts', '启动次数'], ['ok', '成功'], ['okRate', '成功率 %']]
const SPECS: Spec[] = [
  { key: 'daily', title: '每日活跃与启动', cols: [['day', '日期'], ['activeDevices', '活跃设备'], ['starts', '启动'], ['startOk', '成功'], ['failures', '失败事件']] },
  { key: 'startByVersion', title: '启动成功率 · 版本', cols: START },
  { key: 'startByOs', title: '启动成功率 · 系统', cols: START },
  { key: 'startByCapture', title: '启动成功率 · 接管模式', cols: START },
  { key: 'startByProtocol', title: '启动成功率 · 节点协议', cols: START },
  { key: 'topErrors', title: '错误码排行', cols: [['key', '错误码'], ['count', '次数'], ['devices', '设备']] },
  { key: 'security', title: '安全软件分布', cols: [['key', '软件'], ['devices', '设备数']] },
  { key: 'topApps', title: '最常添加的应用', cols: [['key', '程序'], ['devices', '设备数']] },
  { key: 'latencyByProtocol', title: '测速失败率 · 协议', cols: [['key', '协议'], ['tests', '测试'], ['failed', '失败'], ['failRate', '失败率 %']] },
]

function MiniTable({ spec, rows }: { spec: Spec; rows: Bucket[] }) {
  const columns: Column<Bucket>[] = spec.cols.map(([k, label], i) => ({
    key: k, title: label, ...(i > 0 ? { numeric: true } : { maxWidth: 220, truncate: (r: Bucket) => String(r[k] ?? '—') }),
    render: (r: Bucket) => (r[k] === null || r[k] === undefined ? '—' : String(r[k])),
  }))
  return (
    <Panel title={spec.title} count={`${rows.length} 行`}>
      <DataTable caption={spec.title} columns={columns} rows={rows} rowKey={(r) => String(r[spec.cols[0]?.[0] ?? 'key'])}
        rowHeight="short" mobile="table" resizable={false} pagination={{ mode: 'all' }} emptyLabel="暂无数据" />
    </Panel>
  )
}

export function AnalyticsTab() {
  const [days, setDays] = React.useState<number | null>(7)
  const wanted = useDebounced(String(Math.min(60, Math.max(1, days ?? 7))))
  const [data, setData] = React.useState<Analytics | null>(null)
  const [error, setError] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [nonce, setNonce] = React.useState(0)

  React.useEffect(() => {
    const ctl = new AbortController()
    setLoading(true)
    get<Analytics>(`/v1/admin/telemetry/analytics?days=${wanted}&limit=15`, ctl.signal)
      .then((d) => { setData(d); setError('') })
      .catch((e: unknown) => { if (!ctl.signal.aborted) setError(errorText(e, '统计加载失败')) })
      .finally(() => { if (!ctl.signal.aborted) setLoading(false) })
    return () => ctl.abort()
  }, [wanted, nonce])

  return (
    <>
      <PageHeader title="统计分析" description="最近 N 天（1–60）的客户端统计；成功率 = 成功启动 ÷ 启动次数。"
        actions={<NumberInput size="sm" aria-label="最近天数" value={days} onChange={setDays} min={1} max={60} unit="天" />} />
      {error && !data ? (
        <StatePanel kind="error" title="统计加载失败" message={error} onRetry={() => setNonce((n) => n + 1)} />
      ) : loading && !data ? (
        <StatePanel kind="loading" title="正在加载统计" />
      ) : (
        SPECS.map((s) => <MiniTable key={s.key} spec={s} rows={data?.[s.key] ?? []} />)
      )}
    </>
  )
}
