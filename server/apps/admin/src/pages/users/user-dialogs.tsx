// 用户的三个表单弹框：新建用户、发放会员、修改密码（校验与后端 schema 对齐：新建 10 位、重置 8 位）。
import * as React from 'react'
import { Dices } from 'lucide-react'
import { Button, Choice, CopyButton, FormDialog, FormField, FormSection, Input, NumberInput, SegmentedControl, Switch } from '@ankotti/admin-ui'
import { patch, post } from '@/lib/api'
import { tier } from '@/lib/format'
import type { PlanLite } from './types'

export const CREATE_PWD_MIN = 10
export const RESET_PWD_MIN = 8

const planOptions = (plans: readonly PlanLite[]) =>
  plans.map((p) => ({ value: p.id, label: p.name, hint: `${tier(p.tier).label} · ${p.lifetime ? '永久' : `${p.durationDays ?? '—'} 天`} · ${p.maxDevices} 台`, ...(p.active ? {} : { group: '已下架' }) }))

/** 12 位随机密码，去掉 0 / O / 1 / l / I 这些容易看错的字符。 */
export function randomPassword(length = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const buf = new Uint32Array(length)
  crypto.getRandomValues(buf)
  return Array.from(buf, (n) => chars[n % chars.length]).join('')
}

export function CreateUserDialog({ plans, onClose, onDone }: { plans: readonly PlanLite[]; onClose: () => void; onDone: () => void }) {
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [planId, setPlanId] = React.useState('')
  const [days, setDays] = React.useState<number | null>(30)
  return (
    <FormDialog open title="新建用户" description="管理员直接开户；选了套餐会同时发放对应会员。" submitLabel="创建"
      dirty={!!(username || password || planId)} onClose={onClose}
      onSubmit={async () => {
        if (username.trim().length < 3) throw new Error('用户名至少 3 位')
        if (password.length < CREATE_PWD_MIN) throw new Error(`密码至少 ${CREATE_PWD_MIN} 位，可点「随机生成」`)
        if (!days || days < 1) throw new Error('授权天数至少 1 天')
        await post('/v1/admin/users', { username: username.trim(), password, planId: planId || null, days })
        onDone()
      }}>
      <FormField label="用户名" htmlFor="nu-name" required><Input id="nu-name" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" /></FormField>
      <PasswordField id="nu-pwd" value={password} onChange={setPassword} min={CREATE_PWD_MIN} />
      <FormField label="套餐" htmlFor="nu-plan" optional hint="不选 = 只开账号，按免费档使用">
        <Choice id="nu-plan" label="套餐" clearable placeholder="不发放会员" value={planId} onChange={setPlanId} options={planOptions(plans)} />
      </FormField>
      <FormField label="授权天数" htmlFor="nu-days" required><NumberInput id="nu-days" value={days} onChange={setDays} min={1} max={3650} unit="天" /></FormField>
    </FormDialog>
  )
}

function PasswordField({ id, value, onChange, min }: { id: string; value: string; onChange: (v: string) => void; min: number }) {
  return (
    <FormField label="密码" htmlFor={id} required hint={`至少 ${min} 位；明文显示，方便复制给用户`}>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="new-password" mono
        suffix={value ? <CopyButton text={value} label="复制密码" /> : undefined} />
      <Button type="button" size="sm" variant="ghost" onClick={() => onChange(randomPassword())}><Dices />随机生成</Button>
    </FormField>
  )
}

export function PasswordDialog({ user, onClose, onDone }: { user: { id: string; username: string }; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = React.useState('')
  return (
    <FormDialog open title={`修改「${user.username}」的密码`} description="改完后该用户在所有设备上的登录都会失效，需要用新密码重新登录。"
      submitLabel="保存新密码" dirty={!!password} onClose={onClose}
      onSubmit={async () => {
        if (password.length < RESET_PWD_MIN) throw new Error(`密码至少 ${RESET_PWD_MIN} 位`)
        await patch(`/v1/admin/users/${user.id}/password`, { password })
        onDone()
      }}>
      <PasswordField id="pw-new" value={password} onChange={setPassword} min={RESET_PWD_MIN} />
    </FormDialog>
  )
}

const PRESETS = [{ value: '30', label: '30 天' }, { value: '90', label: '90 天' }, { value: '365', label: '365 天' }, { value: 'life', label: '永久' }]

export function GrantDialog({ user, plans, onClose, onDone }: { user: { id: string; username: string }; plans: readonly PlanLite[]; onClose: () => void; onDone: () => void }) {
  const [planId, setPlanId] = React.useState('')
  const [lifetime, setLifetime] = React.useState(false)
  const [days, setDays] = React.useState<number | null>(30)
  const plan = plans.find((p) => p.id === planId)
  const preset = lifetime ? 'life' : PRESETS.some((p) => p.value === String(days)) ? String(days) : ''
  const summary = !plan ? '先选套餐：套餐决定会员等级、设备数和功能。'
    : lifetime ? `发放「${plan.name}」永久会员。`
    : `发放「${plan.name}」${days ?? '—'} 天；同级会员未到期时在原到期时间上叠加。`
  return (
    <FormDialog open title={`给「${user.username}」发放会员`} description="手动开通或补偿会员，写入审计。" submitLabel="发放"
      dirty={!!planId} onClose={onClose} hint={summary}
      onSubmit={async () => {
        if (!planId) throw new Error('请选择套餐')
        if (!lifetime && (!days || days < 1)) throw new Error('天数至少 1 天，或改成永久')
        await post(`/v1/admin/users/${user.id}/grant`, { planId, lifetime, durationDays: lifetime ? null : days })
        onDone()
      }}>
      <FormSection>
        <FormField label="套餐" htmlFor="gr-plan" required full><Choice id="gr-plan" label="套餐" value={planId} onChange={setPlanId} options={planOptions(plans)} placeholder="选择套餐" /></FormField>
        <FormField label="时长" htmlFor="gr-preset" full>
          <SegmentedControl label="时长预设" value={preset} options={PRESETS}
            onValueChange={(v) => { if (v === 'life') setLifetime(true); else { setLifetime(false); setDays(Number(v)) } }} />
        </FormField>
        <FormField label="天数" htmlFor="gr-days" hint="1–36500 天">
          <NumberInput id="gr-days" value={lifetime ? null : days} onChange={setDays} min={1} max={36500} unit="天" disabled={lifetime} />
        </FormField>
        <FormField label="永久" htmlFor="gr-life"><Switch id="gr-life" checked={lifetime} onCheckedChange={setLifetime} /></FormField>
      </FormSection>
    </FormDialog>
  )
}
