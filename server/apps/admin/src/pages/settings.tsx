import * as React from 'react'
import {
  AlertTriangle,
  CreditCard,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Smartphone,
} from 'lucide-react'
import { get, patch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'

/** GET/PATCH /v1/admin/settings/commerce 返回结构（字段以后端 CommerceSettings 为准）。 */
type CommerceSettings = {
  registrationEnabled: boolean
  trialDays: number
  trialPlanCode: string
  maxAccountsPerDevice: number
  defaultDeviceLimit: number
  licenseLeaseMinutes: number
  offlineGraceHours: number
  activePaymentProvider: string
  paymentMethods: Array<'alipay'>
}

/** GET /v1/admin/payment-providers 单项（仅取展示需要的字段）。 */
type PaymentProvider = {
  code: string
  displayName: string
  enabled: boolean
}

const ENDPOINT = '/v1/admin/settings/commerce'

/** 计算与初始值相比发生变化的字段，只 PATCH 这些（数组按 JSON 比较）。 */
function diffSettings(
  base: CommerceSettings,
  next: CommerceSettings,
): Partial<CommerceSettings> {
  const out: Partial<CommerceSettings> = {}
  ;(Object.keys(next) as (keyof CommerceSettings)[]).forEach((key) => {
    const a = base[key]
    const b = next[key]
    const changed = Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a) !== JSON.stringify(b) : a !== b
    if (changed) (out as Record<string, unknown>)[key] = b
  })
  return out
}

