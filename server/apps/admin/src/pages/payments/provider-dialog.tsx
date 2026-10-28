// 新增 / 编辑支付通道：PUT /v1/admin/payment-providers/:code。真实密钥只在服务器环境变量里，这里只存引用名。
import * as React from 'react'
import { Choice, FormDialog, FormField, FormSection, Input, NumberInput, Switch, useNotify } from '@ankotti/admin-ui'
import { put } from '@/lib/api'

export type Provider = {
  code: string; displayName: string; adapter: string; endpoint: string; merchantId: string; credentialRef: string
  config: Record<string, unknown> & { orderTimeoutMinutes?: number }; enabled: boolean; updatedAt: string
}

export const ADAPTERS = [{ value: 'zhongzhuan', label: '收钱吧中转' }, { value: 'manual', label: '手动确认' }]
export const adapterLabel = (a: string) => ADAPTERS.find((x) => x.value === a)?.label ?? a
const CODE_RE = /^[a-z0-9][a-z0-9-]{1,62}$/
const REF_RE = /^[A-Z][A-Z0-9_]{2,80}$/

type Draft = { code: string; displayName: string; adapter: string; endpoint: string; merchantId: string; credentialRef: string; timeout: number | null; enabled: boolean }
const toDraft = (p: Provider | null): Draft => ({
  code: p?.code ?? '', displayName: p?.displayName ?? '', adapter: p?.adapter ?? 'zhongzhuan', endpoint: p?.endpoint ?? '',
  merchantId: p?.merchantId ?? '', credentialRef: p?.credentialRef ?? '', timeout: Number(p?.config?.orderTimeoutMinutes ?? 10), enabled: p?.enabled ?? true,
})

function validate(d: Draft, isNew: boolean): string | null {
  if (isNew && !CODE_RE.test(d.code)) return '编码只能用小写字母、数字和 -，2–63 位，且以字母或数字开头'
  if (!d.displayName.trim()) return '请填写显示名称'
  if (d.endpoint && !/^https?:\/\/\S+$/.test(d.endpoint.trim())) return '接口地址要以 http:// 或 https:// 开头'
  if (d.credentialRef && !REF_RE.test(d.credentialRef)) return '凭据引用只能用大写字母、数字和下划线，以字母开头，3–81 位'
  if (d.timeout === null || d.timeout < 5 || d.timeout > 60) return '订单超时要在 5–60 分钟之间'
  return null
}

export function ProviderDialog({ provider, onClose, onSaved }: { provider: Provider | 'new'; onClose: () => void; onSaved: () => void }) {
  const notify = useNotify()
  const base = provider === 'new' ? null : provider
  const [d, setD] = React.useState<Draft>(() => toDraft(base))
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }))
  const ref = d.credentialRef || '{ref}'
  return (
    <FormDialog
      open
      title={base ? `编辑通道「${base.displayName}」` : '新增支付通道'}
      description={`真实密钥从服务器环境变量 ${ref}_APP_ID / ${ref}_APP_SECRET 读取，这里不保存明文。`}
      dirty={JSON.stringify(d) !== JSON.stringify(toDraft(base))}
      submitLabel="保存"
      onClose={onClose}
      onSubmit={async () => {
        const err = validate(d, !base)
        if (err) throw new Error(err)
        await put(`/v1/admin/payment-providers/${encodeURIComponent(base?.code ?? d.code)}`, {
          displayName: d.displayName.trim(), adapter: d.adapter, endpoint: d.endpoint.trim(), merchantId: d.merchantId.trim(),
          credentialRef: d.credentialRef, config: { ...(base?.config ?? {}), orderTimeoutMinutes: d.timeout }, enabled: d.enabled,
        })
        notify('支付通道已保存', 'success')
        onSaved()
      }}
    >
      <FormSection>
        <FormField label="通道编码" htmlFor="pv-code" required={!base} hint={base ? '编码创建后不能改' : '小写字母、数字、-'}>
          <Input id="pv-code" value={d.code} disabled={!!base} onChange={(e) => set({ code: e.target.value.trim() })} placeholder="例如 sqb-main" />
        </FormField>
        <FormField label="显示名称" htmlFor="pv-name" required>
          <Input id="pv-name" value={d.displayName} onChange={(e) => set({ displayName: e.target.value })} />
        </FormField>
        <FormField label="适配器" htmlFor="pv-adapter">
          <Choice id="pv-adapter" label="适配器" value={d.adapter} onChange={(v) => set({ adapter: v })} options={ADAPTERS} />
        </FormField>
        <FormField label="订单超时" htmlFor="pv-timeout" hint="5–60 分钟">
          <NumberInput id="pv-timeout" value={d.timeout} onChange={(v) => set({ timeout: v })} min={5} max={60} unit="分钟" />
        </FormField>
        <FormField label="接口地址" htmlFor="pv-endpoint" optional full>
          <Input id="pv-endpoint" type="url" value={d.endpoint} onChange={(e) => set({ endpoint: e.target.value })} placeholder="https://" />
        </FormField>
        <FormField label="商户号" htmlFor="pv-merchant" optional>
          <Input id="pv-merchant" value={d.merchantId} onChange={(e) => set({ merchantId: e.target.value })} />
        </FormField>
        <FormField label="凭据引用" htmlFor="pv-ref" optional hint="环境变量前缀，大写">
          <Input id="pv-ref" value={d.credentialRef} onChange={(e) => set({ credentialRef: e.target.value.toUpperCase() })} placeholder="SQB_MAIN" />
        </FormField>
        <FormField label="启用" htmlFor="pv-enabled">
          <Switch id="pv-enabled" checked={d.enabled} onCheckedChange={(v) => set({ enabled: v })} />
        </FormField>
      </FormSection>
    </FormDialog>
  )
}
