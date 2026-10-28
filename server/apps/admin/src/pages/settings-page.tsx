// 商业设置（T08 设置 / 表单页）：左侧分节 + 吸底保存条，只 PATCH 改动过的字段。
import * as React from 'react'
import { CreditCard, Laptop, UserPlus } from 'lucide-react'
import {
  Checkbox, Choice, FormField, FormSection, InlineAlert, Input, NumberInput, PageHeader, Panel, SaveBar, SideNavLayout,
  StatePanel, errorText, useNotify,
} from '@ankotti/admin-ui'
import { get, patch } from '@/lib/api'
import type { PageProps } from '@/shell/workspace-context'

type Commerce = {
  registrationEnabled: boolean; trialDays: number; trialPlanCode: string; maxAccountsPerDevice: number; maxAccountsPerIp: number
  defaultDeviceLimit: number; licenseLeaseMinutes: number; offlineGraceHours: number; activePaymentProvider: string; paymentMethods: string[]
}
type Provider = { code: string; displayName: string; enabled: boolean }
type NumKey = 'trialDays' | 'maxAccountsPerDevice' | 'maxAccountsPerIp' | 'defaultDeviceLimit' | 'licenseLeaseMinutes' | 'offlineGraceHours'

const LABELS: Record<keyof Commerce, string> = {
  registrationEnabled: '开放注册', trialDays: '试用天数', trialPlanCode: '试用套餐编码', maxAccountsPerDevice: '每台设备最多注册账号',
  maxAccountsPerIp: '每个 IP 最多注册账号', defaultDeviceLimit: '免费设备数（会员在此基础上叠加套餐设备数）',
  licenseLeaseMinutes: '授权租约时长', offlineGraceHours: '离线宽限', activePaymentProvider: '当前收款通道', paymentMethods: '支付方式',
}
const RANGES: Record<NumKey, [number, number, string, string]> = {
  trialDays: [0, 365, '天', '0 = 不送试用'],
  maxAccountsPerDevice: [0, 100, '个', '0 = 不限'],
  maxAccountsPerIp: [0, 100, '个', '0 = 不限'],
  defaultDeviceLimit: [1, 100, '台', '免费用户能同时绑定的设备数；会员 = 这个数 + 套餐设备数'],
  licenseLeaseMinutes: [15, 1440, '分钟', '客户端多久续一次租约，15–1440'],
  offlineGraceHours: [0, 72, '小时', '断网后还能用多久，0–72'],
}

export function changedKeys(a: Commerce, b: Commerce): (keyof Commerce)[] {
  return (Object.keys(LABELS) as (keyof Commerce)[]).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
}

function useSettings() {
  const [saved, setSaved] = React.useState<Commerce | null>(null)
  const [providers, setProviders] = React.useState<Provider[]>([])
  const [error, setError] = React.useState<string | undefined>()
  const load = React.useCallback(async () => {
    setError(undefined)
    try {
      const [c, p] = await Promise.all([get<Commerce>('/v1/admin/settings/commerce'), get<{ items: Provider[] }>('/v1/admin/payment-providers')])
      setSaved(c); setProviders(p.items)
    } catch (e) { setError(errorText(e, '设置加载失败')) }
  }, [])
  React.useEffect(() => { void load() }, [load])
  return { saved, setSaved, providers, error, load }
}

