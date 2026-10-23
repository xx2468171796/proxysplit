import * as React from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { GitBranch, Pencil, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { listApi, patch, post } from '@/lib/api'
import { cn, dateOnly, money } from '@/lib/utils'
import { DataTable } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { parseRates, ratesInput, ratesText, type Member, type Policy } from './shared'

const NONE = '__none__'

export function MembersTab({ policy, refresh, onChanged }: { policy: Policy; refresh: number; onChanged: () => void }) {
  const [edit, setEdit] = React.useState<Member | 'new' | null>(null)
  const [move, setMove] = React.useState<Member | null>(null)
  const [parentFilter, setParentFilter] = React.useState<Member | null>(null)

  const columns = React.useMemo<ColumnDef<Member, unknown>[]>(() => [
    {
      id: 'user', header: '用户 / 邀请码',
      cell: ({ row: { original: m } }) => (
        <div className="min-w-0">
          <div className={cn('font-medium', !m.enabled && 'text-muted-foreground line-through')}>{m.username}</div>
          <div className="font-mono text-xs text-muted-foreground">{m.code ?? '—'}</div>
        </div>
      ),
    },
    {
      id: 'tier', header: '身份',
      cell: ({ row: { original: m } }) => (
        <div className="space-y-0.5">
          {m.tierName ? <Badge variant="success">{m.tierName}</Badge> : <Badge variant="secondary">普通用户</Badge>}
          <div className="text-xs text-muted-foreground">{m.rateOverride ? `单独比例：${ratesText(m.rateOverride, policy.mode)}` : ''}</div>
        </div>
      ),
    },
    { id: 'parent', header: '上级', cell: ({ row: { original: m } }) => <span className="text-sm">{m.parentUsername ?? '—'}</span> },
    {
      id: 'team', header: '直推 / 团队',
      cell: ({ row: { original: m } }) => (
        <button type="button" className="tabular-nums underline-offset-2 hover:underline" onClick={() => setParentFilter(m)} title="看他的直推下级">
          {m.directCount} / {m.teamCount}
        </button>
      ),
    },
    {
      id: 'money', header: '累计 / 可提现 / 冻结',
      cell: ({ row: { original: { account: a } } }) => (
        <div className="text-xs tabular-nums">
          <div className="font-medium">{money(a.earnedCents - a.reversedCents)}</div>
          <div className={cn(a.availableCents < 0 && 'text-destructive')}>{money(a.availableCents)} · {money(a.frozenCents)}</div>
        </div>
      ),
    },
    { id: 'boundAt', header: '绑定时间', cell: ({ row: { original: m } }) => <span className="text-xs">{dateOnly(m.boundAt)}</span> },
    {
      id: 'actions', header: '',
      cell: ({ row: { original: m } }) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEdit(m)}><Pencil className="h-4 w-4" />设置</Button>
          <Button size="sm" variant="ghost" onClick={() => setMove(m)}><GitBranch className="h-4 w-4" />改上级</Button>
        </div>
      ),
    },
  ], [policy.mode])

  return (
    <>
      {parentFilter && (
        <div className="mb-2 flex items-center gap-2 text-sm">
          <span>正在看 <b>{parentFilter.username}</b> 的直推下级</span>
          <Button size="sm" variant="outline" onClick={() => setParentFilter(null)}>返回全部</Button>
        </div>
      )}
      <DataTable<Member>
        columns={columns}
        getRowId={(m) => m.userId}
        searchable
        searchPlaceholder="搜用户名或邀请码"
        filters={[{ key: 'agentsOnly', label: '身份', options: [{ label: '只看分销商 / 经销商', value: '1' }] }]}
        extraParams={{ parentUserId: parentFilter?.userId ?? '' }}
        refreshSignal={refresh}
        emptyText="还没有推荐关系。设一个分销商，把他的邀请链接发出去。"
        fetcher={(q) => listApi<Member>('/v1/admin/fenxiao/members', { q: q.q, limit: q.limit, offset: q.offset, ...q.filters })}
        toolbar={<Button onClick={() => setEdit('new')}><UserPlus className="h-4 w-4" />设为分销商</Button>}
      />
      <EditDialog policy={policy} target={edit} onClose={() => setEdit(null)} onDone={onChanged} />
      <MoveDialog target={move} onClose={() => setMove(null)} onDone={onChanged} />
    </>
  )
}

