// 新建 / 编辑套餐：新建 POST /v1/admin/plans（带 code），编辑 PATCH /v1/admin/plans/:id（code 不可改）。
import * as React from 'react'
import { Choice, FormDialog, FormField, FormSection, Input, NumberInput, Switch, Textarea, useNotify } from '@ankotti/admin-ui'
import { patch, post } from '@/lib/api'
import { CYCLE, centsToYuan, money, options, yuanToCents } from '@/lib/format'

export type Plan = {
  id: string; code: string; name: string; description: string; tier: string; billingCycle: string; durationDays: number | null
  lifetime: boolean; priceCents: number; originalPriceCents: number | null; currency: string; maxDevices: number; features: string[]
  active: boolean; public: boolean; sortOrder: number; badge: string; saleStartsAt?: string | null; saleEndsAt?: string | null
  purchaseLimitPerUser?: number | null; createdAt: string; updatedAt: string
}

export const PLAN_TIERS = [{ value: 'trial', label: '试用' }, { value: 'standard', label: '普通会员' }, { value: 'premium', label: '超级会员' }]
const CODE_RE = /^[a-z0-9][a-z0-9-]{1,62}$/

type Draft = {
  code: string; name: string; description: string; tier: string; billingCycle: string; days: number | null; price: string; original: string
  maxDevices: number | null; features: string; active: boolean; public: boolean; sortOrder: number | null; badge: string
}
const toDraft = (p: Plan | null): Draft => ({
  code: p?.code ?? '', name: p?.name ?? '', description: p?.description ?? '', tier: p?.tier ?? 'standard', billingCycle: p?.billingCycle ?? 'month',
  days: p?.durationDays ?? 30, price: p ? centsToYuan(p.priceCents) : '', original: centsToYuan(p?.originalPriceCents ?? null),
  maxDevices: p?.maxDevices ?? 3, features: (p?.features ?? []).join('\n'), active: p?.active ?? false, public: p?.public ?? true,
  sortOrder: p?.sortOrder ?? 100, badge: p?.badge ?? '',
})
export const splitFeatures = (s: string) => [...new Set(s.split(/[\n,，]/).map((x) => x.trim()).filter(Boolean))]

function payload(d: Draft, isNew: boolean) {
  const lifetime = d.billingCycle === 'lifetime'
  const price = yuanToCents(d.price)
  const original = d.original.trim() ? yuanToCents(d.original) : null
  const features = splitFeatures(d.features)
  if (isNew && !CODE_RE.test(d.code)) throw new Error('编码只能用小写字母、数字和 -，2–63 位')
  if (!d.name.trim()) throw new Error('请填写套餐名称')
  if (price === null || price < 0) throw new Error('价格要是不小于 0 的金额，最多两位小数')
  if (d.original.trim() && (original === null || original < 0)) throw new Error('原价格式不对，留空表示没有划线价')
  if (!lifetime && (d.days === null || d.days < 1 || d.days > 36500)) throw new Error('有效天数要在 1–36500 之间')
  if (d.maxDevices === null || d.maxDevices < 1 || d.maxDevices > 100) throw new Error('设备数要在 1–100 之间')
  if (d.sortOrder === null || d.sortOrder < 0 || d.sortOrder > 10000) throw new Error('排序要在 0–10000 之间')
  if (d.badge.length > 30) throw new Error('角标最多 30 个字')
  if (features.length > 50) throw new Error('权益最多 50 项')
  if (d.description.length > 500) throw new Error('描述最多 500 个字')
  return {
    name: d.name.trim(), description: d.description, tier: d.tier, billingCycle: d.billingCycle, durationDays: lifetime ? null : d.days,
    lifetime, priceCents: price, originalPriceCents: original, currency: 'CNY', maxDevices: d.maxDevices, features,
    active: d.active, public: d.public, sortOrder: d.sortOrder, badge: d.badge.trim(),
  }
}

