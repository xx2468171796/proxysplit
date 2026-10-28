// 兑换码（T02 资源列表页）：筛选状态 / 套餐 / 永久 / 批次，复制、按批次筛选、启用停用、删除，批量生成。
import * as React from 'react'
import { Ban, CircleCheck, ListFilter, Plus, Trash2 } from 'lucide-react'
import {
  Button, CellDate, CellText, Choice, ConfirmDialog, CopyableValue, DataTable, Input, PageBody, PageHeader, QueryBar,
  ResourcePanel, RowActionBar, StatusBadge, errorText, useNotify, type Column,
} from '@ankotti/admin-ui'
import { del, get, post } from '@/lib/api'
import { useServerList } from '@/lib/list'
import { tier, type Tone } from '@/lib/format'
import type { PageProps } from '@/shell/workspace-context'
import { RedeemCreate, type PlanLite } from './redeem-create'

type Code = {
  id: string; code: string; status: 'active' | 'disabled' | 'used'; durationDays: number | null; lifetime: boolean; note: string
  batchId: string | null; codeExpiresAt: string | null; redeemedAt: string | null; createdAt: string; planName: string; tier: string
  redeemedBy: string | null; maxUses: number | null; usedCount: number
}
const STATUS: Record<string, Tone> = { active: { label: '可用', tone: 'success' }, disabled: { label: '已停用', tone: 'neutral' }, used: { label: '已用完', tone: 'info' } }
const expired = (c: Code) => !!c.codeExpiresAt && new Date(c.codeExpiresAt).getTime() < Date.now()

function usePlans() {
  const [plans, setPlans] = React.useState<PlanLite[]>([])
  React.useEffect(() => {
    const ac = new AbortController()
    get<{ items: PlanLite[] }>('/v1/admin/plans?limit=100', ac.signal).then((r) => setPlans(r.items)).catch(() => undefined)
    return () => ac.abort()
  }, [])
  return plans
}

function useColumns(onBatch: (id: string) => void, onToggle: (c: Code) => void, onDelete: (c: Code) => void): Column<Code>[] {
  return [
    { key: 'code', title: '兑换码', sortable: true, width: 220, mobile: 'primary', render: (c) => <CellText primary={<CopyableValue variant="inline" value={c.code} label="兑换码" />} secondary={c.note || undefined} /> },
    { key: 'plan', title: '套餐 / 时长', maxWidth: 200, truncate: (c) => c.planName, render: (c) => <CellText primary={c.planName} secondary={`${tier(c.tier).label} · ${c.lifetime ? '永久' : `${c.durationDays ?? '—'} 天`}`} /> },
    { key: 'status', title: '状态', sortable: true, width: 96, render: (c) => { const s = STATUS[c.status] ?? { label: c.status, tone: 'neutral' as const }; return <StatusBadge tone={s.tone}>{s.label}</StatusBadge> } },
    { key: 'uses', title: '使用次数', width: 120, render: (c) => (
      <CellText primary={c.maxUses === null ? `${c.usedCount} / 不限` : `${c.usedCount} / ${c.maxUses}`} secondary={c.maxUses === 1 ? '单次' : '多人复用'} />
    ) },
    { key: 'redeemedAt', title: '最近兑换', sortable: true, width: 160, render: (c) => (c.redeemedAt ? <CellText primary={c.redeemedBy ?? '—'} secondary={<CellDate value={c.redeemedAt} time />} /> : '—') },
    { key: 'codeExpiresAt', title: '有效期', sortable: true, width: 150, render: (c) => (c.codeExpiresAt
      ? <CellText primary={<CellDate value={c.codeExpiresAt} time />} secondary={expired(c) ? '已过期' : undefined} /> : '长期') },
    { key: 'createdAt', title: '创建 / 批次', sortable: true, width: 160, render: (c) => <CellText primary={<CellDate value={c.createdAt} time />} secondary={c.batchId ? `批次 ${c.batchId.slice(0, 8)}` : undefined} /> },
    { key: 'actions', title: '操作', kind: 'actions', render: (c) => (
      <RowActionBar label={`兑换码 ${c.code} 的更多操作`} actions={[
        { key: 'batch', label: '只看该批次', icon: <ListFilter />, disabled: !c.batchId, disabledReason: '这个码不属于任何批次', onSelect: () => c.batchId && onBatch(c.batchId) },
        { key: 'toggle', label: c.status === 'disabled' ? '启用' : '停用', icon: c.status === 'disabled' ? <CircleCheck /> : <Ban />,
          disabled: c.status === 'used', disabledReason: '已用完的码不能再启用或停用', onSelect: () => onToggle(c) },
        { key: 'delete', label: '删除', icon: <Trash2 />, destructive: true, onSelect: () => onDelete(c) },
      ]} />
    ) },
  ]
}

