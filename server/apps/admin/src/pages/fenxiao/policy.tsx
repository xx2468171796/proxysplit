// 分佣规则（T08 设置 / 表单，分销页分区）：整页一份草稿 + 吸底 SaveBar，PUT 整个 Policy。
import * as React from 'react'
import { Choice, FormField, FormSection, Input, NumberInput, Panel, SaveBar, Switch, useNotify } from '@ankotti/admin-ui'
import { put } from '@/lib/api'
import { PlanRulesEditor, TiersEditor, type TierDraft } from './plan-rules'
import { parseRates, ratesInput, type Policy } from './shared'

type Draft = { p: Policy; tiers: TierDraft[]; defaults: string }
const toDraft = (p: Policy): Draft => ({ p, tiers: p.tiers.map((t) => ({ code: t.code, name: t.name, rates: ratesInput(t.rates) })), defaults: ratesInput(p.defaultRates) })

const LABELS: Partial<Record<keyof Policy | 'tiers' | 'defaults', string>> = {
  enabled: '开启分佣', mode: '算法', maxLevels: '最多返几级', tiers: '分销身份', openToAll: '人人可推广', defaults: '普通用户比例',
  totalCapBps: '合计上限', freezeDays: '冻结天数', minBaseCents: '最低付款金额', planRules: '按套餐', recurringMaxOrders: '复购单数',
  recurringWithinDays: '复购天数', holdAboveCents: '大额待复核', minWithdrawalCents: '最低提现', withdrawalFeeBps: '提现费率', withdrawalFeeFixedCents: '每笔手续费',
}

function changes(a: Draft, b: Draft): string[] {
  const out: string[] = []
  for (const k of Object.keys(b.p) as (keyof Policy)[]) {
    if (k === 'tiers' || k === 'defaultRates') continue
    if (JSON.stringify(a.p[k]) !== JSON.stringify(b.p[k])) out.push(LABELS[k] ?? k)
  }
  if (JSON.stringify(a.tiers) !== JSON.stringify(b.tiers)) out.push('分销身份')
  if (a.defaults !== b.defaults) out.push('普通用户比例')
  return out
}

/** 元 ↔ 分的数字框。 */
const yuan = (cents: number) => cents / 100
const cents = (v: number | null, min = 0) => Math.max(min, Math.round((v ?? 0) * 100))