export function SettingsPage(_: PageProps) {
  const notify = useNotify()
  const { saved, setSaved, providers, error, load } = useSettings()
  const [draft, setDraft] = React.useState<Commerce | null>(null)
  React.useEffect(() => { setDraft(saved) }, [saved])
  if (error) return <StatePanel kind="error" title="设置加载失败" message={error} onRetry={() => void load()} />
  if (!saved || !draft) return <StatePanel kind="loading" title="正在加载设置" />

  const changed = changedKeys(saved, draft)
  const set = (p: Partial<Commerce>) => setDraft((d) => (d ? { ...d, ...p } : d))
  const num = (k: NumKey) => {
    const [min, max, unit, hint] = RANGES[k]
    return (
      <FormField label={LABELS[k]} htmlFor={`st-${k}`} hint={hint} changed={changed.includes(k)}>
        <NumberInput id={`st-${k}`} value={draft[k]} min={min} max={max} unit={unit} clamp onChange={(v) => set({ [k]: v ?? min })} />
      </FormField>
    )
  }
  const providerOptions = [...providers.map((p) => ({ value: p.code, label: p.enabled ? p.displayName : `${p.displayName}（已停用）` })),
    ...(providers.some((p) => p.code === draft.activePaymentProvider) || !draft.activePaymentProvider ? [] : [{ value: draft.activePaymentProvider, label: draft.activePaymentProvider }])]
  const selected = providers.find((p) => p.code === draft.activePaymentProvider)
  const sectionDirty = (keys: (keyof Commerce)[]) => keys.some((k) => changed.includes(k))

  return (
    <>
      <PageHeader title="商业设置" description="注册、免费档设备数、授权租约与收款通道。改完在底部统一保存。" />
      <SideNavLayout
        label="设置分节"
        sections={[
          { id: 'signup', label: '注册与试用', icon: <UserPlus />, dirty: sectionDirty(['registrationEnabled', 'trialDays', 'trialPlanCode', 'maxAccountsPerDevice', 'maxAccountsPerIp']), content: (
            <Panel title="注册与试用"><FormSection>
              <FormField label={LABELS.registrationEnabled} htmlFor="st-reg" changed={changed.includes('registrationEnabled')} hint="关掉后新用户不能注册">
                <Checkbox id="st-reg" checked={draft.registrationEnabled} onCheckedChange={(v) => set({ registrationEnabled: v === true })} />
              </FormField>
              {num('trialDays')}
              <FormField label={LABELS.trialPlanCode} htmlFor="st-trialplan" changed={changed.includes('trialPlanCode')}>
                <Input id="st-trialplan" value={draft.trialPlanCode} placeholder="trial" onChange={(e) => set({ trialPlanCode: e.target.value.trim() })} />
              </FormField>
              {num('maxAccountsPerDevice')}
              {num('maxAccountsPerIp')}
            </FormSection></Panel>) },
          { id: 'devices', label: '设备与授权', icon: <Laptop />, dirty: sectionDirty(['defaultDeviceLimit', 'licenseLeaseMinutes', 'offlineGraceHours']), content: (
            <Panel title="设备与授权"><FormSection>
              {num('defaultDeviceLimit')}
              {num('licenseLeaseMinutes')}
              {num('offlineGraceHours')}
            </FormSection></Panel>) },
          { id: 'payment', label: '收款', icon: <CreditCard />, dirty: sectionDirty(['activePaymentProvider']), error: !draft.activePaymentProvider, content: (
            <Panel title="收款"><FormSection>
              <FormField label={LABELS.activePaymentProvider} htmlFor="st-provider" required changed={changed.includes('activePaymentProvider')}>
                <Choice id="st-provider" label="当前收款通道" value={draft.activePaymentProvider} onChange={(v) => set({ activePaymentProvider: v })} options={providerOptions} />
              </FormField>
              <FormField label={LABELS.paymentMethods} htmlFor="st-alipay" hint="目前只支持支付宝，不能修改">
                <Checkbox id="st-alipay" checked disabled />
              </FormField>
            </FormSection>
            {selected && !selected.enabled ? <InlineAlert tone="warning" title="这个通道已停用">保存后用户将无法下单，请先到「支付通道」启用它。</InlineAlert> : null}
            </Panel>) },
        ]}
        footer={<SaveBar count={changed.length} summary={changed.map((k) => LABELS[k]).join('、')}
          onDiscard={() => setDraft(saved)}
          onSave={async () => {
            if (!draft.activePaymentProvider) { notify('请选择当前收款通道', 'error'); return }
            try {
              const body = Object.fromEntries(changed.map((k) => [k, draft[k]]))
              const next = await patch<Commerce>('/v1/admin/settings/commerce', body)
              setSaved(next)
              notify('设置已保存', 'success')
            } catch (e) { notify(errorText(e, '保存失败'), 'error') }
          }} />}
      />
    </>
  )
}
