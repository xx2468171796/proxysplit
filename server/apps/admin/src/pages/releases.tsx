import * as React from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import {
  Copy,
  ExternalLink,
  Info,
  MoreHorizontal,
  Rocket,
  Trash2,
} from 'lucide-react'
import { post, del, listApi } from '@/lib/api'
import { dt } from '@/lib/utils'
import { DataTable, type ColumnMeta } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
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

/** 后端 /v1/admin/releases 列表行结构（列名以 migration / store.listReleases 为准）。 */
type Release = {
  id: string
  version: string
  minimumVersion: string
  url: string
  sha256: string
  signature: string
  mandatory: boolean
  title: string
  summary: string
  changelog: string
  channel: string
  publishedAt: string
}

type Channel = 'stable' | 'beta'

const meta = (m: ColumnMeta): ColumnMeta => m

const channelLabel = (c: string) => (c === 'beta' ? '测试版' : c === 'stable' ? '稳定版' : c)

// 与后端 releaseCreateSchema 一致的客户端预校验，出错时给出友好中文提示。
const SEMVER = /^\d+\.\d+\.\d+$/
const SHA256 = /^[a-f0-9]{64}$/

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`已复制${label}`)
  } catch {
    toast.error('复制失败，请手动选择')
  }
}

function ChannelBadge({ value }: { value: string }) {
  return <Badge variant={value === 'beta' ? 'warning' : 'success'}>{channelLabel(value)}</Badge>
}

function MandatoryBadge({ value }: { value: boolean }) {
  return value ? (
    <Badge variant="destructive">强制更新</Badge>
  ) : (
    <Badge variant="secondary">可选</Badge>
  )
}

export default function ReleasesPage() {
  const [refresh, setRefresh] = React.useState(0)
  const bump = () => setRefresh((r) => r + 1)

  const [createOpen, setCreateOpen] = React.useState(false)
  const [detailRow, setDetailRow] = React.useState<Release | null>(null)
  const [delRow, setDelRow] = React.useState<Release | null>(null)

  const columns = React.useMemo<ColumnDef<Release, unknown>[]>(
    () => [
      {
        id: 'version',
        header: '版本',
        meta: meta({ sortKey: 'version' }),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-medium">
              <span className="font-mono">{row.original.version}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              最低兼容 {row.original.minimumVersion || '—'}
            </div>
          </div>
        ),
      },
      {
        id: 'title',
        header: '标题 / 摘要',
        cell: ({ row }) => (
          <div className="min-w-0 max-w-[320px]">
            <div className="truncate">{row.original.title || '（未填写标题）'}</div>
            <div className="truncate text-xs text-muted-foreground">
              {row.original.summary || '—'}
            </div>
          </div>
        ),
      },
      {
        id: 'channel',
        header: '渠道',
        meta: meta({ sortKey: 'channel' }),
        cell: ({ row }) => <ChannelBadge value={row.original.channel} />,
      },
      {
        id: 'mandatory',
        header: '更新方式',
        cell: ({ row }) => <MandatoryBadge value={row.original.mandatory} />,
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
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuLabel className="font-mono">{r.version}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setDetailRow(r)}>
                    <Info className="h-4 w-4" />
                    详情
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => copy(r.url, '下载地址')}>
                    <Copy className="h-4 w-4" />
                    复制下载地址
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
    [],
  )

  return (
    <>
      <DataTable<Release>
        columns={columns}
        fetcher={(query) =>
          listApi<Release>('/v1/admin/releases', {
            q: query.q,
            limit: query.limit,
            offset: query.offset,
            ...(query.sort ? { sort: query.sort } : {}),
            ...(query.order ? { order: query.order } : {}),
            ...query.filters,
          })
        }
        searchPlaceholder="搜索版本号 / 标题 / 摘要…"
        refreshSignal={refresh}
        initialSort={{ sort: 'publishedAt', order: 'desc' }}
        filters={[
          {
            key: 'channel',
            label: '渠道',
            options: [
              { label: '稳定版', value: 'stable' },
              { label: '测试版', value: 'beta' },
            ],
          },
          {
            key: 'mandatory',
            label: '更新方式',
            options: [
              { label: '强制更新', value: 'true' },
              { label: '可选更新', value: 'false' },
            ],
          },
        ]}
        toolbar={
          <Button onClick={() => setCreateOpen(true)}>
            <Rocket className="h-4 w-4" />
            发布新版本
          </Button>
        }
      />

      <CreateReleaseDialog open={createOpen} onOpenChange={setCreateOpen} onDone={bump} />
      <ReleaseDetailDialog row={detailRow} onOpenChange={(o) => !o && setDetailRow(null)} />
      <DeleteReleaseDialog row={delRow} onOpenChange={(o) => !o && setDelRow(null)} onDone={bump} />
    </>
  )
}

