// 新建 / 编辑公告表单：类型说明随所选类型切换；生效时间按北京时间填写。
import * as React from 'react'
import { DateTimePicker, FormDialog, FormField, FormSection, Input, SegmentedControl, Switch, Textarea, useNotify } from '@ankotti/admin-ui'
import { post, put } from '@/lib/api'
import { isoToLocal, localToIso } from '@/lib/dates'

export type AnnouncementType = 'notice' | 'maintenance' | 'release'
export type Announcement = {
  id: string; type: AnnouncementType; title: string; summary: string; content: string; version: string
  active: boolean; pinned: boolean; publishedAt: string; startsAt: string | null; endsAt: string | null
  createdAt: string; updatedAt: string
}

export const TYPE_LABEL: Record<AnnouncementType, string> = { notice: '通知', maintenance: '维护', release: '发布' }
const TYPE_HINT: Record<AnnouncementType, string> = {
  notice: '普通通知：在客户端公告列表内展示，用户可随时查看，不打断使用。',
  maintenance: '维护通知：提示服务维护或可能中断，客户端通常以醒目样式提醒，建议同时填写下方生效时间窗口。',
  release: '版本发布：配合下方「版本」字段告知新版本内容，客户端可据此引导用户更新。',
}

type Draft = { type: AnnouncementType; title: string; summary: string; content: string; version: string; active: boolean; pinned: boolean; startsAt: string; endsAt: string }
const toDraft = (a: Announcement | null): Draft => ({
  type: a?.type ?? 'notice', title: a?.title ?? '', summary: a?.summary ?? '', content: a?.content ?? '', version: a?.version ?? '',
  active: a?.active ?? true, pinned: a?.pinned ?? false, startsAt: isoToLocal(a?.startsAt), endsAt: isoToLocal(a?.endsAt),
})

function validate(d: Draft): string | null {
  if (d.title.trim().length < 2 || d.title.trim().length > 160) return '标题写 2–160 个字'
  if (!d.content.trim()) return '请填写正文'
  if (d.content.length > 20000) return '正文最多 20000 字'
  if (d.summary.length > 500) return '摘要最多 500 字'
  if (d.startsAt && d.endsAt && d.endsAt <= d.startsAt) return '结束时间要晚于开始时间'
  return null
}

export function AnnouncementDialog({ row, onClose, onDone }: { row: Announcement | null; onClose: () => void; onDone: () => void }) {
  const notify = useNotify()
  const initial = React.useMemo(() => toDraft(row), [row])
  const [d, setD] = React.useState(initial)
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }))
  return (
    <FormDialog open size="lg" title={row ? '编辑公告' : '新建公告'} description="客户端公告列表按置顶和发布时间排序；停用后客户端不再显示。"
      dirty={JSON.stringify(d) !== JSON.stringify(initial)} submitLabel={row ? '保存' : '发布'} onClose={onClose}
      onSubmit={async () => {
        const err = validate(d)
        if (err) throw new Error(err)
        const body = { type: d.type, title: d.title.trim(), summary: d.summary.trim(), content: d.content, version: d.version.trim(),
          active: d.active, pinned: d.pinned, startsAt: localToIso(d.startsAt), endsAt: localToIso(d.endsAt) }
        if (row) await put(`/v1/admin/announcements/${row.id}`, body)
        else await post('/v1/admin/announcements', body)
        notify(row ? '公告已保存' : '公告已发布', 'success')
        onDone()
        onClose()
      }}>
      <FormSection>
        <FormField label="类型" htmlFor="an-type" full hint={TYPE_HINT[d.type]}>
          <SegmentedControl label="类型" value={d.type} onValueChange={(type) => set({ type })}
            options={(Object.keys(TYPE_LABEL) as AnnouncementType[]).map((value) => ({ value, label: TYPE_LABEL[value] }))} />
        </FormField>
        <FormField label="标题" htmlFor="an-title" required full count={{ value: d.title.length, max: 160 }}>
          <Input id="an-title" value={d.title} maxLength={160} onChange={(e) => set({ title: e.target.value })} />
        </FormField>
        <FormField label="摘要" htmlFor="an-summary" optional full count={{ value: d.summary.length, max: 500 }}>
          <Input id="an-summary" value={d.summary} maxLength={500} onChange={(e) => set({ summary: e.target.value })} />
        </FormField>
        <FormField label="正文" htmlFor="an-content" required full count={{ value: d.content.length, max: 20000 }}>
          <Textarea id="an-content" value={d.content} rows={8} maxLength={20000} onChange={(e) => set({ content: e.target.value })} />
        </FormField>
        <FormField label="版本" htmlFor="an-version" optional hint="发布类公告填对应版本号">
          <Input id="an-version" value={d.version} placeholder="例如 1.10.12" onChange={(e) => set({ version: e.target.value })} />
        </FormField>
        <FormField label="启用" htmlFor="an-active">
          <Switch id="an-active" checked={d.active} onCheckedChange={(active) => set({ active })} />
        </FormField>
        <FormField label="置顶" htmlFor="an-pinned">
          <Switch id="an-pinned" checked={d.pinned} onCheckedChange={(pinned) => set({ pinned })} />
        </FormField>
        <FormField label="开始时间" htmlFor="an-start" optional hint="留空 = 立即生效（北京时间）">
          <DateTimePicker id="an-start" value={d.startsAt} onChange={(startsAt) => set({ startsAt })} />
        </FormField>
        <FormField label="结束时间" htmlFor="an-end" optional hint="留空 = 长期有效">
          <DateTimePicker id="an-end" value={d.endsAt} onChange={(endsAt) => set({ endsAt })} />
        </FormField>
      </FormSection>
    </FormDialog>
  )
}
