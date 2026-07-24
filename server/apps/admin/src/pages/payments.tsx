import * as React from 'react'
import {
  CheckCircle2,
  CreditCard,
  KeyRound,
  Pencil,
  Plus,
  ShieldCheck,
  Wallet,
} from 'lucide-react'
import { get, put, post } from '@/lib/api'
import { dt } from '@/lib/utils'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'

// ---- 后端返回结构（以 store.ts / providerUpsertSchema 为准） ----
type Adapter = 'zhongzhuan' | 'manual'

interface Provider {
  code: string
  displayName: string
  adapter: string
  endpoint: string
  merchantId: string
  credentialRef: string
  config: Record<string, string | number | boolean>
  enabled: boolean
  updatedAt?: string
}

interface Commerce {
  registrationEnabled: boolean
  trialDays: number
  trialPlanCode: string
  defaultDeviceLimit: number
  licenseLeaseMinutes: number
  offlineGraceHours: number
  activePaymentProvider: string
  paymentMethods: string[]
}

const adapterLabel = (a: string) =>
  a === 'zhongzhuan' ? '收钱吧中转' : a === 'manual' ? '手动确认' : a
const methodLabel = (m: string) => (m === 'alipay' ? '支付宝' : m)
const timeoutOf = (config: Provider['config']): number => {
  const t = Number(config?.orderTimeoutMinutes)
  return Number.isFinite(t) && t > 0 ? t : 10
}

export default function PaymentsPage() {
  const [providers, setProviders] = React.useState<Provider[]>([])
  const [commerce, setCommerce] = React.useState<Commerce | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState('')
  const [refresh, setRefresh] = React.useState(0)
  const bump = () => setRefresh((r) => r + 1)

  const [editProvider, setEditProvider] = React.useState<Provider | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [activateRow, setActivateRow] = React.useState<Provider | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    Promise.all([
      get<{ items: Provider[] }>('/v1/admin/payment-providers'),
      get<Commerce>('/v1/admin/settings/commerce'),
    ])
      .then(([p, c]) => {
        if (cancelled) return
        setProviders(p.items)
        setCommerce(c)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refresh])

  const activeCode = commerce?.activePaymentProvider ?? ''
  const activeProvider = providers.find((p) => p.code === activeCode) ?? null

  return (
    <div className="space-y-5">
      {/* 当前收款概览 */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-4 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">当前收款通道</div>
              <div className="font-semibold">
                {loading ? '加载中…' : activeProvider ? activeProvider.displayName : activeCode || '未设置'}
              </div>
            </div>
          </div>
          <Separator orientation="vertical" className="hidden h-10 sm:block" />
          <div>
            <div className="text-xs text-muted-foreground">支付方式</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(commerce?.paymentMethods ?? []).length === 0 ? (
                <span className="text-sm text-muted-foreground">—</span>
              ) : (
                commerce!.paymentMethods.map((m) => (
                  <Badge key={m} variant="secondary">
                    {methodLabel(m)}
                  </Badge>
                ))
              )}
            </div>
          </div>
          <Button className="ml-auto" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            新增通道
          </Button>
        </CardContent>
      </Card>

      {/* 安全提示：密钥只引用环境变量 */}
      <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          出于安全考虑，此处只保存<strong>凭据引用（环境变量前缀）</strong>，不保存任何明文密钥。真实的 APP_ID / APP_SECRET
          由服务器从 <code className="rounded bg-amber-500/15 px-1">{'{引用}_APP_ID'}</code>、
          <code className="rounded bg-amber-500/15 px-1">{'{引用}_APP_SECRET'}</code> 环境变量读取。
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {/* 通道卡片网格 */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={`sk-${i}`}>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-40" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>
          ))
        ) : !error && providers.length === 0 ? (
          <Card className="sm:col-span-2 xl:col-span-3">
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              暂无支付通道，点击「新增通道」创建。
            </CardContent>
          </Card>
        ) : (
          providers.map((p) => {
            const active = p.code === activeCode
            return (
              <Card key={p.code} className={active ? 'border-primary/60 ring-1 ring-primary/30' : undefined}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="flex items-center gap-2">
                      <CreditCard className="h-4 w-4 text-muted-foreground" />
                      {p.displayName}
                    </CardTitle>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <StatusBadge value={p.enabled ? '启用' : '停用'} />
                      {active && (
                        <Badge variant="default" className="gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          当前收款
                        </Badge>
                      )}
                    </div>
                  </div>
                  <CardDescription className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono">{p.code}</span>
                    <span>·</span>
                    <Badge variant="outline">{adapterLabel(p.adapter)}</Badge>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Field label="接口地址" value={p.endpoint || '—'} mono />
                  <Field label="商户号" value={p.merchantId || '—'} mono={!!p.merchantId} />
                  <Field
                    label="凭据引用"
                    value={
                      <span className="inline-flex items-center gap-1 font-mono">
                        <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                        {p.credentialRef}
                      </span>
                    }
                  />
                  <Field label="订单超时" value={`${timeoutOf(p.config)} 分钟`} />
                  <Field label="更新时间" value={dt(p.updatedAt)} muted />
                </CardContent>
                <CardFooter className="gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditProvider(p)}>
                    <Pencil className="h-4 w-4" />
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    className="ml-auto"
                    disabled={active || !p.enabled}
                    title={active ? '已是当前收款通道' : !p.enabled ? '请先启用该通道' : undefined}
                    onClick={() => setActivateRow(p)}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {active ? '收款中' : '设为当前收款'}
                  </Button>
                </CardFooter>
              </Card>
            )
          })
        )}
      </div>

      {/* 编辑 / 新增 */}
      <ProviderDialog
        open={!!editProvider}
        provider={editProvider}
        onOpenChange={(o) => !o && setEditProvider(null)}
        onDone={bump}
      />
      <ProviderDialog
        open={createOpen}
        provider={null}
        onOpenChange={setCreateOpen}
        onDone={bump}
      />

      {/* 切换当前收款（二次确认） */}
      <ActivateDialog
        provider={activateRow}
        onOpenChange={(o) => !o && setActivateRow(null)}
        onDone={bump}
      />
    </div>
  )
}

