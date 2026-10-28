// 套餐（T02 资源列表页）：筛选等级 / 周期 / 上架 / 公开，新建、编辑、删除（被引用时服务端拒绝，改用下架）。
import * as React from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import {
  Button, CellDate, CellText, Choice, ConfirmDialog, DataTable, MoneyDisplay, PageBody, PageHeader, QueryBar, ResourcePanel,
  RowActionBar, StatusBadge, errorText, useNotify, type Column,
} from '@ankotti/admin-ui'
import { del } from '@/lib/api'
import { useServerList } from '@/lib/list'
import { CYCLE, cycle, minor, options, tier } from '@/lib/format'
import type { PageProps } from '@/shell/workspace-context'
import { PLAN_TIERS, PlanDialog, type Plan } from './plan-dialog'

const YES_NO = (yes: string, no: string) => [{ value: 'true', label: yes }, { value: 'false', label: no }]

export function PlansPage(_: PageProps) {
  const notify = useNotify()
  const list = useServerList<Plan, { tier: string; billingCycle: string; active: string; public: string }>('/v1/admin/plans', {
    filters: { tier: '', billingCycle: '', active: '', public: '' },
    sort: { key: 'sortOrder', direction: 'asc' },
  })
  const [editing, setEditing] = React.useState<Plan | 'new' | null>(null)
  const [removing, setRemoving] = React.useState<Plan | null>(null)

  const columns: Column<Plan>[] = [
    { key: 'name', title: '名称', sortable: true, maxWidth: 240, mobile: 'primary', render: (p) => <CellText primary={p.badge ? `${p.name} · ${p.badge}` : p.name} secondary={p.code} /> },
    { key: 'tier', title: '等级', sortable: true, width: 96, render: (p) => { const t = tier(p.tier); return <StatusBadge tone={t.tone} variant="soft">{t.label}</StatusBadge> } },
    { key: 'cycle', title: '周期', width: 110, render: (p) => (p.lifetime ? '永久' : `${cycle(p.billingCycle)} · ${p.durationDays ?? '—'} 天`) },
    { key: 'priceCents', title: '价格', sortable: true, numeric: true, width: 130, render: (p) => (
      <CellText primary={<MoneyDisplay value={minor(p.priceCents)} />} secondary={p.originalPriceCents ? <>原价 <MoneyDisplay value={minor(p.originalPriceCents)} /></> : undefined} />
    ) },
    { key: 'maxDevices', title: '设备数', numeric: true, width: 80, render: (p) => `${p.maxDevices} 台` },
    { key: 'features', title: '权益', width: 80, mobile: 'hidden', render: (p) => `${p.features.length} 项`, detail: (p) => p.features.join('、') || '—' },
    { key: 'status', title: '状态', width: 150, render: (p) => <>
      <StatusBadge tone={p.active ? 'success' : 'neutral'}>{p.active ? '上架' : '下架'}</StatusBadge>
      <StatusBadge tone={p.public ? 'info' : 'neutral'} variant="soft">{p.public ? '公开' : '隐藏'}</StatusBadge>
    </> },
    { key: 'sortOrder', title: '排序', sortable: true, numeric: true, width: 72, render: (p) => p.sortOrder },
    { key: 'updatedAt', title: '更新时间', sortable: true, width: 150, render: (p) => <CellDate value={p.updatedAt} time /> },
    { key: 'actions', title: '操作', kind: 'actions', render: (p) => (
      <RowActionBar label={`${p.name}的更多操作`} actions={[
        { key: 'edit', label: '编辑', icon: <Pencil />, onSelect: () => setEditing(p) },
        { key: 'delete', label: '删除', icon: <Trash2 />, destructive: true, onSelect: () => setRemoving(p) },
      ]} />
    ) },
  ]

  return (
    <>
      <PageHeader title="套餐" description="会员套餐。用户设备上限 = 免费名额 + 套餐设备数；已被订单、授权或兑换码引用的套餐不能删除，请改为下架。"
        actions={<Button size="sm" onClick={() => setEditing('new')}><Plus />新建套餐</Button>} />
      <PageBody fill>
        <ResourcePanel title="套餐" {...list.panel} unit="个"
          filters={
            <QueryBar {...list.queryBar} placeholder="搜索名称 / 编码">
              <Choice label="等级" size="sm" clearable placeholder="全部等级" value={list.query.filters.tier} onChange={(v) => list.setFilter('tier', v)} options={PLAN_TIERS} />
              <Choice label="周期" size="sm" clearable placeholder="全部周期" value={list.query.filters.billingCycle} onChange={(v) => list.setFilter('billingCycle', v)} options={options(CYCLE)} />
              <Choice label="上架" size="sm" clearable placeholder="上架与下架" value={list.query.filters.active} onChange={(v) => list.setFilter('active', v)} options={YES_NO('上架', '下架')} />
              <Choice label="公开" size="sm" clearable placeholder="公开与隐藏" value={list.query.filters.public} onChange={(v) => list.setFilter('public', v)} options={YES_NO('公开', '隐藏')} />
            </QueryBar>
          }>
          <DataTable caption="套餐列表" columns={columns} rowKey={(p) => p.id} {...list.table} />
        </ResourcePanel>
      </PageBody>
      {editing && <PlanDialog plan={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.refresh() }} />}
      <ConfirmDialog
        open={!!removing}
        title={`删除套餐「${removing?.name ?? ''}」？`}
        tone="danger" destructive confirmLabel="删除"
        impact={['删除后不能恢复', '已被订单 / 授权 / 兑换码引用时服务端会拒绝，请改为下架']}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          try {
            await del(`/v1/admin/plans/${removing.id}`)
            notify('套餐已删除', 'success')
            list.refresh()
          } catch (e) { throw new Error(errorText(e, '删除失败')) }
        }}
      />
    </>
  )
}