export function PlanDialog({ plan, onClose, onSaved }: { plan: Plan | 'new'; onClose: () => void; onSaved: () => void }) {
  const notify = useNotify()
  const base = plan === 'new' ? null : plan
  const [d, setD] = React.useState<Draft>(() => toDraft(base))
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }))
  const lifetime = d.billingCycle === 'lifetime'
  const cents = yuanToCents(d.price)
  const preview = `${cents === null ? '—' : money(cents)} · ${lifetime ? '永久' : `${d.days ?? '—'} 天`} · ${d.maxDevices ?? '—'} 台设备（另加免费名额）`
  return (
    <FormDialog
      open size="lg"
      title={base ? `编辑套餐「${base.name}」` : '新建套餐'}
      description={`预览：${preview}`}
      dirty={JSON.stringify(d) !== JSON.stringify(toDraft(base))}
      submitLabel="保存"
      onClose={onClose}
      onSubmit={async () => {
        const body = payload(d, !base)
        if (base) await patch(`/v1/admin/plans/${base.id}`, body)
        else await post('/v1/admin/plans', { code: d.code, ...body })
        notify('套餐已保存', 'success')
        onSaved()
      }}
    >
      <FormSection>
        <FormField label="编码" htmlFor="pl-code" required={!base} hint={base ? '编码创建后不能改' : '小写字母、数字、-'}>
          <Input id="pl-code" value={d.code} disabled={!!base} onChange={(e) => set({ code: e.target.value.trim() })} />
        </FormField>
        <FormField label="名称" htmlFor="pl-name" required>
          <Input id="pl-name" value={d.name} onChange={(e) => set({ name: e.target.value })} />
        </FormField>
        <FormField label="等级" htmlFor="pl-tier">
          <Choice id="pl-tier" label="等级" value={d.tier} onChange={(v) => set({ tier: v })} options={PLAN_TIERS} />
        </FormField>
        <FormField label="周期" htmlFor="pl-cycle">
          <Choice id="pl-cycle" label="周期" value={d.billingCycle} onChange={(v) => set({ billingCycle: v })} options={options(CYCLE)} />
        </FormField>
        <FormField label="价格" htmlFor="pl-price" required hint="单位元">
          <Input id="pl-price" inputMode="decimal" value={d.price} onChange={(e) => set({ price: e.target.value })} suffix="元" />
        </FormField>
        <FormField label="原价（划线价）" htmlFor="pl-orig" optional>
          <Input id="pl-orig" inputMode="decimal" value={d.original} onChange={(e) => set({ original: e.target.value })} suffix="元" />
        </FormField>
        <FormField label="有效天数" htmlFor="pl-days" required={!lifetime} hint={lifetime ? '永久套餐不需要天数' : '1–36500'}>
          <NumberInput id="pl-days" value={lifetime ? null : d.days} disabled={lifetime} onChange={(v) => set({ days: v })} min={1} max={36500} unit="天" />
        </FormField>
        <FormField label="设备数" htmlFor="pl-dev" hint="1–100，叠加在免费名额之上">
          <NumberInput id="pl-dev" value={d.maxDevices} onChange={(v) => set({ maxDevices: v })} min={1} max={100} unit="台" />
        </FormField>
        <FormField label="排序" htmlFor="pl-sort" hint="0–10000，小的在前">
          <NumberInput id="pl-sort" value={d.sortOrder} onChange={(v) => set({ sortOrder: v })} min={0} max={10000} />
        </FormField>
        <FormField label="角标" htmlFor="pl-badge" optional count={{ value: d.badge.length, max: 30 }}>
          <Input id="pl-badge" value={d.badge} maxLength={30} onChange={(e) => set({ badge: e.target.value })} placeholder="例如：推荐" />
        </FormField>
        <FormField label="上架" htmlFor="pl-active">
          <Switch id="pl-active" checked={d.active} onCheckedChange={(v) => set({ active: v })} />
        </FormField>
        <FormField label="公开（出现在购买页）" htmlFor="pl-public">
          <Switch id="pl-public" checked={d.public} onCheckedChange={(v) => set({ public: v })} />
        </FormField>
        <FormField label="权益" htmlFor="pl-feat" optional full hint={`按换行或逗号分开，最多 50 项（当前 ${splitFeatures(d.features).length} 项）`}>
          <Textarea id="pl-feat" value={d.features} onChange={(e) => set({ features: e.target.value })} />
        </FormField>
        <FormField label="描述" htmlFor="pl-desc" optional full count={{ value: d.description.length, max: 500 }}>
          <Textarea id="pl-desc" value={d.description} maxLength={500} onChange={(e) => set({ description: e.target.value })} />
        </FormField>
      </FormSection>
    </FormDialog>
  )
}