export default function SettingsPage() {
  const [initial, setInitial] = React.useState<CommerceSettings | null>(null)
  const [form, setForm] = React.useState<CommerceSettings | null>(null)
  const [providers, setProviders] = React.useState<PaymentProvider[]>([])
  const [loadError, setLoadError] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(() => {
    setLoadError('')
    setForm(null)
    setInitial(null)
    get<CommerceSettings>(ENDPOINT)
      .then((row) => {
        setInitial(row)
        setForm(row)
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)))
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  // 支付通道用于「当前收款」下拉；拉取失败不影响其余表单。
  React.useEffect(() => {
    get<{ items: PaymentProvider[] }>('/v1/admin/payment-providers')
      .then((r) => setProviders(r.items ?? []))
      .catch(() => setProviders([]))
  }, [])

  // 类型安全的单字段更新。
  const setField = React.useCallback(
    <K extends keyof CommerceSettings>(key: K, value: CommerceSettings[K]) => {
      setForm((f) => (f ? { ...f, [key]: value } : f))
    },
    [],
  )

  const numHandler =
    (key: keyof CommerceSettings) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const n = Number(e.target.value)
      setField(key, (Number.isNaN(n) ? 0 : n) as CommerceSettings[typeof key])
    }

  const changes = React.useMemo(
    () => (initial && form ? diffSettings(initial, form) : {}),
    [initial, form],
  )
  const changedCount = Object.keys(changes).length
  const dirty = changedCount > 0

  // 当前收款下拉选项：始终包含已选值（即便不在 provider 列表内）。
  const providerOptions = React.useMemo(() => {
    const opts = providers.map((p) => ({
      value: p.code,
      label: `${p.displayName}（${p.code}）`,
      enabled: p.enabled,
    }))
    const cur = form?.activePaymentProvider
    if (cur && !opts.some((o) => o.value === cur)) {
      opts.unshift({ value: cur, label: `${cur}（当前）`, enabled: true })
    }
    return opts
  }, [providers, form?.activePaymentProvider])

  async function save() {
    if (!form || !initial) return
    const payload = diffSettings(initial, form)
    if (Object.keys(payload).length === 0) {
      toast.info('没有需要保存的更改')
      return
    }
    setSaving(true)
    try {
      const row = await patch<CommerceSettings>(ENDPOINT, payload)
      setInitial(row)
      setForm(row)
      toast.success('商业设置已保存')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function reset() {
    setForm(initial)
  }

  if (loadError) {
    return (
      <div className="max-w-3xl">
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>加载商业设置失败：{loadError}</span>
            </div>
            <Button variant="outline" onClick={load}>
              <RefreshCw className="h-4 w-4" />
              重新加载
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!form) return <SettingsSkeleton />

  // 当前所选通道是否处于停用状态（用于实时提示；未在列表内的注入项视为可用）。
  const activeProviderRow = providers.find((p) => p.code === form.activePaymentProvider)
  const activeProviderDisabled = !!form.activePaymentProvider && !!activeProviderRow && !activeProviderRow.enabled

  return (
    <div className="max-w-3xl space-y-6">
      {/* 注册与试用 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            注册与免费试用
          </CardTitle>
          <CardDescription>控制新用户能否自助注册，以及注册后发放的试用授权。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <SettingRow
            label="开放注册"
            hint="关闭后前台注册接口返回 REGISTRATION_DISABLED，仅管理员可创建账号。"
          >
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.registrationEnabled}
                onCheckedChange={(v) => setField('registrationEnabled', v === true)}
              />
              <Badge variant={form.registrationEnabled ? 'success' : 'secondary'}>
                {form.registrationEnabled ? '已开放' : '已关闭'}
              </Badge>
            </label>
          </SettingRow>

          <SettingRow
            label="试用天数"
            hint="新用户注册赠送的免费天数，0 表示不发放试用（范围 0–365）。"
            htmlFor="trialDays"
          >
            <Input
              id="trialDays"
              type="number"
              min={0}
              max={365}
              value={form.trialDays}
              onChange={numHandler('trialDays')}
            />
          </SettingRow>

          <SettingRow
            label="试用套餐 Code"
            hint="发放试用时使用的套餐 code，需与「套餐配置」中已启用的套餐一致。"
            htmlFor="trialPlanCode"
          >
            <Input
              id="trialPlanCode"
              value={form.trialPlanCode}
              onChange={(e) => setField('trialPlanCode', e.target.value)}
              placeholder="trial"
            />
          </SettingRow>
          <SettingRow
            label="每设备注册上限"
            hint="同一台设备最多可注册的账号数，防止刷试用；0 表示不限制（范围 0–100）。"
            htmlFor="maxAccountsPerDevice"
          >
            <Input
              id="maxAccountsPerDevice"
              type="number"
              min={0}
              max={100}
              value={form.maxAccountsPerDevice}
              onChange={numHandler('maxAccountsPerDevice')}
            />
          </SettingRow>
        </CardContent>
      </Card>

      {/* 授权与设备 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-muted-foreground" />
            授权与设备策略
          </CardTitle>
          <CardDescription>默认设备名额、授权租约时长与离线宽限期。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <SettingRow
            label="默认设备上限"
            hint="套餐未单独指定时，单个会员可同时绑定的设备数量（范围 1–100）。"
            htmlFor="defaultDeviceLimit"
          >
            <Input
              id="defaultDeviceLimit"
              type="number"
              min={1}
              max={100}
              value={form.defaultDeviceLimit}
              onChange={numHandler('defaultDeviceLimit')}
            />
          </SettingRow>

          <SettingRow
            label="授权租约（分钟）"
            hint="客户端每次续租授权的有效时长，到期需重新联网校验（范围 15–1440）。"
            htmlFor="licenseLeaseMinutes"
          >
            <Input
              id="licenseLeaseMinutes"
              type="number"
              min={15}
              max={1440}
              value={form.licenseLeaseMinutes}
              onChange={numHandler('licenseLeaseMinutes')}
            />
          </SettingRow>

          <SettingRow
            label="离线宽限（小时）"
            hint="断网后仍允许继续使用的最长时间，0 表示不允许离线（范围 0–72）。"
            htmlFor="offlineGraceHours"
          >
            <Input
              id="offlineGraceHours"
              type="number"
              min={0}
              max={72}
              value={form.offlineGraceHours}
              onChange={numHandler('offlineGraceHours')}
            />
          </SettingRow>
        </CardContent>
      </Card>

      {/* 支付 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-muted-foreground" />
            收款与支付方式
          </CardTitle>
          <CardDescription>选择当前生效的收款通道；通道密钥在「支付通道」页配置。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <SettingRow
            label="当前收款通道"
            required
            hint="下单时使用的支付 Provider。停用的通道虽可选择，但下单前需在「支付通道」页启用。"
          >
            <div className="space-y-1.5">
              <Select
                value={form.activePaymentProvider}
                onValueChange={(v) => setField('activePaymentProvider', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择收款通道" />
                </SelectTrigger>
                <SelectContent>
                  {providerOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      <span className="flex items-center gap-2">
                        {o.label}
                        {!o.enabled && <span className="text-xs text-muted-foreground">· 未启用</span>}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {activeProviderDisabled && (
                <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  该通道当前已停用，需先在「支付通道」页启用后才能接单。
                </p>
              )}
            </div>
          </SettingRow>

          <SettingRow label="支付方式" hint="前台可选的支付方式，目前仅支持支付宝。">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox checked disabled />
              支付宝
            </label>
          </SettingRow>
        </CardContent>
      </Card>

      {/* 保存栏 */}
      <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-5">
        {dirty && (
          <span className="mr-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            有 {changedCount} 项未保存的更改
          </span>
        )}
        <Button variant="outline" onClick={reset} disabled={!dirty || saving}>
          <RotateCcw className="h-4 w-4" />
          重置
        </Button>
        <Button onClick={save} disabled={!dirty || saving}>
          <Save className="h-4 w-4" />
          {saving ? '保存中…' : '保存更改'}
        </Button>
      </div>
    </div>
  )
}

/** 左标题 + 说明、右控件的一行设置项（全站表单 hint 范式）。 */
function SettingRow({
  label,
  hint,
  htmlFor,
  required,
  children,
}: {
  label: string
  hint?: string
  htmlFor?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-0.5 sm:pr-6">
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="text-destructive"> *</span>}
        </Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="w-full sm:w-[280px] sm:shrink-0">{children}</div>
    </div>
  )
}

function SettingsSkeleton() {
  return (
    <div className="max-w-3xl space-y-6">
      {Array.from({ length: 3 }).map((_, c) => (
        <Card key={c}>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-6">
            {Array.from({ length: 3 }).map((_, r) => (
              <div key={r} className="flex items-center justify-between gap-6">
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-9 w-[280px]" />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
