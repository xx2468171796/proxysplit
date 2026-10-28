// 设为分销商 / 设置成员、改上级两个表单弹框。
import * as React from 'react'
import { Choice, FormDialog, FormField, Input, Switch, useNotify } from '@ankotti/admin-ui'
import { patch, post } from '@/lib/api'
import { parseRates, ratesInput, ratesText, type Member, type Policy } from './shared'

const NONE = '__none__'

type MemberDialogProps = { policy: Policy; target: Member | 'new'; presetUsername: string; onClose: () => void; onDone: () => void }

export function MemberDialog({ policy, target, presetUsername, onClose, onDone }: MemberDialogProps) {
  const notify = useNotify()
  const m = target === 'new' ? null : target
  const initial = React.useMemo(() => ({
    username: m ? '' : presetUsername,
    tier: m ? m.tierCode ?? NONE : policy.tiers[0]?.code ?? NONE,
    rates: ratesInput(m?.rateOverride), code: m?.code ?? '', note: m?.note ?? '', enabled: m?.enabled ?? true,
  }), [m, policy.tiers, presetUsername])
  const [d, setD] = React.useState(initial)
  const set = (p: Partial<typeof d>) => setD((x) => ({ ...x, ...p }))
  const tierOptions = [
    ...policy.tiers.map((t) => ({ value: t.code, label: `${t.name}（${ratesText(t.rates, policy.mode)}）` })),
    { value: NONE, label: `普通用户${policy.openToAll ? `（${ratesText(policy.defaultRates, policy.mode)}）` : '（不拿佣金）'}` },
  ]

  return (
    <FormDialog open title={m ? `设置 ${m.username}` : '设为分销商 / 经销商'}
      description="身份决定他能拿几级、拿多少；「单独比例」只给这一个人，留空跟身份走。改了不影响已经产生的佣金。"
      dirty={JSON.stringify(d) !== JSON.stringify(initial)} submitLabel="保存" onClose={onClose}
      onSubmit={async () => {
        if (!m && !d.username.trim()) throw new Error('请填写要设为分销商的用户名')
        const rateOverride = d.rates.trim() ? parseRates(d.rates) : null
        if (d.rates.trim() && !rateOverride) throw new Error('单独比例填百分数，逗号分隔，例如 25, 5（最多 10 级，每级 0–100）')
        const code = d.code.trim()
        if (code && !/^[A-Z0-9]{4,16}$/.test(code)) throw new Error('邀请码为 4–16 位字母或数字')
        const body = { tierCode: d.tier === NONE ? null : d.tier, rateOverride, note: d.note.trim() || null, enabled: d.enabled, ...(code && code !== m?.code ? { code } : {}) }
        if (m) await patch(`/v1/admin/fenxiao/members/${m.userId}`, body)
        else await post('/v1/admin/fenxiao/members', { username: d.username.trim(), ...body })
        notify('已保存', 'success')
        onDone()
        onClose()
      }}>
      {!m && (
        <FormField label="用户名" htmlFor="fx-username" required>
          <Input id="fx-username" value={d.username} placeholder="要设为分销商的账号" onChange={(e) => set({ username: e.target.value })} />
        </FormField>
      )}
      <FormField label="身份" htmlFor="fx-tier">
        <Choice id="fx-tier" label="身份" value={d.tier} onChange={(tier) => set({ tier })} options={tierOptions} />
      </FormField>
      <FormField label="单独比例（%）" htmlFor="fx-rates" optional hint="逗号分隔，留空跟身份走">
        <Input id="fx-rates" value={d.rates} placeholder={policy.mode === 'differential' ? '例如 30' : '例如 25, 5'} onChange={(e) => set({ rates: e.target.value })} />
      </FormField>
      <FormField label="邀请码" htmlFor="fx-code" optional hint="留空自动生成，4–16 位字母数字">
        <Input id="fx-code" value={d.code} maxLength={16} mono onChange={(e) => set({ code: e.target.value.toUpperCase() })} />
      </FormField>
      <FormField label="备注" htmlFor="fx-note" optional hint="渠道、联系方式，仅后台可见" count={{ value: d.note.length, max: 200 }}>
        <Input id="fx-note" value={d.note} maxLength={200} onChange={(e) => set({ note: e.target.value })} />
      </FormField>
      <FormField label="启用" htmlFor="fx-enabled" hint="停用后邀请码失效、不再拿佣金，历史保留">
        <Switch id="fx-enabled" checked={d.enabled} onCheckedChange={(enabled) => set({ enabled })} />
      </FormField>
    </FormDialog>
  )
}

export function MoveDialog({ target, onClose, onDone }: { target: Member; onClose: () => void; onDone: () => void }) {
  const notify = useNotify()
  const [parent, setParent] = React.useState(target.parentUsername ?? '')
  return (
    <FormDialog open title={`改 ${target.username} 的上级`}
      description="他下面整个团队会跟着一起挪过去。只影响以后的付款，已经产生的佣金不变。留空 = 没有上级。"
      dirty={parent !== (target.parentUsername ?? '')} submitLabel="确认改挂" onClose={onClose}
      onSubmit={async () => {
        const name = parent.trim()
        await post(`/v1/admin/fenxiao/members/${target.userId}/move`, { parentUsername: name || null })
        notify(name ? `已改挂到 ${name} 下面` : '已摘成顶层', 'success')
        onDone()
        onClose()
      }}>
      <FormField label="新上级" htmlFor="fx-parent" optional hint="留空 = 摘成顶层">
        <Input id="fx-parent" value={parent} placeholder="新上级的用户名" onChange={(e) => setParent(e.target.value)} />
      </FormField>
    </FormDialog>
  )
}
