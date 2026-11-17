// 代理商列表：品牌 / 客服微信（从 aigw 拉取）、分成比例（本地，可改）、客户数、实付合计、待结算 / 已结算分成。
import * as React from 'react'
import { ListFilter, Pencil, UserCheck } from 'lucide-react'
import {
  CellDate, CellText, DataTable, FormDialog, FormField, Input, MoneyDisplay, ResourcePanel, RowActionBar, StatusBadge,
  useNotify, type Column,
} from '@ankotti/admin-ui'
import { patch, put } from '@/lib/api'
import { useServerList } from '@/lib/list'
import { minor } from '@/lib/format'
import { parsePct, pct, type Dealer } from './shared'

export function DealersTab({ onOpenLedger }: { onOpenLedger: (slug: string) => void }) {
  const list = useServerList<Dealer, Record<string, string>>('/v1/admin/dealers', { filters: {} })
  const [edit, setEdit] = React.useState<Dealer | null>(null)
  const [owners, setOwners] = React.useState<Dealer | null>(null)
  const columns: Column<Dealer>[] = [
    { key: 'slug', title: '代理商', maxWidth: 220, mobile: 'primary', render: (d) => (
      <CellText primary={d.brand || d.slug} secondary={`${d.slug}.claude.zygskins.cn`} />) },
    { key: 'contact', title: '客服微信', width: 140, render: (d) => d.contact || '—' },
    { key: 'enabled', title: 'aigw 状态', width: 130, render: (d) => (
      <CellText primary={<StatusBadge tone={d.enabled ? 'success' : 'neutral'}>{d.enabled ? '启用' : (d.fetchedAt ? '停用' : '未拉取')}</StatusBadge>}
        secondary={d.fetchedAt ? <CellDate value={d.fetchedAt} time /> : undefined} />) },
    { key: 'bps', title: '分成比例', width: 100, numeric: true, render: (d) => pct(d.commissionBps) },
    { key: 'customers', title: '客户', width: 80, numeric: true, render: (d) => d.customers },
    { key: 'gross', title: '实付合计（元）', width: 130, numeric: true, render: (d) => <MoneyDisplay value={minor(d.grossCents)} /> },
    { key: 'pending', title: '待结算（元）', width: 120, numeric: true, render: (d) => <MoneyDisplay value={minor(d.pendingCents)} /> },
    { key: 'review', title: '待复核（元）', width: 120, numeric: true, render: (d) => <MoneyDisplay value={minor(d.reviewCents ?? 0)} /> },
    { key: 'settled', title: '已结算（元）', width: 120, numeric: true, render: (d) => <MoneyDisplay value={minor(d.settledCents)} /> },
    { key: 'actions', title: '操作', kind: 'actions', render: (d) => (
      <RowActionBar label={`代理商 ${d.slug} 的更多操作`} actions={[
        { key: 'bps', label: '改比例', icon: <Pencil />, onSelect: () => setEdit(d) },
        { key: 'owners', label: '本人账号', icon: <UserCheck />, onSelect: () => setOwners(d) },
        { key: 'ledger', label: '看流水', icon: <ListFilter />, onSelect: () => onOpenLedger(d.slug) },
      ]} />
    ) },
  ]
  return (
    <>
      <ResourcePanel title="代理商" {...list.panel} unit="个"
        description="代理商资料从 AI 中转站拉取（最多 10 分钟一次）；分成比例只在这里设，改了只影响之后的订单。停用的代理商，新订单不再记分成。">
        <DataTable caption="代理商" columns={columns} rowKey={(d) => d.slug} {...list.table} />
      </ResourcePanel>
      {edit && <BpsDialog dealer={edit} onClose={() => setEdit(null)} onDone={list.refresh} />}
      {owners && <OwnersDialog dealer={owners} onClose={() => setOwners(null)} onDone={list.refresh} />}
    </>
  )
}

function OwnersDialog({ dealer, onClose, onDone }: { dealer: Dealer; onClose: () => void; onDone: () => void }) {
  const notify = useNotify()
  const initial = (dealer.ownerUsernames ?? []).join('，')
  const [v, setV] = React.useState(initial)
  return (
    <FormDialog open title={`${dealer.brand || dealer.slug} 本人的账号`}
      description="填代理商自己在用的 ProxySplit 用户名。买家和这些账号同一台设备或同一个注册来源时，那笔分成先进「待复核」，不直接算应付。只影响之后的订单。"
      dirty={v !== initial} submitLabel="保存" onClose={onClose}
      onSubmit={async () => {
        const usernames = v.split(/[\s,，、]+/).map((x) => x.trim()).filter(Boolean)
        if (usernames.length > 10) throw new Error('最多填 10 个用户名')
        await put(`/v1/admin/dealers/${dealer.slug}/owners`, { usernames })
        notify(usernames.length ? `已保存 ${usernames.length} 个账号` : '已清空', 'success')
        onDone()
        onClose()
      }}>
      <FormField label="用户名" htmlFor="dealer-owners" hint="多个用逗号或空格分开，最多 10 个；留空 = 清空">
        <Input id="dealer-owners" value={v} placeholder="例如 wen_boss" onChange={(e) => setV(e.target.value)} />
      </FormField>
    </FormDialog>
  )
}

function BpsDialog({ dealer, onClose, onDone }: { dealer: Dealer; onClose: () => void; onDone: () => void }) {
  const notify = useNotify()
  const initial = String(dealer.commissionBps / 100)
  const [v, setV] = React.useState(initial)
  return (
    <FormDialog open title={`${dealer.brand || dealer.slug} 的分成比例`} description="按客户实付金额算；已记下的流水保留当时的比例。"
      dirty={v !== initial} submitLabel="保存" onClose={onClose}
      onSubmit={async () => {
        const bps = parsePct(v)
        if (bps === null) throw new Error('填 0–100 的百分数，最多两位小数')
        await patch(`/v1/admin/dealers/${dealer.slug}`, { commissionBps: bps })
        notify(`已改为 ${pct(bps)}`, 'success')
        onDone()
        onClose()
      }}>
      <FormField label="分成比例（%）" htmlFor="dealer-bps" required hint="例如 30 表示 30%">
        <Input id="dealer-bps" value={v} inputMode="decimal" onChange={(e) => setV(e.target.value)} />
      </FormField>
    </FormDialog>
  )
}
