// 下载统计（T04 统计看板页）：官网下载与浏览，7 / 30 / 90 天；图表懒加载，最近事件小表在下面。
import * as React from 'react'
import { Download, Eye } from 'lucide-react'
import {
  CellDate, ContentSkeleton, DataTable, PageBody, PageHeader, Panel, SegmentedControl, StatePanel, StatStrip, Tag,
  errorText, useLocalPagination, type Column,
} from '@ankotti/admin-ui'
import { get } from '@/lib/api'
import type { PageProps } from '@/shell/workspace-context'
import type { DownloadStats } from './types'

const DownloadCharts = React.lazy(async () => ({ default: (await import('./download-charts')).DownloadCharts }))
type Recent = DownloadStats['recent'][number]
const DAYS = [{ value: '7', label: '近 7 天' }, { value: '30', label: '近 30 天' }, { value: '90', label: '近 90 天' }]

function useStats(days: string) {
  const [data, setData] = React.useState<DownloadStats | null>(null)
  const [error, setError] = React.useState('')
  const [tick, setTick] = React.useState(0)
  React.useEffect(() => {
    const ctl = new AbortController()
    setError('')
    get<DownloadStats>(`/v1/admin/downloads?days=${days}`, ctl.signal).then(setData).catch((e: unknown) => {
      if (!ctl.signal.aborted) setError(errorText(e, '下载统计加载失败'))
    })
    return () => ctl.abort()
  }, [days, tick])
  return { data, error, retry: () => setTick((t) => t + 1) }
}

export function DownloadsPage(_: PageProps) {
  const [days, setDays] = React.useState('30')
  const { data, error, retry } = useStats(days)
  const recent = useLocalPagination(data?.recent ?? [], { pageSize: 10 })
  const s = data?.summary
  const columns: Column<Recent>[] = [
    { key: 'kind', title: '类型', width: 80, render: (r) => <Tag>{r.kind === 'download' ? '下载' : '浏览'}</Tag> },
    { key: 'file', title: '文件 / 页面', maxWidth: 280, mobile: 'primary', truncate: (r) => r.file, render: (r) => r.file || '—' },
    { key: 'version', title: '版本', width: 100, render: (r) => r.version || '—' },
    { key: 'referer', title: '来源', maxWidth: 260, truncate: (r) => r.referer, render: (r) => r.referer || '直接访问' },
    { key: 'createdAt', title: '时间', width: 150, render: (r) => <CellDate value={r.createdAt} time /> },
  ]
  const range = <SegmentedControl size="sm" label="时间范围" value={days} onValueChange={setDays} options={DAYS} />

  return (
    <>
      <PageHeader title="下载统计" description="官网安装包下载与页面浏览，按北京日统计；独立 IP / 访客按所选范围去重。" />
      <PageBody>
        {error && !data ? <StatePanel kind="error" title="下载统计加载失败" message={error} onRetry={retry} /> : (
          <>
            <StatStrip title="下载与浏览" count={DAYS.find((d) => d.value === days)?.label} actions={range} items={[
              { key: 'dl', label: '下载', icon: <Download />, value: s ? s.downloads : null, unit: '次' },
              { key: 'dlip', label: '下载独立 IP', value: s ? s.downloadUniqueIps : null, unit: '个' },
              { key: 'dlv', label: '下载独立访客', value: s ? s.downloadUniqueVisitors : null, unit: '人' },
              { key: 'pv', label: '浏览', icon: <Eye />, value: s ? s.views : null, unit: '次' },
              { key: 'pvip', label: '浏览独立 IP', value: s ? s.viewUniqueIps : null, unit: '个' },
              { key: 'pvv', label: '浏览独立访客', value: s ? s.viewUniqueVisitors : null, unit: '人' },
            ]} />
            {data ? <React.Suspense fallback={<ContentSkeleton rows={6} />}><DownloadCharts data={data} /></React.Suspense> : <ContentSkeleton rows={6} />}
            <Panel title="最近事件" count={data ? `${data.recent.length} 条` : undefined}>
              <DataTable caption="最近下载与浏览事件" columns={columns} rows={recent.pageRows} rowKey={(r) => `${r.kind}-${r.createdAt}-${r.file}`}
                loading={!data} pagination={recent.pagination} rowHeight="short" />
            </Panel>
          </>
        )}
      </PageBody>
    </>
  )
}
