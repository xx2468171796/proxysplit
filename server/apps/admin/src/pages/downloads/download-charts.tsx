// 下载统计的图（懒加载，echarts 只在打开本页时下载）。单位相同的放一张图，不用双 Y 轴。
import { Panel, SplitLayout, useAdminTheme } from '@ankotti/admin-ui'
import { AdminChart, barOption, donutOption, timeSeriesOption } from '@ankotti/admin-ui/charts'
import type { DownloadStats } from './types'

const ts = (date: string) => new Date(`${date}T00:00:00+08:00`).getTime()

export function DownloadCharts({ data }: { data: DownloadStats }) {
  const { mode } = useAdminTheme()
  const empty = data.daily.length === 0
  const daily = timeSeriesOption({
    mode, unit: ' 次', expectedIntervalMs: 86_400_000, inProgress: true,
    series: [
      { id: 'downloads', name: '下载', points: data.daily.map((d) => [ts(d.date), d.downloads] as const) },
      { id: 'ips', name: '下载独立 IP', points: data.daily.map((d) => [ts(d.date), d.downloadIps] as const) },
      { id: 'views', name: '浏览', points: data.daily.map((d) => [ts(d.date), d.views] as const) },
    ],
  })
  const versions = barOption({ categories: data.versions.map((v) => v.version), values: data.versions.map((v) => v.total), name: '下载', unit: ' 次', horizontal: true, labels: true })
  const referers = donutOption({ items: data.referers.map((r) => ({ name: r.source || '直接访问', value: r.total })), unit: ' 次', centerLabel: '来源', maxSlices: 5 })
  return (
    <SplitLayout railWidth={380} rail={
      <Panel title="下载从哪来" count="次">
        <AdminChart option={referers} label="下载来源分布" height={240} empty={data.referers.length === 0}
          table={{ columns: ['来源', '次数'], rows: data.referers.map((r) => [r.source || '直接访问', r.total]) }} />
      </Panel>
    }>
      <Panel title="每天下载和浏览" count="次 · 今天进行中">
        <AdminChart option={daily} label="每天下载和浏览" height={240} empty={empty}
          table={{ columns: ['日期', '下载', '下载独立 IP', '浏览'], rows: data.daily.map((d) => [d.date, d.downloads, d.downloadIps, d.views]) }} />
      </Panel>
      <Panel title="哪个版本下得多" count="次">
        <AdminChart option={versions} label="各版本下载量" height={Math.max(160, data.versions.length * 28)} empty={data.versions.length === 0}
          table={{ columns: ['版本', '下载', '独立 IP'], rows: data.versions.map((v) => [v.version, v.total, v.uniqueIps]) }} />
      </Panel>
    </SplitLayout>
  )
}
