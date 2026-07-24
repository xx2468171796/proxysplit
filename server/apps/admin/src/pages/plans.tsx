import * as React from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { MoreHorizontal, PackagePlus, Pencil, Trash2 } from 'lucide-react'
import { post, patch, del, listApi } from '@/lib/api'
import { dt, money } from '@/lib/utils'
import { DataTable, type ColumnMeta } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
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

// 后端 listPlans 返回结构（camelCase）。
type Tier = 'trial' | 'standard' | 'premium'
type BillingCycle = 'trial' | 'month' | 'quarter' | 'year' | 'lifetime' | 'custom'

interface Plan {
  id: string
  code: string
  name: string
  description: string
  tier: Tier
  billingCycle: BillingCycle
  durationDays: number | null
  lifetime: boolean
  priceCents: number
  originalPriceCents: number | null
  currency: string
  maxDevices: number
  features: string[]
  active: boolean
  public: boolean
  sortOrder: number
  badge: string
  saleStartsAt: string | null
  saleEndsAt: string | null
  purchaseLimitPerUser: number | null
  createdAt: string
  updatedAt: string
}

// 提交给 planUpsertSchema / planPatchSchema 的字段（分为单位、features 数组）。
interface PlanPayload {
  name: string
  description: string
  tier: Tier
  billingCycle: BillingCycle
  durationDays: number | null
  lifetime: boolean
  priceCents: number
  originalPriceCents: number | null
  currency: 'CNY'
  maxDevices: number
  features: string[]
  active: boolean
  public: boolean
  sortOrder: number
  badge: string
}

const TIER_OPTIONS: { label: string; value: Tier }[] = [
  { label: '试用', value: 'trial' },
  { label: '普通会员', value: 'standard' },
  { label: '超级会员', value: 'premium' },
]
const BILLING_OPTIONS: { label: string; value: BillingCycle }[] = [
  { label: '试用', value: 'trial' },
  { label: '月付', value: 'month' },
  { label: '季付', value: 'quarter' },
  { label: '年付', value: 'year' },
  { label: '永久', value: 'lifetime' },
  { label: '自定义', value: 'custom' },
]

const tierLabel = (t: string) => TIER_OPTIONS.find((o) => o.value === t)?.label ?? t
const billingLabel = (c: string) => BILLING_OPTIONS.find((o) => o.value === c)?.label ?? c
const tierTone = (t: string) =>
  t === 'premium' ? 'default' : t === 'standard' ? 'secondary' : 'outline'

const meta = (m: ColumnMeta): ColumnMeta => m

