import * as React from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import {
  Check,
  Copy,
  Filter,
  MoreHorizontal,
  Pause,
  Play,
  Ticket,
  Trash2,
  X,
} from 'lucide-react'
import { post, del, listApi } from '@/lib/api'
import { dt } from '@/lib/utils'
import { DataTable, type ColumnMeta } from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
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

// ---- 后端返回结构（listRedeemCodes / plans）----
type RedeemStatus = 'active' | 'disabled' | 'used'

interface RedeemCode {
  id: string
  code: string
  status: RedeemStatus
  durationDays: number | null
  lifetime: boolean
  note: string
  batchId: string | null
  codeExpiresAt: string | null
  redeemedAt: string | null
  createdAt: string
  planName: string
  tier: string
  redeemedBy: string | null
  maxUses: number | null
  usedCount: number
}

interface Plan {
  id: string
  name: string
  tier: string
}

interface CreateResult {
  batchId: string
  codes: string[]
}

const meta = (m: ColumnMeta): ColumnMeta => m

const tierLabel = (t: string) =>
  t === 'premium' ? '超级会员' : t === 'standard' ? '普通会员' : t === 'trial' ? '试用' : t

const statusLabel = (s: RedeemStatus) =>
  s === 'active' ? '启用' : s === 'disabled' ? '停用' : '已使用'

const termLabel = (r: RedeemCode) =>
  r.lifetime ? '永久' : r.durationDays != null ? `${r.durationDays} 天` : '—'

const shortId = (id: string | null) => (id ? id.slice(0, 8) : '—')

async function copyText(text: string, okMsg = '已复制到剪贴板') {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(okMsg)
  } catch {
    toast.error('复制失败，请手动选择复制')
  }
}

