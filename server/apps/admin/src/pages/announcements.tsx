import * as React from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { MoreHorizontal, Pencil, Pin, Plus, Trash2 } from 'lucide-react'
import { post, put, del, listApi } from '@/lib/api'
import { dt } from '@/lib/utils'
import { DataTable, type ColumnMeta } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'

// 后端 GET /v1/admin/announcements 返回的行结构（列名以 migration / store 映射为准）。
type AnnouncementType = 'notice' | 'maintenance' | 'release'
interface Announcement {
  id: string
  type: AnnouncementType
  title: string
  summary: string
  content: string
  version: string
  active: boolean
  pinned: boolean
  publishedAt: string
  startsAt: string | null
  endsAt: string | null
  createdAt: string
  updatedAt: string
}

// POST / PUT 请求体，对齐 announcementUpsertSchema（startsAt/endsAt 为 ISO 或 null）。
interface AnnouncementForm {
  type: AnnouncementType
  title: string
  summary: string
  content: string
  version: string
  active: boolean
  pinned: boolean
  startsAt: string | null
  endsAt: string | null
}

const typeMeta: Record<AnnouncementType, { label: string; tone: 'default' | 'secondary' | 'success' }> = {
  notice: { label: '通知', tone: 'secondary' },
  maintenance: { label: '维护', tone: 'default' },
  release: { label: '发布', tone: 'success' },
}
const typeLabel = (t: string) => typeMeta[t as AnnouncementType]?.label ?? t

// 类型对客户端意味着什么——发布/编辑弹窗内随「类型」实时切换的一句话说明。
const typeHint: Record<AnnouncementType, string> = {
  notice: '普通通知：在客户端公告列表内展示，用户可随时查看，不打断使用。',
  maintenance: '维护通知：提示服务维护或可能中断，客户端通常以醒目样式提醒，建议同时填写下方生效时间窗口。',
  release: '版本发布：配合下方「版本」字段告知新版本内容，客户端可据此引导用户更新。',
}

const meta = (m: ColumnMeta): ColumnMeta => m