export default function PlansPage() {
  const [refresh, setRefresh] = React.useState(0)
  const bump = () => setRefresh((r) => r + 1)

  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Plan | null>(null)
  const [delRow, setDelRow] = React.useState<Plan | null>(null)

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }
  function openEdit(p: Plan) {
    setEditing(p)
    setFormOpen(true)
  }

  const columns = React.useMemo<ColumnDef<Plan, unknown>[]>(
    () => [
      {
        id: 'name',
        header: '套餐',
        meta: meta({ sortKey: 'name' }),
        cell: ({ row }) => {
          const p = row.original
          return (
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 font-medium">
                {p.name}
                {p.badge && (
                  <Badge variant="warning" className="font-normal">
                    {p.badge}
                  </Badge>
                )}
              </div>
              <div className="font-mono text-xs text-muted-foreground">{p.code}</div>
            </div>
          )
        },
      },
      {
        id: 'tier',
        header: '等级',
        meta: meta({ sortKey: 'tier' }),
        cell: ({ row }) => (
          <Badge variant={tierTone(row.original.tier)}>{tierLabel(row.original.tier)}</Badge>
        ),
      },
      {
        id: 'billingCycle',
        header: '周期',
        cell: ({ row }) => {
          const p = row.original
          return (
            <div>
              <div>{billingLabel(p.billingCycle)}</div>
              <div className="text-xs text-muted-foreground">
                {p.lifetime ? '永久有效' : p.durationDays ? `${p.durationDays} 天` : '—'}
              </div>
            </div>
          )
        },
      },
      {
        id: 'price',
        header: '价格',
        meta: meta({ sortKey: 'priceCents' }),
        cell: ({ row }) => {
          const p = row.original
          const hasOriginal = p.originalPriceCents != null && p.originalPriceCents > p.priceCents
          return (
            <div>
              <div className="font-medium">{money(p.priceCents)}</div>
              {hasOriginal && (
                <div className="text-xs text-muted-foreground line-through">
                  {money(p.originalPriceCents)}
                </div>
              )}
            </div>
          )
        },
      },
      {
        id: 'maxDevices',
        header: '设备',
        cell: ({ row }) => `${row.original.maxDevices} 台`,
      },
      {
        id: 'features',
        header: '权益',
        cell: ({ row }) => {
          const f = row.original.features ?? []
          if (f.length === 0) return <span className="text-muted-foreground">—</span>
          return (
            <span className="text-sm text-muted-foreground" title={f.join('、')}>
              {f.length} 项
            </span>
          )
        },
      },
      {
        id: 'status',
        header: '状态',
        cell: ({ row }) => {
          const p = row.original
          return (
            <div className="flex flex-wrap items-center gap-1">
              <Badge variant={p.active ? 'success' : 'secondary'}>
                {p.active ? '已上架' : '已下架'}
              </Badge>
              <Badge variant={p.public ? 'outline' : 'secondary'}>
                {p.public ? '公开' : '隐藏'}
              </Badge>
            </div>
          )
        },
      },
      {
        id: 'sortOrder',
        header: '排序',
        meta: meta({ sortKey: 'sortOrder' }),
        cell: ({ row }) => <span className="tabular-nums">{row.original.sortOrder}</span>,
      },
      {
        id: 'updatedAt',
        header: '更新时间',
        meta: meta({ sortKey: 'updatedAt' }),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{dt(row.original.updatedAt)}</span>
        ),
      },
      {
        id: 'actions',
        header: '',
        meta: meta({ className: 'text-right' }),
        cell: ({ row }) => {
          const p = row.original
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
                  <DropdownMenuLabel>{p.code}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => openEdit(p)}>
                    <Pencil className="h-4 w-4" />
                    编辑
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setDelRow(p)}
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
    // 处理器为组件内稳定引用，无需重建列
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return (
    <>
      <DataTable<Plan>
        columns={columns}
        fetcher={(query) =>
          listApi<Plan>('/v1/admin/plans', {
            q: query.q,
            limit: query.limit,
            offset: query.offset,
            ...(query.sort ? { sort: query.sort } : {}),
            ...(query.order ? { order: query.order } : {}),
            ...query.filters,
          })
        }
        searchPlaceholder="搜索套餐 code / 名称 / 描述…"
        refreshSignal={refresh}
        initialSort={{ sort: 'sortOrder', order: 'asc' }}
        filters={[
          { key: 'tier', label: '等级', options: TIER_OPTIONS },
          { key: 'billingCycle', label: '周期', options: BILLING_OPTIONS },
          {
            key: 'active',
            label: '上架',
            options: [
              { label: '已上架', value: 'true' },
              { label: '已下架', value: 'false' },
            ],
          },
          {
            key: 'public',
            label: '可见性',
            options: [
              { label: '公开', value: 'true' },
              { label: '隐藏', value: 'false' },
            ],
          },
        ]}
        toolbar={
          <Button onClick={openCreate}>
            <PackagePlus className="h-4 w-4" />
            新建套餐
          </Button>
        }
      />

      <PlanFormDialog
        open={formOpen}
        editing={editing}
        onOpenChange={setFormOpen}
        onDone={bump}
      />
      <DeletePlanDialog row={delRow} onOpenChange={(o) => !o && setDelRow(null)} onDone={bump} />
    </>
  )
}

