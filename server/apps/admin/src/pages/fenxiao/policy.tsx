import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { put } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PlanRulesEditor } from './plan-rules'
import { parseRates, ratesInput, type Policy } from './shared'

type TierDraft = { code: string; name: string; rates: string }

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 md:grid-cols-[200px_1fr] md:items-center">
      <div><div className="text-sm font-medium">{label}</div>{hint && <div className="text-xs text-muted-foreground">{hint}</div>}</div>
      <div>{children}</div>
    </div>
  )
}

export function PolicyTab({ policy, onSaved }: { policy: Policy; onSaved: (p: Policy) => void }) {
  const [p, setP] = React.useState(policy)
  const [tiers, setTiers] = React.useState<TierDraft[]>(policy.tiers.map((t) => ({ code: t.code, name: t.name, rates: ratesInput(t.rates) })))
  const [defaults, setDefaults] = React.useState(ratesInput(policy.defaultRates))
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof Policy>(k: K, v: Policy[K]) => setP((x) => ({ ...x, [k]: v }))
  const diff = p.mode === 'differential'

  async function save() {
    const defaultRates = parseRates(defaults)
    const parsed = tiers.map((t) => ({ code: t.code.trim(), name: t.name.trim(), rates: parseRates(t.rates) }))
    if (!defaultRates || parsed.some((t) => !t.rates || !t.code || !t.name)) return toast.error('比例填百分数、逗号分隔（如 20, 5）；每个身份都要有代码和名称')
    setBusy(true)
    try {
      const saved = await put<Policy>('/v1/admin/fenxiao/policy', { ...p, defaultRates, tiers: parsed })
      toast.success(saved.enabled ? '已保存，分佣已开启' : '已保存（分佣未开启）')
      onSaved(saved)
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Card>
      <CardContent className="space-y-5 p-5">
        <Row label="开启分佣" hint="关着时只记录谁推荐了谁，不产生佣金">
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={p.enabled} onCheckedChange={(v) => set('enabled', v === true)} />被推荐用户付款后，给上级算佣金</label>
        </Row>
        <Row label="算法" hint={diff ? '级差：上级拿「自己的比例 − 下面已经分走的」，经销商体系常用' : '逐级：每一级上级按自己身份的第 N 级比例拿'}>
          <Select value={p.mode} onValueChange={(v) => set('mode', v as Policy['mode'])}>
            <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="level">逐级比例（一级 x%，二级 y%）</SelectItem>
              <SelectItem value="differential">级差（按身份总比例补差）</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Row label="最多返几级" hint="1 = 只给直接推荐人；最多 3 级（国内三级以上有传销风险）">
          <Input type="number" className="w-28" min={1} max={3} value={p.maxLevels} onChange={(e) => set('maxLevels', Math.min(3, Math.max(1, Number(e.target.value) || 1)))} />
        </Row>
        <Row label="分销身份" hint={diff ? '每个身份填一个总比例（%）' : '每个身份填逐级比例（%），逗号分隔：一级, 二级, …'}>
          <div className="space-y-2">
            {tiers.map((t, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input className="w-28" value={t.name} placeholder="名称" onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <Input className="w-28 font-mono" value={t.code} placeholder="代码 agent" onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, code: e.target.value.toLowerCase() } : x)))} />
                <Input className="w-48" value={t.rates} placeholder={diff ? '30' : '20, 5'} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, rates: e.target.value } : x)))} />
                <Button size="icon" variant="ghost" onClick={() => setTiers(tiers.filter((_, j) => j !== i))} title="删除这个身份（已设成这个身份的人变回普通用户）"><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => setTiers([...tiers, { code: '', name: '', rates: '' }])}><Plus className="h-4 w-4" />加一个身份</Button>
          </div>
        </Row>
        <Row label="人人可推广" hint="关着时只有后台设了身份的人有邀请码">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={p.openToAll} onCheckedChange={(v) => set('openToAll', v === true)} />普通用户也能拿佣金</label>
            {p.openToAll && <Input className="w-48" value={defaults} placeholder={diff ? '10' : '10, 3'} onChange={(e) => setDefaults(e.target.value)} />}
          </div>
        </Row>
        <Row label="一笔合计上限（%）" hint="一笔付款所有上级加起来最多拿这么多，超出从远端砍，护住毛利">
          <Input type="number" className="w-28" min={0} max={100} value={p.totalCapBps / 100} onChange={(e) => set('totalCapBps', Math.round(Math.min(100, Math.max(0, Number(e.target.value) || 0)) * 100))} />
        </Row>
        <Row label="冻结天数" hint="佣金先冻结，过了退款观察期才能提现；期间退款自动冲回">
          <Input type="number" className="w-28" min={0} max={365} value={p.freezeDays} onChange={(e) => set('freezeDays', Math.min(365, Math.max(0, Math.floor(Number(e.target.value) || 0))))} />
        </Row>
        <Row label="最低付款金额（元）" hint="低于这个金额的付款不分佣，挡小额刷单">
          <Input type="number" className="w-28" min={0} value={p.minBaseCents / 100} onChange={(e) => set('minBaseCents', Math.round(Math.max(0, Number(e.target.value) || 0) * 100))} />
        </Row>
        <Row label="按套餐" hint="某个套餐不返佣，或按正常比例打折 / 加成">
          <PlanRulesEditor value={p.planRules} onChange={(v) => set('planRules', v)} />
        </Row>
        <Row label="复购限制" hint="订阅续费常用：每个被推荐用户只给上级返前几单 / 绑定后多少天内；0 = 不限">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            前 <Input type="number" className="w-20" min={0} value={p.recurringMaxOrders} onChange={(e) => set('recurringMaxOrders', Math.max(0, Math.floor(Number(e.target.value) || 0)))} /> 单，
            绑定后 <Input type="number" className="w-20" min={0} value={p.recurringWithinDays} onChange={(e) => set('recurringWithinDays', Math.max(0, Math.floor(Number(e.target.value) || 0)))} /> 天内
          </div>
        </Row>
        <Row label="大额待复核（元）" hint="实付超过这个金额的单，佣金先挂起，到「佣金流水 → 待复核」放行或作废；0 = 不挂">
          <Input type="number" className="w-28" min={0} value={p.holdAboveCents / 100} onChange={(e) => set('holdAboveCents', Math.round(Math.max(0, Number(e.target.value) || 0) * 100))} />
        </Row>
        <Row label="最低提现金额（元）">
          <Input type="number" className="w-28" min={0.01} value={p.minWithdrawalCents / 100} onChange={(e) => set('minWithdrawalCents', Math.max(1, Math.round((Number(e.target.value) || 0) * 100)))} />
        </Row>
        <Row label="提现手续费" hint="从提现金额里扣，财务按实转金额打款；都填 0 = 不收">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Input type="number" className="w-20" min={0} max={100} value={p.withdrawalFeeBps / 100} onChange={(e) => set('withdrawalFeeBps', Math.round(Math.min(100, Math.max(0, Number(e.target.value) || 0)) * 100))} /> % +
            <Input type="number" className="w-24" min={0} value={p.withdrawalFeeFixedCents / 100} onChange={(e) => set('withdrawalFeeFixedCents', Math.round(Math.max(0, Number(e.target.value) || 0) * 100))} /> 元 / 笔
          </div>
        </Row>
        <div className="flex justify-end"><Button disabled={busy} onClick={save}>{busy ? '保存中…' : '保存规则'}</Button></div>
      </CardContent>
    </Card>
  )
}