// ISO 字符串 -> datetime-local 输入值（本地时区，精确到分）。
function isoToLocalInput(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
// datetime-local 输入值 -> ISO 字符串；空值返回 null。
function localInputToIso(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export default function AnnouncementsPage() {
  const [refresh, setRefresh] = React.useState(0)
  const bump = () => setRefresh((r) => r + 1)

  // 编辑器：formRow 为 null 表示「新建」，为具体行表示「编辑」。
  const [formOpen, setFormOpen] = React.useState(false)
  const [formRow, setFormRow] = React.useState<Announcement | null>(null)
  const [delRow, setDelRow] = React.useState<Announcement | null>(null)

  const openCreate = () => {
    setFormRow(null)
    setFormOpen(true)
  }
  const openEdit = (row: Announcement) => {
    setFormRow(row)
    setFormOpen(true)
  }

  const columns = React.useMemo<ColumnDef<Announcement, unknown>[]>(
    () => [
      {
        id: 'type',
        header: '类型',
        meta: meta({ sortKey: 'type' }),
        cell: ({ row }) => {
          const t = row.original.type
          return <Badge variant={typeMeta[t]?.tone ?? 'secondary'}>{typeLabel(t)}</Badge>
        },
      },
      {
        id: 'title',
        header: '标题',
        meta: meta({ sortKey: 'title' }),
        cell: ({ row }) => (
          <div className="min-w-0 max-w-[420px]">
            <div className="flex items-center gap-1.5 font-medium">
              {row.original.pinned && (
                <span title="已置顶" className="inline-flex shrink-0 text-primary">
                  <Pin className="h-3.5 w-3.5" />
                </span>
              )}
              <span className="truncate" title={row.original.title}>
                {row.original.title}
              </span>
            </div>
            {row.original.summary && (
              <div className="truncate text-xs text-muted-foreground" title={row.original.summary}>
                {row.original.summary}
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'version',
        header: '版本',
        cell: ({ row }) =>
          row.original.version ? (
            <span className="font-mono text-xs">{row.original.version}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'active',
        header: '状态',
        // 显式「中文 label + variant」映射：启用=success(绿)，停用=secondary(灰)，与全站状态色规范一致。
        cell: ({ row }) =>
          row.original.active ? (
            <Badge variant="success">启用</Badge>
          ) : (
            <Badge variant="secondary">停用</Badge>
          ),
      },
      {
        id: 'window',
        header: '生效时间',
        cell: ({ row }) => {
          const { startsAt, endsAt } = row.original
          if (!startsAt && !endsAt) return <span className="text-sm text-muted-foreground">长期有效</span>
          return (
            <span className="text-xs text-muted-foreground">
              {dt(startsAt)} ~ {dt(endsAt)}
            </span>
          )
        },
      },
      {
        id: 'publishedAt',
        header: '发布时间',
        meta: meta({ sortKey: 'publishedAt' }),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{dt(row.original.publishedAt)}</span>
        ),
      },
      {
        id: 'actions',
        header: '',
        meta: meta({ className: 'text-right' }),
        cell: ({ row }) => {
          const r = row.original
          return (
            <div className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">操作</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuLabel className="truncate">{r.title}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => openEdit(r)}>
                    <Pencil className="h-4 w-4" />
                    编辑
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setDelRow(r)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                    删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        },
      },
    ],
    // 行操作均为组件内稳定引用
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return (
    <>
      <DataTable<Announcement>
        columns={columns}
        fetcher={(query) =>
          listApi<Announcement>('/v1/admin/announcements', {
            q: query.q,
            limit: query.limit,
            offset: query.offset,
            ...(query.sort ? { sort: query.sort } : {}),
            ...(query.order ? { order: query.order } : {}),
            ...query.filters,
          })
        }
        searchPlaceholder="搜索标题 / 摘要 / 正文…"
        refreshSignal={refresh}
        emptyText="还没有公告，点右上角『发布公告』"
        filters={[
          {
            key: 'type',
            label: '类型',
            options: [
              { label: '通知', value: 'notice' },
              { label: '维护', value: 'maintenance' },
              { label: '发布', value: 'release' },
            ],
          },
          {
            key: 'active',
            label: '状态',
            options: [
              { label: '启用', value: 'true' },
              { label: '停用', value: 'false' },
            ],
          },
          {
            key: 'pinned',
            label: '置顶',
            options: [
              { label: '已置顶', value: 'true' },
              { label: '未置顶', value: 'false' },
            ],
          },
        ]}
        toolbar={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            发布公告
          </Button>
        }
      />

      <AnnouncementDialog
        open={formOpen}
        row={formRow}
        onOpenChange={setFormOpen}
        onDone={bump}
      />
      <DeleteDialog row={delRow} onOpenChange={(o) => !o && setDelRow(null)} onDone={bump} />
    </>
  )
}

// ---------- 新建 / 编辑（共用表单）----------
function AnnouncementDialog({
  open,
  row,
  onOpenChange,
  onDone,
}: {
  open: boolean
  row: Announcement | null
  onOpenChange: (o: boolean) => void
  onDone: () => void
}) {
  const editing = !!row
  const [form, setForm] = React.useState<AnnouncementForm>({
    type: 'notice',
    title: '',
    summary: '',
    content: '',
    version: '',
    active: true,
    pinned: false,
    startsAt: null,
    endsAt: null,
  })
  const [busy, setBusy] = React.useState(false)

  const set = <K extends keyof AnnouncementForm>(k: K, v: AnnouncementForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  React.useEffect(() => {
    if (!open) return
    if (row) {
      setForm({
        type: row.type,
        title: row.title,
        summary: row.summary ?? '',
        content: row.content ?? '',
        version: row.version ?? '',
        active: row.active,
        pinned: row.pinned,
        startsAt: row.startsAt ?? null,
        endsAt: row.endsAt ?? null,
      })
    } else {
      setForm({
        type: 'notice',
        title: '',
        summary: '',
        content: '',
        version: '',
        active: true,
        pinned: false,
        startsAt: null,
        endsAt: null,
      })
    }
  }, [open, row])

  // 本地可判定的无效态：标题过短、正文为空、生效结束早于开始。用于 disabled 主按钮 + 轻校验提示（不改接口）。
  const titleInvalid = form.title.trim().length < 2
  const contentInvalid = form.content.trim().length < 1
  const startMs = form.startsAt ? new Date(form.startsAt).getTime() : NaN
  const endMs = form.endsAt ? new Date(form.endsAt).getTime() : NaN
  const windowInvalid = !Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs <= startMs

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (titleInvalid) {
      toast.error('标题至少需要 2 个字符')
      return
    }
    if (contentInvalid) {
      toast.error('正文不能为空')
      return
    }
    if (windowInvalid) {
      toast.error('生效结束需晚于生效开始')
      return
    }
    const body = {
      type: form.type,
      title: form.title.trim(),
      summary: form.summary.trim(),
      content: form.content,
      version: form.version.trim(),
      active: form.active,
      pinned: form.pinned,
      startsAt: form.startsAt,
      endsAt: form.endsAt,
    }
    setBusy(true)
    try {
      if (row) {
        await put(`/v1/admin/announcements/${row.id}`, body)
        toast.success('公告已更新')
      } else {
        await post('/v1/admin/announcements', body)
        toast.success('公告已发布')
      }
      onOpenChange(false)
      onDone()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? '编辑公告' : '发布公告'}</DialogTitle>
          <DialogDescription>
            公告将展示给客户端；停用或超出生效时间窗口的公告不会对外可见。
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>类型</Label>
              <Select value={form.type} onValueChange={(v) => set('type', v as AnnouncementType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="notice">通知</SelectItem>
                  <SelectItem value="maintenance">维护</SelectItem>
                  <SelectItem value="release">发布</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>版本（可选）</Label>
              <Input
                value={form.version}
                onChange={(e) => set('version', e.target.value)}
                placeholder="如 1.9.0，仅发布类常用"
              />
              <p className="text-xs text-muted-foreground">
                发布类公告建议填写版本号，客户端可据此提示更新；其他类型可留空。
              </p>
            </div>
          </div>

          {/* 类型的一句话实时说明：随「类型」切换，告诉运营各类型对客户端的意义（参考 redeem 的说明块）。 */}
          <p className="rounded bg-muted px-3 py-2 text-xs text-muted-foreground">
            {typeHint[form.type]}
          </p>

          <div className="space-y-1.5">
            <Label>
              标题 <span className="text-destructive">*</span>
            </Label>
            <Input
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="2–160 字符"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>摘要（可选）</Label>
            <Input
              value={form.summary}
              onChange={(e) => set('summary', e.target.value)}
              placeholder="列表与推送中展示的一句话摘要，最多 500 字符"
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">
              留空时列表将只展示标题；建议一句话概括正文。
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>
              正文 <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={form.content}
              onChange={(e) => set('content', e.target.value)}
              placeholder="支持多行文本，最多 20000 字符"
              className="min-h-[160px]"
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>生效开始（可选）</Label>
              <Input
                type="datetime-local"
                value={isoToLocalInput(form.startsAt)}
                onChange={(e) => set('startsAt', localInputToIso(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">留空表示立即生效。</p>
            </div>
            <div className="space-y-1.5">
              <Label>生效结束（可选）</Label>
              <Input
                type="datetime-local"
                value={isoToLocalInput(form.endsAt)}
                onChange={(e) => set('endsAt', localInputToIso(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">留空表示长期有效。</p>
            </div>
          </div>
          {windowInvalid && (
            <p className="text-xs text-destructive">生效结束需晚于生效开始，请调整时间。</p>
          )}

          <div className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-6">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.active}
                  onCheckedChange={(v) => set('active', v === true)}
                />
                启用（对外可见）
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.pinned}
                  onCheckedChange={(v) => set('pinned', v === true)}
                />
                置顶
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              未勾选「启用」的公告将保存为草稿，不会向客户端展示；「置顶」的公告会排在列表最前。
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={busy || titleInvalid || contentInvalid || windowInvalid}>
              {busy ? '保存中…' : editing ? '保存修改' : '发布'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------- 删除（二次确认）----------
function DeleteDialog({
  row,
  onOpenChange,
  onDone,
}: {
  row: Announcement | null
  onOpenChange: (o: boolean) => void
  onDone: () => void
}) {
  const [busy, setBusy] = React.useState(false)
  async function confirmDelete() {
    if (!row) return
    setBusy(true)
    try {
      await del(`/v1/admin/announcements/${row.id}`)
      toast.success('公告已删除')
      onOpenChange(false)
      onDone()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除公告</DialogTitle>
          <DialogDescription>
            确认删除 <span className="font-medium text-foreground">{row?.title}</span>？此操作不可撤销。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={confirmDelete}>
            {busy ? '删除中…' : '确认删除'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
