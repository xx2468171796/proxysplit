import * as React from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import {
  BadgeCheck,
  KeyRound,
  MoreHorizontal,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  UserPlus,
} from 'lucide-react'
import { get, post, patch, del, listApi } from '@/lib/api'
import { dt, money } from '@/lib/utils'
import { DataTable, type ColumnMeta } from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
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

type Row = Record<string, any>

const tierLabel = (t: string) =>
  t === 'premium' ? '超级会员' : t === 'standard' ? '普通会员' : t === 'trial' ? '试用' : t

// 密码位数阈值（与后端 schema 对齐：创建=10 位，重置=8 位）。
const CREATE_PWD_MIN = 10
const RESET_PWD_MIN = 8

const meta = (m: ColumnMeta): ColumnMeta => m

// ---- 领域状态：显式「中文 label + variant 映射表」，与筛选下拉的中文保持一致 ----
type StatusMeta = { label: string; variant: BadgeProps['variant'] }

/** 账号状态：正常=绿；暂停/封禁=红。 */
const USER_STATUS: Record<string, StatusMeta> = {
  active: { label: '正常', variant: 'success' },
  suspended: { label: '已暂停', variant: 'destructive' },
  banned: { label: '已封禁', variant: 'destructive' },
}
function UserStatus({ value }: { value: string }) {
  const s = USER_STATUS[value] ?? { label: value, variant: 'secondary' as const }
  return <Badge variant={s.variant}>{s.label}</Badge>
}

/** 会员授权状态：有效=绿；已撤销=红；已暂停 / 已过期=灰。 */
const LICENSE_STATUS: Record<string, StatusMeta> = {
  active: { label: '有效', variant: 'success' },
  paused: { label: '已暂停', variant: 'secondary' },
  revoked: { label: '已撤销', variant: 'destructive' },
  expired: { label: '已过期', variant: 'secondary' },
}
function LicenseStatus({ value }: { value: string }) {
  const s = LICENSE_STATUS[value] ?? { label: value, variant: 'secondary' as const }
  return <Badge variant={s.variant}>{s.label}</Badge>
}

/** 订单状态：已支付=绿；待支付=黄；失败 / 退款=红；关闭=灰。 */
const ORDER_STATUS: Record<string, StatusMeta> = {
  paid: { label: '已支付', variant: 'success' },
  pending: { label: '待支付', variant: 'warning' },
  failed: { label: '支付失败', variant: 'destructive' },
  closed: { label: '已关闭', variant: 'secondary' },
  refunded: { label: '已退款', variant: 'destructive' },
}
function OrderStatus({ value }: { value: string }) {
  const s = ORDER_STATUS[value] ?? { label: value, variant: 'secondary' as const }
  return <Badge variant={s.variant}>{s.label}</Badge>
}

/** 必填星号。 */
function Req() {
  return <span className="text-destructive"> *</span>
}