export function RedeemPage(_: PageProps) {
  const notify = useNotify()
  const plans = usePlans()
  const [batch, setBatch] = React.useState('')
  const list = useServerList<Code, { status: string; planId: string; lifetime: string }>('/v1/admin/redeem-codes', {
    filters: { status: '', planId: '', lifetime: '' },
    sort: { key: 'createdAt', direction: 'desc' },
    extra: { batchId: batch.trim() },
  })
  const [creating, setCreating] = React.useState(false)
  const [removing, setRemoving] = React.useState<Code | null>(null)
  const toggle = async (c: Code) => {
    const status = c.status === 'disabled' ? 'active' : 'disabled'
    try {
      await post(`/v1/admin/redeem-codes/${c.id}/status`, { status })
      notify(status === 'active' ? '已启用兑换码' : '已停用兑换码', 'success')
      list.refresh()
    } catch (e) { notify(errorText(e, '操作失败'), 'error') }
  }
  const columns = useColumns(setBatch, (c) => void toggle(c), setRemoving)

  return (
    <>
      <PageHeader title="兑换码" description="兑换码兑换后得到对应套餐的会员时长（同级叠加）。明码只在生成时显示一次。"
        actions={<Button size="sm" disabled={!plans.length} disabledReason="先建一个套餐" onClick={() => setCreating(true)}><Plus />批量生成</Button>} />
      <PageBody fill>
        <ResourcePanel title="兑换码" {...list.panel} unit="个"
          filters={
            <QueryBar {...list.queryBar} placeholder="搜索兑换码 / 备注">
              <Choice label="状态" size="sm" clearable placeholder="全部状态" value={list.query.filters.status} onChange={(v) => list.setFilter('status', v)} options={Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))} />
              <Choice label="套餐" size="sm" clearable placeholder="全部套餐" value={list.query.filters.planId} onChange={(v) => list.setFilter('planId', v)} options={plans.map((p) => ({ value: p.id, label: p.name }))} />
              <Choice label="时长" size="sm" clearable placeholder="全部时长" value={list.query.filters.lifetime} onChange={(v) => list.setFilter('lifetime', v)} options={[{ value: 'true', label: '永久' }, { value: 'false', label: '按天' }]} />
              <Input size="sm" width={220} mono aria-label="批次 ID" placeholder="批次 ID（精确）" clearable onClear={() => setBatch('')} value={batch} onChange={(e) => setBatch(e.target.value)} />
            </QueryBar>
          }>
          <DataTable caption="兑换码列表" columns={columns} rowKey={(c) => c.id} {...list.table} />
        </ResourcePanel>
      </PageBody>
      {creating && <RedeemCreate plans={plans} onClose={() => setCreating(false)} onCreated={list.refresh} onShowBatch={setBatch} />}
      <ConfirmDialog
        open={!!removing}
        title={`删除兑换码 ${removing?.code ?? ''}？`}
        tone="danger" destructive confirmLabel="删除"
        impact={['删除后不能恢复', '已被使用过的码服务端会拒绝删除，可以改为停用']}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          try {
            await del(`/v1/admin/redeem-codes/${removing.id}`)
            notify('兑换码已删除', 'success')
            list.refresh()
          } catch (e) { throw new Error(errorText(e, '删除失败')) }
        }}
      />
    </>
  )
}
