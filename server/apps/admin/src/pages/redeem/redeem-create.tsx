// 批量生成兑换码：POST /v1/admin/redeem-codes；明码只在结果弹框里显示这一次。
import * as React from 'react'
import { Copy, ListFilter, RotateCcw } from 'lucide-react'
import {
  Button, ButtonGroup, Checkbox, Choice, CopyBlock, Dialog, DialogFooter, DateTimePicker, FormDialog, FormField, FormSection,
  InlineAlert, Input, NumberInput, useNotify,
} from '@ankotti/admin-ui'
import { post } from '@/lib/api'
import { localToIso } from '@/lib/dates'

export type PlanLite = { id: string; name: string }
type CreateResult = { batchId: string; codes: string[] }
type Draft = { planId: string; lifetime: boolean; days: number | null; count: number | null; unlimited: boolean; maxUses: number | null; note: string; expires: string }
const initial = (planId: string): Draft => ({ planId, lifetime: false, days: 30, count: 10, unlimited: false, maxUses: 50, note: '', expires: '' })

function explain(d: Draft): string {
  const uses = d.unlimited ? '不限次数' : d.maxUses === 1 ? '每个码只能用 1 次' : `每个码最多 ${d.maxUses ?? '—'} 人使用`
  const length = d.lifetime ? '永久会员' : `${d.days ?? '—'} 天会员（同级会员时长叠加）`
  return `生成 ${d.count ?? '—'} 个码，${uses}，兑换得到 ${length}${d.expires ? '，到期后不能再兑换' : ''}。`
}

function validate(d: Draft) {
  if (!d.planId) throw new Error('请选择套餐')
  if (!d.lifetime && (d.days === null || d.days < 1 || d.days > 36500)) throw new Error('天数要在 1–36500 之间')
  if (d.count === null || d.count < 1 || d.count > 500) throw new Error('数量要在 1–500 之间')
  if (!d.unlimited && (d.maxUses === null || d.maxUses < 1 || d.maxUses > 1_000_000)) throw new Error('可用次数要在 1–1000000 之间，或勾选「不限」')
  if (d.note.length > 200) throw new Error('备注最多 200 个字')
}

function ResultDialog({ result, onClose, onAgain, onShowBatch }: { result: CreateResult; onClose: () => void; onAgain: () => void; onShowBatch: () => void }) {
  const notify = useNotify()
  const all = result.codes.join('\n')
  return (
    <Dialog open size="md" title={`已生成 ${result.codes.length} 个兑换码`} description="明码只显示这一次，关掉后列表里只能看到码本身，请现在复制保存。" onClose={onClose}
      footer={<DialogFooter>
        <Button variant="ghost" onClick={onAgain}><RotateCcw />再生成一批</Button>
        <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(all).then(() => notify('已复制全部兑换码', 'success')) }}><Copy />复制全部</Button>
        <Button onClick={onShowBatch}><ListFilter />完成并查看该批次</Button>
      </DialogFooter>}>
      <InlineAlert tone="info" title={`批次 ${result.batchId}`} density="compact" />
      {result.codes.map((c, i) => <CopyBlock key={c} label={`兑换码 ${i + 1}`} value={c} />)}
    </Dialog>
  )
}

export function RedeemCreate({ plans, onClose, onCreated, onShowBatch }: {
  plans: PlanLite[]; onClose: () => void; onCreated: () => void; onShowBatch: (batchId: string) => void
}) {
  const [d, setD] = React.useState<Draft>(() => initial(plans[0]?.id ?? ''))
  const [result, setResult] = React.useState<CreateResult | null>(null)
  // FormDialog 成功后会调 onClose；生成成功时改为显示结果弹框，不关闭整个流程。
  const created = React.useRef(false)
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }))
  if (result) {
    return <ResultDialog result={result} onClose={onClose}
      onAgain={() => { created.current = false; setResult(null); setD(initial(d.planId)) }}
      onShowBatch={() => { onShowBatch(result.batchId); onClose() }} />
  }
  return (
    <FormDialog open title="批量生成兑换码" description={explain(d)} submitLabel="生成" dirty onClose={() => { if (!created.current) onClose() }}
      onSubmit={async () => {
        validate(d)
        const r = await post<CreateResult>('/v1/admin/redeem-codes', {
          planId: d.planId, lifetime: d.lifetime, durationDays: d.lifetime ? null : d.days, count: d.count,
          maxUses: d.unlimited ? null : d.maxUses, note: d.note.trim(), codeExpiresAt: localToIso(d.expires),
        })
        onCreated()
        created.current = true
        setResult(r)
      }}>
      <FormSection>
        <FormField label="套餐" htmlFor="rc-plan" required full>
          <Choice id="rc-plan" label="套餐" value={d.planId} onChange={(v) => set({ planId: v })} options={plans.map((p) => ({ value: p.id, label: p.name }))} />
        </FormField>
        <FormField label="常用方式" htmlFor="rc-preset" full hint="一人一码：每个码用 1 次；一码多人：1 个码给很多人用">
          <ButtonGroup label="常用方式">
            <Button id="rc-preset" size="sm" variant="outline" onClick={() => set({ unlimited: false, maxUses: 1, count: (d.count ?? 0) < 2 ? 10 : d.count })}>一人一码</Button>
            <Button size="sm" variant="outline" onClick={() => set({ unlimited: false, count: 1, maxUses: 50 })}>一码多人</Button>
          </ButtonGroup>
        </FormField>
        <FormField label="会员天数" htmlFor="rc-days" hint="1–36500">
          <NumberInput id="rc-days" value={d.lifetime ? null : d.days} disabled={d.lifetime} onChange={(v) => set({ days: v })} min={1} max={36500} unit="天" />
        </FormField>
        <FormField label="永久会员" htmlFor="rc-life">
          <Checkbox id="rc-life" checked={d.lifetime} onCheckedChange={(v) => set({ lifetime: v === true })} />
        </FormField>
        <FormField label="生成数量" htmlFor="rc-count" hint="1–500">
          <NumberInput id="rc-count" value={d.count} onChange={(v) => set({ count: v })} min={1} max={500} unit="个" />
        </FormField>
        <FormField label="每个码可用次数" htmlFor="rc-uses" hint="1–1000000">
          <NumberInput id="rc-uses" value={d.unlimited ? null : d.maxUses} disabled={d.unlimited} onChange={(v) => set({ maxUses: v })} min={1} max={1_000_000} unit="次" />
        </FormField>
        <FormField label="不限次数" htmlFor="rc-unl">
          <Checkbox id="rc-unl" checked={d.unlimited} onCheckedChange={(v) => set({ unlimited: v === true })} />
        </FormField>
        <FormField label="码有效期至" htmlFor="rc-exp" optional hint="留空 = 长期可兑换">
          <DateTimePicker id="rc-exp" value={d.expires} onChange={(v) => set({ expires: v })} clearable />
        </FormField>
        <FormField label="备注" htmlFor="rc-note" optional full count={{ value: d.note.length, max: 200 }}>
          <Input id="rc-note" value={d.note} maxLength={200} onChange={(e) => set({ note: e.target.value })} placeholder="例如：10 月直播活动" />
        </FormField>
      </FormSection>
    </FormDialog>
  )
}