// ---------- 新建 / 编辑套餐 ----------
function PlanFormDialog({
  open,
  editing,
  onOpenChange,
  onDone,
}: {
  open: boolean
  editing: Plan | null
  onOpenChange: (o: boolean) => void
  onDone: () => void
}) {
  const isEdit = !!editing

  const [code, setCode] = React.useState('')
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [tier, setTier] = React.useState<Tier>('standard')
  const [billingCycle, setBillingCycle] = React.useState<BillingCycle>('month')
  const [durationDays, setDurationDays] = React.useState('30')
  const [priceYuan, setPriceYuan] = React.useState('')
  const [originalYuan, setOriginalYuan] = React.useState('')
  const [maxDevices, setMaxDevices] = React.useState('1')
  const [featuresText, setFeaturesText] = React.useState('')
  const [sortOrder, setSortOrder] = React.useState('100')
  const [badge, setBadge] = React.useState('')
  const [active, setActive] = React.useState(false)
  const [isPublic, setIsPublic] = React.useState(true)
  const [busy, setBusy] = React.useState(false)

  const lifetime = billingCycle === 'lifetime'

  React.useEffect(() => {
    if (!open) return
    if (editing) {
      setCode(editing.code)
      setName(editing.name)
      setDescription(editing.description ?? '')
      setTier(editing.tier)
      setBillingCycle(editing.billingCycle)
      setDurationDays(editing.durationDays != null ? String(editing.durationDays) : '30')
      setPriceYuan((editing.priceCents / 100).toString())
      setOriginalYuan(
        editing.originalPriceCents != null ? (editing.originalPriceCents / 100).toString() : '',
      )
      setMaxDevices(String(editing.maxDevices))
      setFeaturesText((editing.features ?? []).join('\n'))
      setSortOrder(String(editing.sortOrder))
      setBadge(editing.badge ?? '')
      setActive(editing.active)
      setIsPublic(editing.public)
    } else {
      setCode('')
      setName('')
      setDescription('')
      setTier('standard')
      setBillingCycle('month')
      setDurationDays('30')
      setPriceYuan('')
      setOriginalYuan('')
      setMaxDevices('1')
      setFeaturesText('')
      setSortOrder('100')
      setBadge('')
      setActive(false)
      setIsPublic(true)
    }
  }, [open, editing])

  function onBillingChange(v: BillingCycle) {
    setBillingCycle(v)
    if (v !== 'lifetime' && (!durationDays || Number(durationDays) < 1)) setDurationDays('30')
  }
  function onLifetimeToggle(checked: boolean) {
    if (checked) setBillingCycle('lifetime')
    else {
      setBillingCycle('month')
      if (!durationDays || Number(durationDays) < 1) setDurationDays('30')
    }
  }

  function parseFeatures(text: string): string[] {
    return Array.from(
      new Set(
        text
          .split(/[\n,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ).slice(0, 50)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()

    if (!isEdit && !/^[a-z0-9][a-z0-9-]{1,62}$/.test(code)) {
      toast.error('code 需为 2-63 位小写字母 / 数字 / 连字符，且以字母或数字开头')
      return
    }
    if (!lifetime && (!durationDays || Number(durationDays) < 1)) {
      toast.error('非永久套餐必须设置有效天数')
      return
    }
    const priceCents = Math.round(Number(priceYuan || 0) * 100)
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      toast.error('价格无效')
      return
    }
    const originalPriceCents =
      originalYuan.trim() === '' ? null : Math.round(Number(originalYuan) * 100)

    const payload: PlanPayload = {
      name: name.trim(),
      description: description.trim(),
      tier,
      billingCycle,
      durationDays: lifetime ? null : Number(durationDays),
      lifetime,
      priceCents,
      originalPriceCents,
      currency: 'CNY',
      maxDevices: Number(maxDevices),
      features: parseFeatures(featuresText),
      active,
      public: isPublic,
      sortOrder: Number(sortOrder),
      badge: badge.trim(),
    }

    setBusy(true)
    try {
      if (isEdit && editing) {
        await patch(`/v1/admin/plans/${editing.id}`, payload)
        toast.success(`已更新套餐 ${payload.name}`)
      } else {
        await post('/v1/admin/plans', { code: code.trim(), ...payload })
        toast.success(`已创建套餐 ${payload.name}`)
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
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `编辑套餐 · ${editing?.code}` : '新建套餐'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'code 创建后不可修改；调整等级 / 周期 / 设备数 / 权益等会影响后续下单。'
              : '配置套餐的定价、周期与权益。code 为唯一标识，创建后不可修改。'}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={submit}>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>标识 code</Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="premium-year"
                disabled={isEdit}
                required={!isEdit}
              />
            </div>
            <div className="space-y-1.5">
              <Label>名称</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="超级会员年卡"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>会员等级</Label>
              <Select value={tier} onValueChange={(v) => setTier(v as Tier)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIER_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>计费周期</Label>
              <Select value={billingCycle} onValueChange={(v) => onBillingChange(v as BillingCycle)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BILLING_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>有效天数</Label>
              <Input
                type="number"
                min={1}
                max={36500}
                value={lifetime ? '' : durationDays}
                onChange={(e) => setDurationDays(e.target.value)}
                disabled={lifetime}
                placeholder={lifetime ? '永久有效' : '30'}
              />
            </div>
            <div className="space-y-1.5">
              <Label>设备数上限</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={maxDevices}
                onChange={(e) => setMaxDevices(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>售价（元）</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={priceYuan}
                onChange={(e) => setPriceYuan(e.target.value)}
                placeholder="0.00"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>原价（元，可选）</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={originalYuan}
                onChange={(e) => setOriginalYuan(e.target.value)}
                placeholder="划线价，留空不显示"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>排序权重</Label>
              <Input
                type="number"
                min={0}
                max={10000}
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>角标（可选）</Label>
              <Input
                value={badge}
                onChange={(e) => setBadge(e.target.value)}
                placeholder="如：热销 / 推荐"
                maxLength={30}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>权益（每行或逗号分隔一项）</Label>
            <Textarea
              value={featuresText}
              onChange={(e) => setFeaturesText(e.target.value)}
              placeholder={'proxy\nrules\ncustom-lines'}
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label>描述（可选）</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="套餐说明，最多 500 字"
              rows={2}
              maxLength={500}
            />
          </div>

          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={lifetime} onCheckedChange={(v) => onLifetimeToggle(v === true)} />
              永久有效
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={active} onCheckedChange={(v) => setActive(v === true)} />
              上架销售
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={isPublic} onCheckedChange={(v) => setIsPublic(v === true)} />
              公开展示
            </label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? '保存中…' : isEdit ? '保存修改' : '创建套餐'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------- 删除套餐（二次确认，被引用返回 409）----------
function DeletePlanDialog({
  row,
  onOpenChange,
  onDone,
}: {
  row: Plan | null
  onOpenChange: (o: boolean) => void
  onDone: () => void
}) {
  const [busy, setBusy] = React.useState(false)
  async function confirmDelete() {
    if (!row) return
    setBusy(true)
    try {
      await del(`/v1/admin/plans/${row.id}`)
      toast.success(`已删除套餐 ${row.name}`)
      onOpenChange(false)
      onDone()
    } catch (err) {
      // 被订单 / 授权 / 兑换码引用时后端返回 409，message 已提示改用停用
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除套餐</DialogTitle>
          <DialogDescription>
            确认删除 <span className="font-medium text-foreground">{row?.name}</span>（
            {row?.code}）？若该套餐已被订单 / 授权 / 兑换码引用将无法删除，此时请改为在编辑中取消
            “上架销售” 停用它。
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