export default function UsersPage() {
  const [refresh, setRefresh] = React.useState(0)
  const bump = () => setRefresh((r) => r + 1)

  const [plans, setPlans] = React.useState<Row[]>([])
  React.useEffect(() => {
    listApi<Row>('/v1/admin/plans', { limit: 100 })
      .then((r) => setPlans(r.items))
      .catch(() => setPlans([]))
  }, [])

  // 弹窗状态
  const [createOpen, setCreateOpen] = React.useState(false)
  const [grantRow, setGrantRow] = React.useState<Row | null>(null)
  const [pwdRow, setPwdRow] = React.useState<Row | null>(null)
  const [delRow, setDelRow] = React.useState<Row | null>(null)
  const [detailId, setDetailId] = React.useState<string | null>(null)

  // 日期范围筛选（faceted 之外）
  const [createdFrom, setCreatedFrom] = React.useState('')
  const [createdTo, setCreatedTo] = React.useState('')
  const extraParams = React.useMemo(
    () => ({
      createdFrom: createdFrom ? new Date(createdFrom).toISOString() : '',
      createdTo: createdTo ? new Date(createdTo).toISOString() : '',
    }),
    [createdFrom, createdTo],
  )

  // 行操作
  async function extend(row: Row) {
    try {
      await post(`/v1/admin/users/${row.id}/extend`, { days: 30 })
      toast.success(`已为 ${row.username} 续费 30 天`)
      bump()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  async function toggleStatus(row: Row) {
    const next = row.status === 'active' ? 'suspended' : 'active'
    try {
      await patch(`/v1/admin/users/${row.id}/status`, { status: next })
      toast.success(next === 'active' ? `已恢复 ${row.username}` : `已暂停 ${row.username}`)
      bump()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const columns = React.useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: 'username',
        header: '用户',
        meta: meta({ sortKey: 'username' }),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-medium">{row.original.username}</div>
            <div className="truncate text-xs text-muted-foreground" title={row.original.email || undefined}>
              {row.original.email || '未填写邮箱'}
            </div>
          </div>
        ),
      },
      {
        id: 'membership',
        header: '会员 / 到期',
        cell: ({ row }) => (
          <div>
            <div>{row.original.planName || '未开通'}</div>
            <div className="text-xs text-muted-foreground">
              {row.original.lifetime ? '永久有效' : dt(row.original.expiresAt)}
            </div>
          </div>
        ),
      },
      {
        id: 'tier',
        header: '等级',
        meta: meta({ sortKey: 'tier' }),
        cell: ({ row }) => (row.original.tier ? tierLabel(row.original.tier) : '—'),
      },
      {
        id: 'loginMethod',
        header: '登录方式',
        cell: ({ row }) => {
          const ids: string[] = row.original.identities ?? []
          const parts = [row.original.hasPassword === false ? null : '密码', ids.includes('powervpn') ? 'POWER云' : null].filter(Boolean)
          return parts.length ? parts.join(' / ') : '—'
        },
      },
      {
        id: 'devices',
        header: '设备',
        cell: ({ row }) => row.original.devices ?? 0,
      },
      {
        id: 'status',
        header: '状态',
        meta: meta({ sortKey: 'status' }),
        cell: ({ row }) => <UserStatus value={row.original.status} />,
      },
      {
        id: 'createdAt',
        header: '注册时间',
        meta: meta({ sortKey: 'created_at' }),
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{dt(row.original.createdAt)}</span>,
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
                  <DropdownMenuLabel>{r.username}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setDetailId(r.id)}>
                    <BadgeCheck className="h-4 w-4" />
                    详情
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setGrantRow(r)}>
                    <BadgeCheck className="h-4 w-4" />
                    发放会员
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => extend(r)}
                    title="立即为该用户在现有到期时间上续费固定 30 天，无需二次确认"
                  >
                    <RefreshCw className="h-4 w-4" />
                    续费 30 天
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setPwdRow(r)}>
                    <KeyRound className="h-4 w-4" />
                    修改密码
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => toggleStatus(r)}>
                    {r.status === 'active' ? (
                      <>
                        <Pause className="h-4 w-4" />
                        暂停
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4" />
                        恢复
                      </>
                    )}
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
    // 处理器均为闭包内稳定引用，plans 变化不影响列
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return (
    <>
      <DataTable<Row>
        columns={columns}
        fetcher={(query) =>
          listApi<Row>('/v1/admin/users', {
            q: query.q,
            limit: query.limit,
            offset: query.offset,
            ...(query.sort ? { sort: query.sort } : {}),
            ...(query.order ? { order: query.order } : {}),
            ...query.filters,
          })
        }
        searchPlaceholder="搜索用户名 / 邮箱 / 备注…"
        refreshSignal={refresh}
        extraParams={extraParams}
        initialSort={{ sort: 'created_at', order: 'desc' }}
        emptyText="还没有用户，点右上角『创建用户』"
        filters={[
          {
            key: 'status',
            label: '状态',
            options: [
              { label: '正常', value: 'active' },
              { label: '已暂停', value: 'suspended' },
              { label: '已封禁', value: 'banned' },
            ],
          },
          {
            key: 'role',
            label: '角色',
            options: [
              { label: '普通用户', value: 'user' },
              { label: '管理员', value: 'admin' },
            ],
          },
          {
            key: 'tier',
            label: '等级',
            options: [
              { label: '试用', value: 'trial' },
              { label: '普通会员', value: 'standard' },
              { label: '超级会员', value: 'premium' },
            ],
          },
          {
            key: 'membership',
            label: '会员状态',
            options: [
              { label: '有效', value: 'active' },
              { label: '即将到期', value: 'expiring' },
              { label: '已过期', value: 'expired' },
            ],
          },
        ]}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground">注册</span>
              <Input
                type="date"
                value={createdFrom}
                onChange={(e) => setCreatedFrom(e.target.value)}
                className="h-9 w-[150px]"
                title="注册起始日期"
              />
              <span className="text-muted-foreground">–</span>
              <Input
                type="date"
                value={createdTo}
                onChange={(e) => setCreatedTo(e.target.value)}
                className="h-9 w-[150px]"
                title="注册截止日期"
              />
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <UserPlus className="h-4 w-4" />
              创建用户
            </Button>
          </div>
        }
      />

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} plans={plans} onDone={bump} />
      <GrantDialog row={grantRow} onOpenChange={(o) => !o && setGrantRow(null)} plans={plans} onDone={bump} />
      <PasswordDialog row={pwdRow} onOpenChange={(o) => !o && setPwdRow(null)} />
      <DeleteUserDialog row={delRow} onOpenChange={(o) => !o && setDelRow(null)} onDone={bump} />
      <UserDetailDialog id={detailId} onOpenChange={(o) => !o && setDetailId(null)} />
    </>
  )
}