// ---------- 发布新版本 ----------
function CreateReleaseDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onDone: () => void
}) {
  const [version, setVersion] = React.useState('')
  const [minimumVersion, setMinimumVersion] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [sha256, setSha256] = React.useState('')
  const [signature, setSignature] = React.useState('')
  const [channel, setChannel] = React.useState<Channel>('stable')
  const [mandatory, setMandatory] = React.useState(false)
  const [title, setTitle] = React.useState('')
  const [summary, setSummary] = React.useState('')
  const [changelog, setChangelog] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setVersion('')
      setMinimumVersion('')
      setUrl('')
      setSha256('')
      setSignature('')
      setChannel('stable')
      setMandatory(false)
      setTitle('')
      setSummary('')
      setChangelog('')
    }
  }, [open])

  function validate(): string | null {
    if (!SEMVER.test(version)) return '版本号格式应为 x.y.z（如 1.9.0）'
    if (!SEMVER.test(minimumVersion)) return '最低兼容版本格式应为 x.y.z（如 1.0.0）'
    try {
      new URL(url)
    } catch {
      return '下载地址必须是合法 URL'
    }
    if (!SHA256.test(sha256)) return 'SHA-256 必须是 64 位小写十六进制'
    if (signature.trim().length < 32) return '签名长度至少 32 位'
    return null
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const err = validate()
    if (err) {
      toast.error(err)
      return
    }
    setBusy(true)
    try {
      await post('/v1/admin/releases', {
        version: version.trim(),
        minimumVersion: minimumVersion.trim(),
        url: url.trim(),
        sha256: sha256.trim(),
        signature: signature.trim(),
        channel,
        mandatory,
        title: title.trim(),
        summary: summary.trim(),
        changelog: changelog.trim(),
      })
      toast.success(`已发布版本 ${version.trim()}`)
      onOpenChange(false)
      onDone()
    } catch (err2) {
      toast.error((err2 as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>发布新版本</DialogTitle>
          <DialogDescription>
            发布后客户端将通过 /v1/releases/latest 收到更新；强制更新会拦截低于最低兼容版本的客户端。
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>版本号</Label>
              <Input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="1.9.0"
                className="font-mono"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>最低兼容版本</Label>
              <Input
                value={minimumVersion}
                onChange={(e) => setMinimumVersion(e.target.value)}
                placeholder="1.0.0"
                className="font-mono"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>下载地址</Label>
            <Input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://dl.example.com/proxysplit-1.9.0.exe"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>SHA-256</Label>
            <Input
              value={sha256}
              onChange={(e) => setSha256(e.target.value)}
              placeholder="64 位小写十六进制"
              className="font-mono"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>签名</Label>
            <Textarea
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder="安装包签名（至少 32 位）"
              className="min-h-[64px] font-mono text-xs"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>渠道</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as Channel)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stable">稳定版</SelectItem>
                  <SelectItem value="beta">测试版</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <label className="flex h-9 items-center gap-2 text-sm">
                <Checkbox
                  checked={mandatory}
                  onCheckedChange={(v) => setMandatory(v === true)}
                />
                强制更新
              </label>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>标题（可选）</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：稳定性与安全性更新"
              maxLength={120}
            />
          </div>

          <div className="space-y-1.5">
            <Label>摘要（可选）</Label>
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="一句话说明本次更新（最多 500 字）"
              maxLength={500}
            />
          </div>

          <div className="space-y-1.5">
            <Label>更新日志（可选）</Label>
            <Textarea
              value={changelog}
              onChange={(e) => setChangelog(e.target.value)}
              placeholder="支持多行，展示给用户的完整更新说明"
              className="min-h-[120px]"
              maxLength={20000}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? '发布中…' : '确认发布'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------- 版本详情（只读，数据来自列表行）----------
function ReleaseDetailDialog({
  row,
  onOpenChange,
}: {
  row: Release | null
  onOpenChange: (o: boolean) => void
}) {
  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono">{row?.version}</span>
            {row && <ChannelBadge value={row.channel} />}
            {row && <MandatoryBadge value={row.mandatory} />}
          </DialogTitle>
          <DialogDescription>
            {row ? `发布于 ${dt(row.publishedAt)} · 最低兼容 ${row.minimumVersion}` : ''}
          </DialogDescription>
        </DialogHeader>

        {row && (
          <div className="space-y-4 text-sm">
            {(row.title || row.summary) && (
              <div className="space-y-1">
                {row.title && <div className="font-medium">{row.title}</div>}
                {row.summary && <div className="text-muted-foreground">{row.summary}</div>}
              </div>
            )}

            <Separator />

            <Field label="下载地址">
              <div className="flex items-center gap-2">
                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-w-0 items-center gap-1 truncate text-primary hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{row.url}</span>
                </a>
                <CopyBtn text={row.url} label="下载地址" />
              </div>
            </Field>

            <Field label="SHA-256">
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">
                  {row.sha256}
                </code>
                <CopyBtn text={row.sha256} label="SHA-256" />
              </div>
            </Field>

            <Field label="签名">
              <div className="flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 text-xs">
                  {row.signature}
                </code>
                <CopyBtn text={row.signature} label="签名" />
              </div>
            </Field>

            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">更新日志</div>
              {row.changelog ? (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border p-3 text-xs">
                  {row.changelog}
                </pre>
              ) : (
                <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                  暂无更新日志
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-8 w-8 shrink-0"
      onClick={() => copy(text, label)}
    >
      <Copy className="h-4 w-4" />
      <span className="sr-only">复制{label}</span>
    </Button>
  )
}

// ---------- 删除版本（二次确认）----------
function DeleteReleaseDialog({
  row,
  onOpenChange,
  onDone,
}: {
  row: Release | null
  onOpenChange: (o: boolean) => void
  onDone: () => void
}) {
  const [busy, setBusy] = React.useState(false)
  async function confirmDelete() {
    if (!row) return
    setBusy(true)
    try {
      await del(`/v1/admin/releases/${row.id}`)
      toast.success(`已删除版本 ${row.version}`)
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
          <DialogTitle>删除版本</DialogTitle>
          <DialogDescription>
            确认删除版本{' '}
            <span className="font-mono font-medium text-foreground">{row?.version}</span>？
            删除后客户端将不再收到该版本，此操作不可撤销。
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