function Field({
  label,
  value,
  mono,
  muted,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
  muted?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={[
          'min-w-0 truncate text-right',
          mono ? 'font-mono text-xs' : '',
          muted ? 'text-muted-foreground' : 'text-foreground',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  )
}

// ---------- 编辑 / 新增支付通道（PUT upsert） ----------
function ProviderDialog({
  open,
  provider,
  onOpenChange,
  onDone,
}: {
  open: boolean
  provider: Provider | null
  onOpenChange: (o: boolean) => void
  onDone: () => void
}) {
  const isEdit = !!provider
  const [code, setCode] = React.useState('')
  const [displayName, setDisplayName] = React.useState('')
  const [adapter, setAdapter] = React.useState<Adapter>('zhongzhuan')
  const [endpoint, setEndpoint] = React.useState('')
  const [merchantId, setMerchantId] = React.useState('')
  const [credentialRef, setCredentialRef] = React.useState('')
  const [timeoutMin, setTimeoutMin] = React.useState(10)
  const [enabled, setEnabled] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const baseConfig = React.useRef<Record<string, string | number | boolean>>({})

  React.useEffect(() => {
    if (!open) return
    if (provider) {
      setCode(provider.code)
      setDisplayName(provider.displayName)
      setAdapter(provider.adapter === 'manual' ? 'manual' : 'zhongzhuan')
      setEndpoint(provider.endpoint)
      setMerchantId(provider.merchantId)
      setCredentialRef(provider.credentialRef)
      setTimeoutMin(timeoutOf(provider.config))
      setEnabled(provider.enabled)
      baseConfig.current = provider.config ?? {}
    } else {
      setCode('')
      setDisplayName('')
      setAdapter('zhongzhuan')
      setEndpoint('')
      setMerchantId('')
      setCredentialRef('')
      setTimeoutMin(10)
      setEnabled(false)
      baseConfig.current = {}
    }
  }, [open, provider])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    // 轻量客户端校验（后端 providerUpsertSchema 会再次校验并返回 message）
    if (!isEdit && !/^[a-z0-9][a-z0-9-]{1,62}$/.test(code)) {
      toast.error('通道代码只能包含小写字母、数字与连字符，长度 2-63')
      return
    }
    if (!/^[A-Z][A-Z0-9_]{2,80}$/.test(credentialRef)) {
      toast.error('凭据引用需为大写字母开头的大写标识符（如 PAYMENT_ZHONGZHUAN）')
      return
    }
    setBusy(true)
    try {
      const config = { ...baseConfig.current, orderTimeoutMinutes: timeoutMin }
      await put(`/v1/admin/payment-providers/${encodeURIComponent(code)}`, {
        displayName,
        adapter,
        endpoint,
        merchantId,
        credentialRef,
        config,
        enabled,
      })
      toast.success(isEdit ? `已保存通道 ${displayName}` : `已创建通道 ${displayName}`)
      onOpenChange(false)
      onDone()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const refPreview = credentialRef || '引用'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `编辑支付通道 · ${provider?.displayName}` : '新增支付通道'}</DialogTitle>
          <DialogDescription>
            密钥只引用环境变量：此表单不保存明文密钥，仅记录凭据引用前缀。
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>通道代码</Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="zhongzhuan-prod"
                disabled={isEdit}
                required
              />
              {isEdit && <p className="text-xs text-muted-foreground">代码创建后不可修改</p>}
            </div>
            <div className="space-y-1.5">
              <Label>显示名称</Label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="生产收款（收钱吧）"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>适配器</Label>
              <Select value={adapter} onValueChange={(v) => setAdapter(v as Adapter)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="zhongzhuan">收钱吧中转</SelectItem>
                  <SelectItem value="manual">手动确认</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>订单超时（分钟）</Label>
              <Input
                type="number"
                min={5}
                max={60}
                value={timeoutMin}
                onChange={(e) => setTimeoutMin(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>接口地址</Label>
            <Input
              type="url"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://zf.example.com（手动确认可留空）"
            />
          </div>

          <div className="space-y-1.5">
            <Label>商户号（可选）</Label>
            <Input
              value={merchantId}
              onChange={(e) => setMerchantId(e.target.value)}
              placeholder="留空则不使用"
            />
          </div>

          <div className="space-y-1.5">
            <Label>凭据引用（环境变量前缀）</Label>
            <Input
              value={credentialRef}
              onChange={(e) => setCredentialRef(e.target.value.toUpperCase())}
              placeholder="PAYMENT_ZHONGZHUAN"
              className="font-mono"
              required
            />
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
              <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                服务器将从环境变量 <code className="font-mono">{refPreview}_APP_ID</code> 与{' '}
                <code className="font-mono">{refPreview}_APP_SECRET</code> 读取真实密钥；
                此处<strong>不会</strong>保存任何明文密钥。
              </span>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
            启用该通道（仅启用的通道可被设为当前收款）
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? '保存中…' : isEdit ? '保存' : '创建通道'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------- 切换当前收款（二次确认，POST activate） ----------
function ActivateDialog({
  provider,
  onOpenChange,
  onDone,
}: {
  provider: Provider | null
  onOpenChange: (o: boolean) => void
  onDone: () => void
}) {
  const [busy, setBusy] = React.useState(false)
  async function confirm() {
    if (!provider) return
    setBusy(true)
    try {
      await post(`/v1/admin/payment-providers/${encodeURIComponent(provider.code)}/activate`)
      toast.success(`已切换当前收款为 ${provider.displayName}`)
      onOpenChange(false)
      onDone()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={!!provider} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>切换当前收款通道</DialogTitle>
          <DialogDescription>
            确认将全站收款切换到{' '}
            <span className="font-medium text-foreground">{provider?.displayName}</span>
            （<span className="font-mono">{provider?.code}</span>）？切换后新创建的订单将由该通道处理。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={busy} onClick={confirm}>
            {busy ? '切换中…' : '确认切换'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
