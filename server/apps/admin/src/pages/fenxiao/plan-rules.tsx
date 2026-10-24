import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { listApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import type { PlanRule } from './shared'

type PlanLite = { id: string; name: string; code: string; active?: boolean }

/** 按套餐的分佣规则：某个套餐不返，或在正常比例上打折 / 加成（结算时按订单的套餐 id 匹配）。 */
export function PlanRulesEditor({ value, onChange }: { value: PlanRule[]; onChange: (v: PlanRule[]) => void }) {
  const [plans, setPlans] = React.useState<PlanLite[]>([])
  React.useEffect(() => {
    listApi<PlanLite>('/v1/admin/plans', { limit: 100, offset: 0 }).then((r) => setPlans(r.items)).catch(() => setPlans([]))
  }, [])
  const nameOf = (id: string) => plans.find((p) => p.id === id)?.name ?? '（已删除的套餐）'
  const unused = plans.filter((p) => !value.some((r) => r.planId === p.id))
  const update = (i: number, patch: Partial<PlanRule>) => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <div className="space-y-2">
      {value.map((r, i) => (
        <div key={r.planId} className="flex flex-wrap items-center gap-3 text-sm">
          <span className="w-40 truncate font-medium" title={nameOf(r.planId)}>{nameOf(r.planId)}</span>
          <label className="flex items-center gap-2"><Checkbox checked={r.excluded} onCheckedChange={(v) => update(i, { excluded: v === true })} />不返佣</label>
          {!r.excluded && (
            <label className="flex items-center gap-2">
              按正常比例的
              <Input type="number" className="w-20" min={0} max={300} value={r.multiplierBps / 100} onChange={(e) => update(i, { multiplierBps: Math.round(Math.min(300, Math.max(0, Number(e.target.value) || 0)) * 100) })} />
              %
            </label>
          )}
          <Button size="icon" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))} title="删掉这条（这个套餐回到正常比例）"><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
      {unused.length > 0 && (
        <Select value="" onValueChange={(id) => onChange([...value, { planId: id, excluded: false, multiplierBps: 10000 }])}>
          <SelectTrigger className="w-60"><span className="flex items-center gap-1 text-muted-foreground"><Plus className="h-4 w-4" />给某个套餐单独设</span></SelectTrigger>
          <SelectContent>{unused.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}（{p.code}）</SelectItem>)}</SelectContent>
        </Select>
      )}
      {value.length === 0 && <div className="text-xs text-muted-foreground">没设的套餐都按正常比例返。</div>}
    </div>
  )
}