export default function RedeemPage() {
  const [refresh, setRefresh] = React.useState(0)
  const bump = () => setRefresh((r) => r + 1)

  // 套餐列表（用于筛选与生成表单）
  const [plans, setPlans] = React.useState<Plan[]>([])
  React.useEffect(() => {
    listApi<Plan>('/v1/admin/plans', { limit: 100 })
      .then((r) => setPlans(r.items))
      .catch(() => setPlans([]))
  }, [])

  // 批次筛选（faceted 之外，走 extraParams 文本输入）
  const [batchFilter, setBatchFilter] = React.useState('')
  const extraParams = React.useMemo(
    () => ({ batchId: batchFilter.trim() }),
    [batchFilter],
  )

  // 弹窗状态
  const [createOpen, setCreateOpen] = React.useState(false)
  const [delRow, setDelRow] = React.useState<RedeemCode | null>(null)

  // 行操作：启用 / 停用
  async function toggleStatus(row: RedeemCode) {
    const next = row.status === 'active' ? 'disabled' : 'active'
    try {
      await post(`/v1/admin/redeem-codes/${row.id}/status`, { status: next })
      toast.success(next === 'active' ? `已启用 ${row.code}` : `已停用 ${row.code}`)
      bump()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const planName = React.useCallback(
    (id: string) => plans.find((p) => p.id === id)?.name ?? id,
    [plans],
  )

  const columns = React.useMemo<ColumnDef<RedeemCode, unknown>[]>(
    () => [
      {
        id: 'code',
        header: '兑换码',
        meta: meta({ sortKey: 'code' }),
        cell: ({ row }) => {
          const r = row.original
          return (
            <div className="min-w-0">
              <button
                type="button"
                className="inline-flex items-center gap-1 font-mono font-medium hover:text-primary"
                title="点击复制"
                onClick={() => copyText(r.code, `已复制 ${r.code}`)}
              >
                {r.code}
                <Copy className="h-3.5 w-3.5 opacity-50" />
              </button>
              {r.note && (
                <div className="truncate text-xs text-muted-foreground">{r.note}</div>
              )}
            </div>
          )
        },
      },
      {
        id: 'plan',
        header: '套餐 / 时长',
        cell: ({ row }) => (
          <div>
            <div>{row.original.planName}</div>
            <div className="text-xs text-muted-foreground">
              {tierLabel(row.original.tier)} · {termLabel(row.original)}
            </div>
          </div>
        ),
      },
      {
        id: 'status',
        header: '状态',
        meta: meta({ sortKey: 'status' }),
        cell: ({ row }) => <StatusBadge value={statusLabel(row.original.status)} />,
      },
      {
        id: 'uses',
        header: '使用次数',
        cell: ({ row }) => {
          const r = row.original
          const cap = r.maxUses == null ? '不限' : r.maxUses
          const full = r.maxUses != null && r.usedCount >= r.maxUses
          return (
            <div>
              <div className={full ? 'text-sm font-medium text-destructive' : 'text-sm font-medium'}>
                {r.usedCount} / {cap}
              </div>
              <div className="text-xs text-muted-foreground">
                {r.maxUses === 1 ? '单次' : '多人复用'}
                {full ? ' · 已领完' : ''}
              </div>
            </div>
          )
        },
      },
      {
        id: 'redeem',
        header: '最近兑换',
        meta: meta({ sortKey: 'redeemedAt' }),
        cell: ({ row }) => {
          const r = row.original
          return r.redeemedBy || r.redeemedAt ? (
            <div>
              <div className="text-sm">{r.redeemedBy ?? '已使用'}</div>
              <div className="text-xs text-muted-foreground">{dt(r.redeemedAt)}</div>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">未兑换</span>
          )
        },
      },
      {
        id: 'codeExpiresAt',
        header: '有效期',
        meta: meta({ sortKey: 'codeExpiresAt' }),
        cell: ({ row }) => {
          const v = row.original.codeExpiresAt
          if (!v) return <span className="text-sm text-muted-foreground">永不过期</span>
          const expired = new Date(v).getTime() < Date.now()
          return (
            <span className={expired ? 'text-sm text-destructive' : 'text-sm'}>
              {dt(v)}
              {expired && row.original.status !== 'used' ? '（已过期）' : ''}
            </span>
          )
        },
      },
      {
        id: 'createdAt',
        header: '创建 / 批次',
        meta: meta({ sortKey: 'createdAt' }),
        cell: ({ row }) => {
          const r = row.original
          return (
            <div>
              <div className="text-sm text-muted-foreground">{dt(r.createdAt)}</div>
              {r.batchId && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-primary"
                  title="筛选该批次"
                  onClick={() => setBatchFilter(r.batchId!)}
                >
                  <Filter className="h-3 w-3" />
                  {shortId(r.batchId)}
                </button>
              )}
            </div>
          )
        },
      },
      {
        id: 'actions',
        header: '',
        meta: meta({ className: 'text-right' }),
        cell: ({ row }) => {
          const r = row.original
          const used = r.status === 'used'
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
                  <DropdownMenuLabel className="font-mono text-xs">{r.code}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => copyText(r.code, `已复制 ${r.code}`)}>
                    <Copy className="h-4 w-4" />
                    复制兑换码
                  </DropdownMenuItem>
                  {r.batchId && (
                    <DropdownMenuItem onClick={() => setBatchFilter(r.batchId!)}>
                      <Filter className="h-4 w-4" />
                      筛选该批次
                    </DropdownMenuItem>
                  )}
                  {!used && (
                    <DropdownMenuItem onClick={() => toggleStatus(r)}>
                      {r.status === 'active' ? (
                        <>
                          <Pause className="h-4 w-4" />
                          停用
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4" />
                          启用
                        </>
                      )}
                    </DropdownMenuItem>
                  )}
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
    // 处理器均为闭包内稳定引用，plans 变化不影响列渲染
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return (
    <>
      <DataTable<RedeemCode>
        columns={columns}
        fetcher={(query) =>
          listApi<RedeemCode>('/v1/admin/redeem-codes', {
            q: query.q,
            limit: query.limit,
            offset: query.offset,
            ...(query.sort ? { sort: query.sort } : {}),
            ...(query.order ? { order: query.order } : {}),
            ...query.filters,
          })
        }
        searchPlaceholder="搜索兑换码 / 备注…"
        refreshSignal={refresh}
        extraParams={extraParams}
        initialSort={{ sort: 'createdAt', order: 'desc' }}
        filters={[
          {
            key: 'status',
            label: '状态',
            options: [
              { label: '启用', value: 'active' },
              { label: '停用', value: 'disabled' },
              { label: '已使用', value: 'used' },
            ],
          },
          {
            key: 'planId',
            label: '套餐',
            options: plans.map((p) => ({ label: p.name, value: p.id })),
          },
          {
            key: 'lifetime',
            label: '类型',
            options: [
              { label: '永久', value: 'true' },
              { label: '限时', value: 'false' },
            ],
          },
        ]}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Input
                value={batchFilter}
                onChange={(e) => setBatchFilter(e.target.value)}
                placeholder="按批次 ID 筛选…"
                className="h-9 w-[220px] pr-8 font-mono"
                title="精确匹配批次 ID"
              />
              {batchFilter && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  title="清除批次筛选"
                  onClick={() => setBatchFilter('')}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <Ticket className="h-4 w-4" />
              批量生成
            </Button>
          </div>
        }
      />

      <CreateRedeemDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        plans={plans}
        planName={planName}
        onGenerated={bump}
        onFilterBatch={setBatchFilter}
      />
      <DeleteRedeemDialog row={delRow} onOpenChange={(o) => !o && setDelRow(null)} onDone={bump} />
    </>
  )
}

// ---------- 批量生成兑换码 ----------
function CreateRedeemDialog({
  open,
  onOpenChange,
  plans,
  planName,
  onGenerated,
  onFilterBatch,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  plans: Plan[]
  planName: (id: string) => string
  onGenerated: () => void
  onFilterBatch: (batchId: string) => void
}) {
  const [planId, setPlanId] = React.useState('')
  const [lifetime, setLifetime] = React.useState(false)
  const [days, setDays] = React.useState(30)
  const [count, setCount] = React.useState(10)
  const [unlimitedUses, setUnlimitedUses] = React.useState(false)
  const [maxUses, setMaxUses] = React.useState(50)
  const [note, setNote] = React.useState('')
  const [expires, setExpires] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<CreateResult | null>(null)

  React.useEffect(() => {
    if (open) {
      setPlanId(plans[0]?.id ?? '')
      setLifetime(false)
      setDays(30)
      setCount(10)
      setUnlimitedUses(false)
      setMaxUses(50)
      setNote('')
      setExpires('')
      setResult(null)
    }
  }, [open, plans])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!planId) return
    setBusy(true)
    try {
      const res = await post<CreateResult>('/v1/admin/redeem-codes', {
        planId,
        lifetime,
        durationDays: lifetime ? null : days,
        count,
        maxUses: unlimitedUses ? null : maxUses,
        note: note.trim(),
        codeExpiresAt: expires ? new Date(expires).toISOString() : null,
      })
      setResult(res)
      toast.success(`已生成 ${res.codes.length} 个兑换码`)
      onGenerated()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>批量生成兑换码</DialogTitle>
          <DialogDescription>
            兑换码绑定套餐（决定等级 / 设备数 / 权益）与时长；用户兑换后自动发放会员。明码仅在生成后展示一次，请及时复制保存。
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <div>
                套餐 <span className="font-medium">{planName(planId)}</span> · 共{' '}
                <span className="font-medium">{result.codes.length}</span> 个 · 批次{' '}
                <span className="font-mono text-xs text-muted-foreground">
                  {shortId(result.batchId)}
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copyText(result.codes.join('\n'), '已复制全部兑换码')}
              >
                <Copy className="h-4 w-4" />
                复制全部
              </Button>
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
              {result.codes.map((c) => (
                <div
                  key={c}
                  className="flex items-center justify-between rounded px-2 py-1 font-mono text-sm hover:bg-muted"
                >
                  <span>{c}</span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    title="复制"
                    onClick={() => copyText(c, `已复制 ${c}`)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setResult(null)}
              >
                再生成一批
              </Button>
              <Button
                type="button"
                onClick={() => {
                  onFilterBatch(result.batchId)
                  onOpenChange(false)
                }}
              >
                <Check className="h-4 w-4" />
                完成并查看该批次
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label>套餐（会员等级）</Label>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择套餐" />
                </SelectTrigger>
                <SelectContent>
                  {plans.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}（{tierLabel(p.tier)}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>有效天数</Label>
                <Input
                  type="number"
                  min={1}
                  max={36500}
                  disabled={lifetime}
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                />
              </div>
              <label className="flex items-center gap-2 pb-2 text-sm self-end">
                <Checkbox checked={lifetime} onCheckedChange={(v) => setLifetime(v === true)} />
                永久有效
              </label>
            </div>

            {/* 发放方式：把「生成几个码」与「每码可兑人数」放一起 + 快捷预设 + 实时说明，消除两个维度的混淆 */}
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">发放方式</Label>
                <div className="flex gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setUnlimitedUses(false)
                      setMaxUses(1)
                      if (count < 2) setCount(10)
                    }}
                  >
                    一人一码
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setCount(1)
                      setUnlimitedUses(false)
                      setMaxUses(50)
                    }}
                  >
                    一码多人
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>生成几个码</Label>
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">本次创建多少个不同的兑换码。</p>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>每码可兑换人数</Label>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Checkbox
                        checked={unlimitedUses}
                        onCheckedChange={(v) => setUnlimitedUses(v === true)}
                      />
                      不限
                    </label>
                  </div>
                  <Input
                    type="number"
                    min={1}
                    max={1000000}
                    disabled={unlimitedUses}
                    value={maxUses}
                    onChange={(e) => setMaxUses(Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">每个码可被多少个不同账号兑换。</p>
                </div>
              </div>
              <p className="rounded bg-muted px-3 py-2 text-xs text-muted-foreground">
                {unlimitedUses
                  ? `将生成 ${count} 个码，每个码不限兑换人数（仅受有效期约束）；同一账号对同一码只能兑一次。`
                  : maxUses <= 1
                    ? `将生成 ${count} 个「一人一码」单次码，可发放给 ${count} 个账号，每人一个、各用一次。`
                    : `将生成 ${count} 个码，每个码可被 ${maxUses} 个不同账号兑换，最多覆盖 ${count * maxUses} 人次；同一账号对同一码只能兑一次。`}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>码有效期（可选）</Label>
              <Input
                type="datetime-local"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">留空表示兑换码永不过期。</p>
            </div>
            <div className="space-y-1.5">
              <Label>备注（可选）</Label>
              <Textarea
                value={note}
                maxLength={200}
                rows={2}
                placeholder="例如：双十一活动 / 渠道 A"
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button
                type="submit"
                disabled={busy || !planId || (!lifetime && days < 1) || (!unlimitedUses && maxUses < 1)}
              >
                {busy ? '生成中…' : `生成 ${count} 个`}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------- 删除兑换码（二次确认；已用返回 409）----------
function DeleteRedeemDialog({
  row,
  onOpenChange,
  onDone,
}: {
  row: RedeemCode | null
  onOpenChange: (o: boolean) => void
  onDone: () => void
}) {
  const [busy, setBusy] = React.useState(false)
  async function confirmDelete() {
    if (!row) return
    setBusy(true)
    try {
      await del(`/v1/admin/redeem-codes/${row.id}`)
      toast.success(`已删除兑换码 ${row.code}`)
      onOpenChange(false)
      onDone()
    } catch (err) {
      // 已被使用的兑换码后端返回 409，直接透传 message
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除兑换码</DialogTitle>
          <DialogDescription>
            确认删除{' '}
            <span className="font-mono font-medium text-foreground">{row?.code}</span>？
            已被使用的兑换码无法删除（会保留兑换记录）。此操作不可撤销。
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