export function PolicyTab({ policy, onSaved }: { policy: Policy; onSaved: (p: Policy) => void }) {
  const notify = useNotify()
  const [saved, setSaved] = React.useState(() => toDraft(policy))
  const [d, setD] = React.useState(saved)
  const set = <K extends keyof Policy>(k: K, v: Policy[K]) => setD((x) => ({ ...x, p: { ...x.p, [k]: v } }))
  const changed = changes(saved, d)
  const diff = d.p.mode === 'differential'

  async function save() {
    const defaultRates = parseRates(d.defaults)
    const tiers = d.tiers.map((t) => ({ code: t.code.trim(), name: t.name.trim(), rates: parseRates(t.rates) }))
    if (!defaultRates || tiers.some((t) => !t.rates || !t.code || !t.name)) {
      notify('比例填百分数、逗号分隔（如 20, 5）；每个身份都要有代码和名称', 'error')
      return
    }
    const next = await put<Policy>('/v1/admin/fenxiao/policy', { ...d.p, defaultRates, tiers })
    const nd = toDraft(next)
    setSaved(nd)
    setD(nd)
    notify(next.enabled ? '已保存，分佣已开启' : '已保存（分佣未开启）', 'success')
    onSaved(next)
  }

  return (
    <>
      <Panel title="分佣规则" description="改动只影响以后的付款，已经产生的佣金不变。">
        <FormSection>
          <FormField label="开启分佣" htmlFor="fx-enabled" hint="关着时只记录谁推荐了谁，不产生佣金" changed={changed.includes('开启分佣')}>
            <Switch id="fx-enabled" checked={d.p.enabled} onCheckedChange={(v) => set('enabled', v)} />
          </FormField>
          <FormField label="算法" htmlFor="fx-mode" changed={changed.includes('算法')}
            hint={diff ? '级差：上级拿「自己的比例 − 下面已经分走的」，经销商体系常用' : '逐级：每一级上级按自己身份的第 N 级比例拿'}>
            <Choice id="fx-mode" label="算法" value={d.p.mode} onChange={(v) => set('mode', v === 'differential' ? 'differential' : 'level')}
              options={[{ value: 'level', label: '逐级比例（一级 x%，二级 y%）' }, { value: 'differential', label: '级差（按身份总比例补差）' }]} />
          </FormField>
          <FormField label="最多返几级" htmlFor="fx-levels" hint="1 = 只给直接推荐人；最多 3 级（三级以上有传销风险）" changed={changed.includes('最多返几级')}>
            <NumberInput id="fx-levels" min={1} max={3} clamp value={d.p.maxLevels} onChange={(v) => set('maxLevels', Math.min(3, Math.max(1, Math.floor(v ?? 1))))} />
          </FormField>
          <FormField label="一笔合计上限" htmlFor="fx-cap" hint="一笔付款所有上级加起来最多拿这么多，超出从远端砍" changed={changed.includes('合计上限')}>
            <NumberInput id="fx-cap" min={0} max={100} unit="%" clamp value={d.p.totalCapBps / 100} onChange={(v) => set('totalCapBps', Math.round(Math.min(100, Math.max(0, v ?? 0)) * 100))} />
          </FormField>
          <FormField label="分销身份" htmlFor="fx-tiers" full changed={changed.includes('分销身份')}
            hint={diff ? '每个身份填一个总比例（%）' : '每个身份填逐级比例（%），逗号分隔：一级, 二级, …'}>
            <TiersEditor value={d.tiers} differential={diff} onChange={(tiers) => setD((x) => ({ ...x, tiers }))} />
          </FormField>
          <FormField label="人人可推广" htmlFor="fx-open" hint="关着时只有后台设了身份的人有邀请码；开了普通用户也能拿佣金" changed={changed.includes('人人可推广')}>
            <Switch id="fx-open" checked={d.p.openToAll} onCheckedChange={(v) => set('openToAll', v)} />
          </FormField>
          {d.p.openToAll && (
            <FormField label="普通用户比例（%）" htmlFor="fx-defaults" changed={changed.includes('普通用户比例')}>
              <Input id="fx-defaults" value={d.defaults} placeholder={diff ? '10' : '10, 3'} onChange={(e) => setD((x) => ({ ...x, defaults: e.target.value }))} />
            </FormField>
          )}
          <FormField label="冻结天数" htmlFor="fx-freeze" hint="佣金先冻结，过了退款观察期才能提现；期间退款自动冲回" changed={changed.includes('冻结天数')}>
            <NumberInput id="fx-freeze" min={0} max={365} unit="天" clamp value={d.p.freezeDays} onChange={(v) => set('freezeDays', Math.min(365, Math.max(0, Math.floor(v ?? 0))))} />
          </FormField>
          <FormField label="最低付款金额" htmlFor="fx-minbase" hint="低于这个金额的付款不分佣，挡小额刷单" changed={changed.includes('最低付款金额')}>
            <NumberInput id="fx-minbase" min={0} precision={2} unit="元" value={yuan(d.p.minBaseCents)} onChange={(v) => set('minBaseCents', cents(v))} />
          </FormField>
          <FormField label="大额待复核" htmlFor="fx-hold" hint="实付超过这个金额的单，佣金先挂起到「佣金流水 → 待复核」；0 = 不挂" changed={changed.includes('大额待复核')}>
            <NumberInput id="fx-hold" min={0} precision={2} unit="元" value={yuan(d.p.holdAboveCents)} onChange={(v) => set('holdAboveCents', cents(v))} />
          </FormField>
          <FormField label="复购：只返前几单" htmlFor="fx-rmax" hint="每个被推荐用户只给上级返前几单；0 = 不限" changed={changed.includes('复购单数')}>
            <NumberInput id="fx-rmax" min={0} unit="单" value={d.p.recurringMaxOrders} onChange={(v) => set('recurringMaxOrders', Math.max(0, Math.floor(v ?? 0)))} />
          </FormField>
          <FormField label="复购：绑定后多少天内" htmlFor="fx-rdays" hint="0 = 不限" changed={changed.includes('复购天数')}>
            <NumberInput id="fx-rdays" min={0} unit="天" value={d.p.recurringWithinDays} onChange={(v) => set('recurringWithinDays', Math.max(0, Math.floor(v ?? 0)))} />
          </FormField>
          <FormField label="最低提现金额" htmlFor="fx-minw" changed={changed.includes('最低提现')}>
            <NumberInput id="fx-minw" min={0.01} precision={2} unit="元" value={yuan(d.p.minWithdrawalCents)} onChange={(v) => set('minWithdrawalCents', cents(v, 1))} />
          </FormField>
          <FormField label="提现费率" htmlFor="fx-feebps" hint="从提现金额里扣，财务按实转金额打款；0 = 不收" changed={changed.includes('提现费率')}>
            <NumberInput id="fx-feebps" min={0} max={100} unit="%" clamp value={d.p.withdrawalFeeBps / 100} onChange={(v) => set('withdrawalFeeBps', Math.round(Math.min(100, Math.max(0, v ?? 0)) * 100))} />
          </FormField>
          <FormField label="每笔手续费" htmlFor="fx-feefix" changed={changed.includes('每笔手续费')}>
            <NumberInput id="fx-feefix" min={0} precision={2} unit="元 / 笔" value={yuan(d.p.withdrawalFeeFixedCents)} onChange={(v) => set('withdrawalFeeFixedCents', cents(v))} />
          </FormField>
          <FormField label="按套餐" htmlFor="fx-plans" full hint="某个套餐不返佣，或按正常比例打折 / 加成（0–300%）" changed={changed.includes('按套餐')}>
            <PlanRulesEditor value={d.p.planRules} onChange={(v) => set('planRules', v)} />
          </FormField>
        </FormSection>
      </Panel>
      <SaveBar count={changed.length} summary={changed.join('、')} onDiscard={() => setD(saved)} onSave={save} saveLabel="保存规则" />
    </>
  )
}