// ---------- 创建用户 ----------
function CreateUserDialog({
  open,
  onOpenChange,
  plans,
  onDone,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  plans: Row[]
  onDone: () => void
}) {
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [planId, setPlanId] = React.useState('')
  const [days, setDays] = React.useState(30)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setUsername('')
      setPassword('')
      setPlanId(plans[0]?.id ?? '')
      setDays(30)
    }
  }, [open, plans])

  const usernameOk = username.trim().length >= 3
  const passwordOk = password.length >= CREATE_PWD_MIN
  const canSubmit = usernameOk && passwordOk && days >= 1

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    try {
      await post('/v1/admin/users', { username, password, planId: planId || null, days })
      toast.success(`已创建用户 ${username}`)
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建用户</DialogTitle>
          <DialogDescription>可选同时开通一个套餐会员。</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label>
              用户名
              <Req />
            </Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="登录账号" required />
            <p className="text-xs text-muted-foreground">该账号的登录名，至少 3 位，创建后不可修改。</p>
          </div>
          <div className="space-y-1.5">
            <Label>
              初始密码
              <Req />
            </Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`至少 ${CREATE_PWD_MIN} 位`}
              required
            />
            <p className="text-xs text-muted-foreground">
              至少 {CREATE_PWD_MIN} 位；创建后可在本页「修改密码」重置。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>套餐（可选）</Label>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger>
                  <SelectValue placeholder="不开通" />
                </SelectTrigger>
                <SelectContent>
                  {plans.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">选填，选择后同时开通该套餐会员。</p>
            </div>
            <div className="space-y-1.5">
              <Label>有效天数</Label>
              <Input
                type="number"
                min={1}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">会员有效期天数，仅在选择套餐时生效。</p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={busy || !canSubmit}>
              {busy ? '创建中…' : '创建并开通'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------- 发放会员 ----------
function GrantDialog({
  row,
  onOpenChange,
  plans,
  onDone,
}: {
  row: Row | null
  onOpenChange: (o: boolean) => void
  plans: Row[]
  onDone: () => void
}) {
  const [planId, setPlanId] = React.useState('')
  const [days, setDays] = React.useState(30)
  const [lifetime, setLifetime] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (row) {
      setPlanId(plans[0]?.id ?? '')
      setDays(30)
      setLifetime(false)
    }
  }, [row, plans])

  const canSubmit = !!planId && (lifetime || days >= 1)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!row || !canSubmit) return
    setBusy(true)
    try {
      await post(`/v1/admin/users/${row.id}/grant`, {
        planId,
        lifetime,
        durationDays: lifetime ? null : days,
      })
      toast.success(`已为 ${row.username} 发放会员`)
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
          <DialogTitle>发放会员{row ? ` · ${row.username}` : ''}</DialogTitle>
          <DialogDescription>
            套餐决定会员等级 / 设备数 / 权益；已有同级会员按剩余时长叠加，永久不会被降级。
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label>
              套餐（会员等级）
              <Req />
            </Label>
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
            <p className="text-xs text-muted-foreground">决定发放后的会员等级、设备数与权益。</p>
          </div>

          {/* 有效期：天数 / 永久 + 快捷预设 + 随输入变化的一句话实时说明 */}
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">有效期</Label>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setLifetime(false)
                    setDays(30)
                  }}
                >
                  30 天
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setLifetime(false)
                    setDays(90)
                  }}
                >
                  90 天
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setLifetime(false)
                    setDays(365)
                  }}
                >
                  365 天
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLifetime(true)}
                >
                  永久
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>有效天数</Label>
                <Input
                  type="number"
                  min={1}
                  disabled={lifetime}
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">自本次发放起的有效天数；勾选永久后忽略。</p>
              </div>
              <label className="flex items-center gap-2 self-start pt-8 text-sm">
                <Checkbox checked={lifetime} onCheckedChange={(v) => setLifetime(v === true)} />
                永久有效
              </label>
            </div>
            <p className="rounded bg-muted px-3 py-2 text-xs text-muted-foreground">
              {lifetime
                ? `将为 ${row?.username ?? '该用户'} 发放永久会员，永不过期。`
                : `将为 ${row?.username ?? '该用户'} 发放 ${days} 天会员；若已有同级会员，则在其剩余时长上叠加 ${days} 天。`}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={busy || !canSubmit}>
              {busy ? '发放中…' : '确认发放'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// 便于口头/文字转达的随机密码：去掉 0/O/1/l/I 等易混字符。
function randomPassword(length = 12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = new Uint32Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join('')
}

// ---------- 修改密码 ----------
function PasswordDialog({ row, onOpenChange }: { row: Row | null; onOpenChange: (o: boolean) => void }) {
  const [password, setPassword] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    if (row) setPassword('')
  }, [row])

  const passwordOk = password.length >= RESET_PWD_MIN

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!row) return
    if (!passwordOk) {
      toast.error(`密码至少需要 ${RESET_PWD_MIN} 位`)
      return
    }
    setBusy(true)
    try {
      await patch(`/v1/admin/users/${row.id}/password`, { password })
      toast.success(`已更新 ${row.username} 的密码，原会话已失效`)
      onOpenChange(false)
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
          <DialogTitle>修改密码{row ? ` · ${row.username}` : ''}</DialogTitle>
          <DialogDescription>保存后该用户的所有已登录设备将需要重新登录。</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label>
              新密码
              <Req />
            </Label>
            <div className="flex gap-2">
              <Input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={`至少 ${RESET_PWD_MIN} 位`}
                autoFocus
              />
              <Button type="button" variant="outline" onClick={() => setPassword(randomPassword())}>
                随机生成
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!password}
                onClick={() => {
                  navigator.clipboard?.writeText(password)
                  toast.success('密码已复制，可直接发给用户')
                }}
              >
                复制
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              至少 {RESET_PWD_MIN} 位；密码以明文显示，方便复制后发给用户。保存后该用户所有已登录设备需重新登录（客户端最多 5 分钟内被强制退出）。
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={busy || !passwordOk}>
              {busy ? '保存中…' : '保存密码'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------- 删除用户（二次确认）----------
function DeleteUserDialog({
  row,
  onOpenChange,
  onDone,
}: {
  row: Row | null
  onOpenChange: (o: boolean) => void
  onDone: () => void
}) {
  const [busy, setBusy] = React.useState(false)
  async function confirmDelete() {
    if (!row) return
    setBusy(true)
    try {
      await del(`/v1/admin/users/${row.id}`)
      toast.success(`已删除用户 ${row.username}`)
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
          <DialogTitle>删除用户</DialogTitle>
          <DialogDescription>
            确认删除 <span className="font-medium text-foreground">{row?.username}</span>？
            其授权、设备与会话将一并级联删除，此操作不可撤销。
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

// ---------- 用户详情 ----------
function UserDetailDialog({ id, onOpenChange }: { id: string | null; onOpenChange: (o: boolean) => void }) {
  const [data, setData] = React.useState<Row | null>(null)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    if (!id) {
      setData(null)
      setError('')
      return
    }
    setData(null)
    setError('')
    get<Row>(`/v1/admin/users/${id}`)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [id])

  const u = data?.user
  const stats = data?.stats ?? {}

  return (
    <Dialog open={!!id} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{u ? `用户档案 · ${u.username}` : '用户档案'}</DialogTitle>
          <DialogDescription>
            {u ? `${u.id} · 注册于 ${dt(u.createdAt)}` : '加载中…'}
          </DialogDescription>
        </DialogHeader>

        {error && <div className="text-sm text-destructive">{error}</div>}

        {data && u && (
          <div className="space-y-5 text-sm">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="累计实收" value={money(stats.paidAmountCents || 0)} />
              <Stat label="已支付订单" value={String(stats.paidOrders || 0)} />
              <Stat label="已绑设备" value={String(stats.activeDevices || 0)} />
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">账号状态</div>
                <div className="mt-1">
                  <UserStatus value={u.status} />
                </div>
              </div>
            </div>

            <Separator />

            <Section title={`会员授权（${(data.licenses ?? []).length}）`}>
              {(data.licenses ?? []).map((x: Row) => (
                <div key={x.id} className="flex items-center justify-between rounded-md border p-2.5">
                  <div>
                    <div className="font-medium">{x.planName}</div>
                    <div className="text-xs text-muted-foreground">
                      {x.planCode} · {x.maxDevices} 台 · {x.lifetime ? '永久有效' : dt(x.expiresAt)}
                    </div>
                  </div>
                  <LicenseStatus value={x.status} />
                </div>
              ))}
              {(data.licenses ?? []).length === 0 && <Empty />}
            </Section>

            <Section title={`设备绑定（${(data.devices ?? []).length}）`}>
              {(data.devices ?? []).map((x: Row) => (
                <div key={x.id} className="flex items-center justify-between rounded-md border p-2.5">
                  <div>
                    <div className="font-medium">{x.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {x.platform} · {x.appVersion} · 最近 {dt(x.lastSeenAt)}
                    </div>
                  </div>
                  <StatusBadge value={x.revoked ? '已解绑' : x.activeSessions ? '在线' : '离线'} />
                </div>
              ))}
              {(data.devices ?? []).length === 0 && <Empty />}
            </Section>

            <Section title={`订单记录（${(data.orders ?? []).length}）`}>
              {(data.orders ?? []).map((x: Row) => (
                <div key={x.orderNo} className="flex items-center justify-between rounded-md border p-2.5">
                  <div>
                    <div className="font-mono text-xs">{x.orderNo}</div>
                    <div className="text-xs text-muted-foreground">
                      {x.planName} · {dt(x.paidAt || x.createdAt)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">{money(x.amountCents)}</div>
                    <OrderStatus value={x.status} />
                  </div>
                </div>
              ))}
              {(data.orders ?? []).length === 0 && <Empty />}
            </Section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  )
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="font-medium">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}
function Empty() {
  return <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">暂无记录</div>
}
