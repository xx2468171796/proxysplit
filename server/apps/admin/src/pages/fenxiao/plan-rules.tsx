// 按套餐的分佣规则：某个套餐不返佣，或在正常比例上打折 / 加成（0–300%）；身份编辑器。
import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button, Checkbox, Choice, IconButton, InfoList, Input, Note, NumberInput } from '@ankotti/admin-ui'
import { get, type ListEnvelope } from '@/lib/api'
import type { PlanRule } from './shared'

type PlanLite = { id: string; name: string; code: string }

export function PlanRulesEditor({ value, onChange }: { value: PlanRule[]; onChange: (v: PlanRule[]) => void }) {
  const [plans, setPlans] = React.useState<PlanLite[]>([])
  React.useEffect(() => {
    const ctl = new AbortController()
    get<ListEnvelope<PlanLite>>('/v1/admin/plans?limit=100&offset=0', ctl.signal).then((r) => setPlans(r.items)).catch(() => setPlans([]))
    return () => ctl.abort()
  }, [])
  const nameOf = (id: string) => plans.find((p) => p.id === id)?.name ?? '（已删除的套餐）'
  const unused = plans.filter((p) => !value.some((r) => r.planId === p.id))
  const update = (i: number, p: Partial<PlanRule>) => onChange(value.map((r, j) => (j === i ? { ...r, ...p } : r)))
  return (
    <>
      {value.length === 0 && <Note>没设的套餐都按正常比例返。</Note>}
      <InfoList label="按套餐的分佣规则" items={value.map((r, i) => ({
        key: r.planId,
        label: nameOf(r.planId),
        value: (
          <>
            <Checkbox aria-label={`${nameOf(r.planId)} 不返佣`} checked={r.excluded} onCheckedChange={(v) => update(i, { excluded: v === true })} />
            {r.excluded ? '不返佣' : (
              <NumberInput aria-label={`${nameOf(r.planId)} 按正常比例的百分比`} min={0} max={300} unit="%" clamp
                value={r.multiplierBps / 100} onChange={(v) => update(i, { multiplierBps: Math.round((v ?? 0) * 100) })} />
            )}
            <IconButton label="删掉这条（回到正常比例）" icon={<Trash2 />} size="sm" onClick={() => onChange(value.filter((_, j) => j !== i))} />
          </>
        ),
      }))} />
      {unused.length > 0 && (
        <Choice label="给某个套餐单独设" placeholder="给某个套餐单独设…" size="sm" width={260} value=""
          onChange={(id) => id && onChange([...value, { planId: id, excluded: false, multiplierBps: 10000 }])}
          options={unused.map((p) => ({ value: p.id, label: `${p.name}（${p.code}）` }))} />
      )}
    </>
  )
}

export type TierDraft = { code: string; name: string; rates: string }

export function TiersEditor({ value, onChange, differential }: { value: TierDraft[]; onChange: (v: TierDraft[]) => void; differential: boolean }) {
  const update = (i: number, p: Partial<TierDraft>) => onChange(value.map((t, j) => (j === i ? { ...t, ...p } : t)))
  return (
    <>
      <InfoList label="分销身份" items={value.map((t, i) => ({
        key: String(i),
        label: t.name || `身份 ${i + 1}`,
        value: (
          <>
            <Input aria-label="身份名称" size="sm" width={120} value={t.name} placeholder="名称" onChange={(e) => update(i, { name: e.target.value })} />
            <Input aria-label="身份代码" size="sm" width={120} mono value={t.code} placeholder="代码 agent" onChange={(e) => update(i, { code: e.target.value.toLowerCase() })} />
            <Input aria-label="比例（%）" size="sm" width={160} value={t.rates} placeholder={differential ? '30' : '20, 5'} onChange={(e) => update(i, { rates: e.target.value })} />
            <IconButton label="删除这个身份（已设成这个身份的人变回普通用户）" icon={<Trash2 />} size="sm" onClick={() => onChange(value.filter((_, j) => j !== i))} />
          </>
        ),
      }))} />
      <Button size="sm" variant="outline" onClick={() => onChange([...value, { code: '', name: '', rates: '' }])}><Plus />加一个身份</Button>
    </>
  )
}
