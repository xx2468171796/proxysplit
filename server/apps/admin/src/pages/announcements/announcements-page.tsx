// 公告（T02 资源列表页）：按类型 / 启用 / 置顶筛选，新建、编辑、删除（确认框）。
import * as React from 'react'
import { Pencil, Pin, Plus, Trash2 } from 'lucide-react'
import {
  Button, CellDate, CellText, Choice, ConfirmDialog, DataTable, PageBody, PageHeader, QueryBar, ResourcePanel, RowActionBar,
  StatusBadge, Tag, useNotify, type Column,
} from '@ankotti/admin-ui'
import { del } from '@/lib/api'
import { useServerList } from '@/lib/list'
import type { PageProps } from '@/shell/workspace-context'
import { AnnouncementDialog, TYPE_LABEL, type Announcement } from './announcement-dialog'

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '')
function windowText(a: Announcement) {
  if (!a.startsAt && !a.endsAt) return '长期有效'
  return `${fmt(a.startsAt) || '立即'} 至 ${fmt(a.endsAt) || '长期'}`
}

export function AnnouncementsPage(_: PageProps) {
  const notify = useNotify()
  const list = useServerList<Announcement, { type: string; active: string; pinned: string }>('/v1/admin/announcements', {
    filters: { type: '', active: '', pinned: '' },
  })
  const [edit, setEdit] = React.useState<Announcement | 'new' | null>(null)
  const [target, setTarget] = React.useState<Announcement | null>(null)

  const columns: Column<Announcement>[] = [
    { key: 'type', title: '类型', sortable: true, width: 80, render: (a) => <Tag>{TYPE_LABEL[a.type] ?? a.type}</Tag> },
    { key: 'title', title: '标题', sortable: true, maxWidth: 360, mobile: 'primary', truncate: (a) => a.title,
      render: (a) => <CellText primary={<>{a.pinned && <Pin aria-label="置顶" />}{a.title}</>} secondary={a.summary || undefined} /> },
    { key: 'version', title: '版本', width: 100, render: (a) => a.version || '—' },
    { key: 'status', title: '状态', width: 80, render: (a) => <StatusBadge tone={a.active ? 'success' : 'neutral'}>{a.active ? '启用' : '停用'}</StatusBadge> },
    { key: 'window', title: '生效时间', maxWidth: 260, truncate: windowText, render: windowText },
    { key: 'publishedAt', title: '发布时间', sortable: true, width: 150, render: (a) => <CellDate value={a.publishedAt} time /> },
    { key: 'actions', title: '操作', kind: 'actions', render: (a) => (
      <RowActionBar label={`${a.title}的更多操作`} actions={[
        { key: 'edit', label: '编辑', icon: <Pencil />, onSelect: () => setEdit(a) },
        { key: 'delete', label: '删除', icon: <Trash2 />, destructive: true, onSelect: () => setTarget(a) },
      ]} />
    ) },
  ]

  return (
    <>
      <PageHeader title="公告" description="客户端「公告」里显示的通知、维护提示和版本发布说明。"
        actions={<Button size="sm" onClick={() => setEdit('new')}><Plus />新建公告</Button>} />
      <PageBody fill>
        <ResourcePanel title="公告" {...list.panel} unit="条"
          filters={
            <QueryBar {...list.queryBar} placeholder="搜索标题 / 摘要">
              <Choice label="类型" size="sm" clearable placeholder="全部类型" value={list.query.filters.type} onChange={(v) => list.setFilter('type', v)}
                options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
              <Choice label="状态" size="sm" clearable placeholder="启用与停用" value={list.query.filters.active} onChange={(v) => list.setFilter('active', v)}
                options={[{ value: 'true', label: '启用' }, { value: 'false', label: '停用' }]} />
              <Choice label="置顶" size="sm" clearable placeholder="是否置顶" value={list.query.filters.pinned} onChange={(v) => list.setFilter('pinned', v)}
                options={[{ value: 'true', label: '已置顶' }, { value: 'false', label: '未置顶' }]} />
            </QueryBar>
          }>
          <DataTable caption="公告列表" columns={columns} rowKey={(a) => a.id} rowHeight="medium" {...list.table} />
        </ResourcePanel>
      </PageBody>
      {edit && <AnnouncementDialog row={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={list.refresh} />}
      <ConfirmDialog open={!!target} tone="danger" destructive confirmLabel="删除" title={`删除公告「${target?.title ?? ''}」？`}
        impact={['客户端立即不再显示这条公告', '删除后不能恢复；只想暂时下线可改为停用']}
        onClose={() => setTarget(null)}
        onConfirm={async () => {
          if (!target) return
          await del(`/v1/admin/announcements/${target.id}`)
          notify('公告已删除', 'success')
          list.refresh()
        }} />
    </>
  )
}
