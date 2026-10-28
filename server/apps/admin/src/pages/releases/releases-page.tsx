// 版本（T02 资源列表页 + T14 记录详情）：按渠道 / 强制筛选，发布新版本，详情里复制地址 / 校验值 / 签名，删除走确认框。
import * as React from 'react'
import { Copy, Plus, Trash2 } from 'lucide-react'
import {
  Button, CellDate, CellLongText, CellText, Choice, ConfirmDialog, CopyableValue, DataTable, PageBody, PageHeader, QueryBar,
  ResourcePanel, RowActionBar, StatusBadge, Tag, useNotify, type Column, type RecordLayout,
} from '@ankotti/admin-ui'
import { del } from '@/lib/api'
import { useServerList } from '@/lib/list'
import type { PageProps } from '@/shell/workspace-context'
import { ReleaseDialog, type Release } from './release-dialog'

const CHANNEL: Record<string, string> = { stable: '正式版', beta: '测试版' }

const layout: Partial<RecordLayout<Release>> = {
  subtitle: (r) => `${CHANNEL[r.channel] ?? r.channel} · 最低版本 ${r.minimumVersion}`,
  status: (r) => (r.mandatory ? { label: '强制更新', tone: 'warning' } : { label: '可选更新', tone: 'neutral' }),
  sections: [
    { key: 'pkg', title: '安装包', columns: 1, fields: [
      { key: 'url', label: '下载地址', value: (r) => r.url, text: (r) => r.url, copy: true, mono: true, href: (r) => r.url },
      { key: 'sha256', label: 'SHA-256', value: (r) => r.sha256, text: (r) => r.sha256, copy: true, mono: true },
      { key: 'signature', label: '签名', value: (r) => <CellLongText text={r.signature} />, text: (r) => r.signature, copy: true, mono: true },
    ] },
    { key: 'notes', title: '说明', columns: 1, fields: [
      { key: 'title', label: '标题', value: (r) => r.title },
      { key: 'summary', label: '摘要', value: (r) => r.summary, full: true },
      { key: 'changelog', label: '更新日志', value: (r) => r.changelog, full: true },
    ] },
  ],
  aside: [{ key: 'meta', title: '概要', fields: [
    { key: 'version', label: '版本号', value: (r) => r.version },
    { key: 'publishedAt', label: '发布时间', value: (r) => <CellDate value={r.publishedAt} time /> },
  ] }],
}

export function ReleasesPage(_: PageProps) {
  const notify = useNotify()
  const list = useServerList<Release, { channel: string; mandatory: string }>('/v1/admin/releases', {
    filters: { channel: '', mandatory: '' }, sort: { key: 'publishedAt', direction: 'desc' },
  })
  const [creating, setCreating] = React.useState(false)
  const [target, setTarget] = React.useState<Release | null>(null)
  const copyUrl = async (r: Release) => {
    try { await navigator.clipboard.writeText(r.url); notify('已复制下载地址', 'success') } catch { notify('复制失败，请在详情里手动复制', 'error') }
  }

  const columns: Column<Release>[] = [
    { key: 'version', title: '版本', sortable: true, width: 140, mobile: 'primary', render: (r) => <CellText primary={r.version} secondary={`最低 ${r.minimumVersion}`} /> },
    { key: 'channel', title: '渠道', sortable: true, width: 90, render: (r) => <Tag>{CHANNEL[r.channel] ?? r.channel}</Tag> },
    { key: 'status', title: '更新方式', width: 100, render: (r) => <StatusBadge tone={r.mandatory ? 'warning' : 'neutral'}>{r.mandatory ? '强制' : '可选'}</StatusBadge> },
    { key: 'title', title: '标题 / 摘要', maxWidth: 320, truncate: (r) => `${r.title} ${r.summary}`, render: (r) => <CellText primary={r.title || '—'} secondary={r.summary || undefined} /> },
    { key: 'sha256', title: 'SHA-256', width: 160, render: (r) => <CopyableValue variant="inline" value={r.sha256} label="SHA-256" /> },
    { key: 'publishedAt', title: '发布时间', sortable: true, width: 150, render: (r) => <CellDate value={r.publishedAt} time /> },
    { key: 'actions', title: '操作', kind: 'actions', render: (r) => (
      <RowActionBar label={`${r.version}的更多操作`} actions={[
        { key: 'copy', label: '复制下载地址', icon: <Copy />, onSelect: () => void copyUrl(r) },
        { key: 'delete', label: '删除', icon: <Trash2 />, destructive: true, onSelect: () => setTarget(r) },
      ]} />
    ) },
  ]

  return (
    <>
      <PageHeader title="版本" description="客户端自动更新读取的版本记录。每次发布都是强制更新时，勾选「强制更新」。"
        actions={<Button size="sm" onClick={() => setCreating(true)}><Plus />发布新版本</Button>} />
      <PageBody fill>
        <ResourcePanel title="版本" {...list.panel} unit="个"
          filters={
            <QueryBar {...list.queryBar} placeholder="搜索版本号 / 标题">
              <Choice label="渠道" size="sm" clearable placeholder="全部渠道" value={list.query.filters.channel} onChange={(v) => list.setFilter('channel', v)}
                options={Object.entries(CHANNEL).map(([value, label]) => ({ value, label }))} />
              <Choice label="更新方式" size="sm" clearable placeholder="强制与可选" value={list.query.filters.mandatory} onChange={(v) => list.setFilter('mandatory', v)}
                options={[{ value: 'true', label: '强制' }, { value: 'false', label: '可选' }]} />
            </QueryBar>
          }>
          <DataTable caption="版本列表" columns={columns} rowKey={(r) => r.id} rowHeight="medium" {...list.table}
            expandRecord={{ layout, title: (r) => `版本 ${r.version}`, url: 'release' }} />
        </ResourcePanel>
      </PageBody>
      {creating && <ReleaseDialog onClose={() => setCreating(false)} onDone={list.refresh} />}
      <ConfirmDialog open={!!target} tone="danger" destructive confirmLabel="删除" title={`删除版本 ${target?.version ?? ''}？`}
        impact={['客户端不再收到这个版本的更新提示', '已下载安装的客户端不受影响']}
        onClose={() => setTarget(null)}
        onConfirm={async () => {
          if (!target) return
          await del(`/v1/admin/releases/${target.id}`)
          notify('版本已删除', 'success')
          list.refresh()
        }} />
    </>
  )
}