function EditDialog({ policy, target, onClose, onDone }: { policy: Policy; target: Member | 'new' | null; onClose: () => void; onDone: () => void }) {
  const m = target === 'new' ? null : target
  const [username, setUsername] = React.useState('')
  const [tier, setTier] = React.useState(NONE)
  const [rates, setRates] = React.useState('')
  const [code, setCode] = React.useState('')
  const [note, setNote] = React.useState('')
  const [enabled, setEnabled] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    setUsername(''); setTier(m?.tierCode ?? policy.tiers[0]?.code ?? NONE); setRates(ratesInput(m?.rateOverride))
    setCode(m?.code ?? ''); setNote(m?.note ?? ''); setEnabled(m?.enabled ?? true)
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    const rateOverride = rates.trim() ? parseRates(rates) : null
    if (rates.trim() && !rateOverride) return toast.error('单独比例填百分数，逗号分隔，例如 25, 5')
    const body = { tierCode: tier === NONE ? null : tier, rateOverride, note: note.trim() || null, enabled, ...(code.trim() && code.trim() !== m?.code ? { code: code.trim() } : {}) }
    setBusy(true)
    try {
      if (m) await patch(`/v1/admin/fenxiao/members/${m.userId}`, body)
      else await post('/v1/admin/fenxiao/members', { username: username.trim(), ...body })
      toast.success('已保存')
      onClose(); onDone()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m ? `设置 ${m.username}` : '设为分销商 / 经销商'}</DialogTitle>
          <DialogDescription>身份决定他能拿几级、拿多少；「单独比例」只给这一个人，留空跟身份走。改了不影响已经产生的佣金。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          {!m && <label className="grid gap-1.5"><span className="text-muted-foreground">用户名</span><Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="要设为分销商的账号" /></label>}
          <label className="grid gap-1.5">
            <span className="text-muted-foreground">身份</span>
            <Select value={tier} onValueChange={setTier}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {policy.tiers.map((t) => <SelectItem key={t.code} value={t.code}>{t.name}（{ratesText(t.rates, policy.mode)}）</SelectItem>)}
                <SelectItem value={NONE}>普通用户{policy.openToAll ? `（${ratesText(policy.defaultRates, policy.mode)}）` : '（不拿佣金）'}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5"><span className="text-muted-foreground">单独比例（%，逗号分隔，可留空）</span><Input value={rates} onChange={(e) => setRates(e.target.value)} placeholder={policy.mode === 'differential' ? '例如 30' : '例如 25, 5'} /></label>
          <label className="grid gap-1.5"><span className="text-muted-foreground">邀请码（留空自动生成，4~16 位字母数字）</span><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={16} /></label>
          <label className="grid gap-1.5"><span className="text-muted-foreground">备注（渠道、联系方式，仅后台可见）</span><Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></label>
          <label className="flex items-center gap-2"><Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />启用（停用后邀请码失效、不再拿佣金，历史保留）</label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={busy || (!m && !username.trim())} onClick={save}>{busy ? '保存中…' : '保存'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MoveDialog({ target, onClose, onDone }: { target: Member | null; onClose: () => void; onDone: () => void }) {
  const [parent, setParent] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => setParent(target?.parentUsername ?? ''), [target])
  async function save() {
    if (!target) return
    setBusy(true)
    try {
      await post(`/v1/admin/fenxiao/members/${target.userId}/move`, { parentUsername: parent.trim() || null })
      toast.success(parent.trim() ? `已改挂到 ${parent.trim()} 下面` : '已摘成顶层')
      onClose(); onDone()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>改 {target?.username} 的上级</DialogTitle>
          <DialogDescription>他下面整个团队会跟着一起挪过去。只影响以后的付款，已经产生的佣金不变。留空 = 没有上级。</DialogDescription>
        </DialogHeader>
        <Input value={parent} onChange={(e) => setParent(e.target.value)} placeholder="新上级的用户名" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={busy} onClick={save}>{busy ? '处理中…' : '确认改挂'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
