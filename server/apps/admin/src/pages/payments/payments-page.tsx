// 支付通道（T03 指标 + 列表）：当前收款通道与支付方式一排，下面是通道表；新增 / 编辑、设为当前收款。
import * as React from 'react'
import { Pencil, Plus, Zap } from 'lucide-react'
import {
  Button, CellDate, CellText, ConfirmDialog, DataTable, PageBody, PageHeader, ResourcePanel, RowActionBar, StatStrip,
  StatusBadge, errorText, useNotify, type Column,
} from '@ankotti/admin-ui'
import { get, post } from '@/lib/api'
import type { PageProps } from '@/shell/workspace-context'
import { ProviderDialog, adapterLabel, type Provider } from './provider-dialog'

type Commerce = { activePaymentProvider: string; paymentMethods: string[] }
const METHOD: Record<string, string> = { alipay: '支付宝', wechat: '微信支付' }

function usePayments() {
  const [providers, setProviders] = React.useState<Provider[] | null>(null)
  const [commerce, setCommerce] = React.useState<Commerce | null>(null)
  const [error, setError] = React.useState<string | undefined>()
  const load = React.useCallback(async () => {
    try {
      const [p, c] = await Promise.all([get<{ items: Provider[] }>('/v1/admin/payment-providers'), get<Commerce>('/v1/admin/settings/commerce')])
      setProviders(p.items); setCommerce(c); setError(undefined)
    } catch (e) { setError(errorText(e, '支付通道加载失败')) }
  }, [])
  React.useEffect(() => { void load() }, [load])
  return { providers, commerce, error, load }
}

export function PaymentsPage(_: PageProps) {
  const notify = useNotify()
  const { providers, commerce, error, load } = usePayments()
  const [editing, setEditing] = React.useState<Provider | 'new' | null>(null)
  const [activating, setActivating] = React.useState<Provider | null>(null)
  const active = commerce?.activePaymentProvider ?? ''
  const current = providers?.find((p) => p.code === active)

  const columns: Column<Provider>[] = [
    { key: 'name', title: '通道', maxWidth: 240, mobile: 'primary', render: (p) => <CellText primary={p.displayName} secondary={p.code} /> },
    { key: 'status', title: '状态', width: 150, render: (p) => <>
      <StatusBadge tone={p.enabled ? 'success' : 'neutral'}>{p.enabled ? '启用' : '停用'}</StatusBadge>
      {p.code === active ? <StatusBadge tone="brand" variant="soft">当前收款</StatusBadge> : null}
    </> },
    { key: 'adapter', title: '适配器', width: 120, render: (p) => adapterLabel(p.adapter) },
    { key: 'endpoint', title: '接口地址', maxWidth: 260, truncate: (p) => p.endpoint || '—', render: (p) => p.endpoint || '—' },
    { key: 'merchant', title: '商户号 / 凭据', maxWidth: 220, mobile: 'meta', render: (p) => <CellText primary={p.merchantId || '—'} secondary={p.credentialRef || '未配置凭据引用'} /> },
    { key: 'timeout', title: '订单超时', width: 96, numeric: true, render: (p) => `${Number(p.config?.orderTimeoutMinutes ?? 10)} 分钟` },
    { key: 'updatedAt', title: '更新时间', width: 150, render: (p) => <CellDate value={p.updatedAt} time /> },
    { key: 'actions', title: '操作', kind: 'actions', render: (p) => (
      <RowActionBar label={`${p.displayName}的更多操作`} actions={[
        { key: 'edit', label: '编辑', icon: <Pencil />, onSelect: () => setEditing(p) },
        { key: 'activate', label: '设为当前收款', icon: <Zap />, disabled: !p.enabled || p.code === active,
          disabledReason: p.code === active ? '已经是当前收款通道' : '先启用这个通道', onSelect: () => setActivating(p) },
      ]} />
    ) },
  ]

  return (
    <>
      <PageHeader title="支付通道" description="收款通道配置。只保存凭据引用名，真实密钥放在服务器环境变量里。"
        actions={<Button size="sm" onClick={() => setEditing('new')}><Plus />新增通道</Button>} />
      <PageBody>
        <StatStrip title="收款概况" items={[
          { key: 'active', label: '当前收款通道', value: current?.displayName ?? (active || null), note: current && !current.enabled ? '该通道已停用，用户无法下单' : current?.code, ...(current && !current.enabled ? { noteTone: 'danger' as const } : {}) },
          { key: 'methods', label: '支付方式', value: commerce ? commerce.paymentMethods.map((m) => METHOD[m] ?? m).join('、') || '—' : null },
          { key: 'enabled', label: '已启用通道', value: providers ? providers.filter((p) => p.enabled).length : null, unit: '个', note: providers ? `共 ${providers.length} 个` : undefined },
        ]} />
        <ResourcePanel title="通道" {...(providers ? { count: providers.length } : {})} unit="个">
          <DataTable caption="支付通道" columns={columns} rowKey={(p) => p.code} rows={providers ?? []} loading={!providers && !error}
            {...(error ? { error } : {})} onRetry={() => void load()} pagination={{ mode: 'all' }} />
        </ResourcePanel>
      </PageBody>
      {editing && <ProviderDialog provider={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />}
      <ConfirmDialog
        open={!!activating}
        title={`把「${activating?.displayName ?? ''}」设为当前收款通道？`}
        tone="warning"
        confirmLabel="切换"
        impact={['之后新下的订单都走这个通道；已创建的待支付订单不受影响']}
        onClose={() => setActivating(null)}
        onConfirm={async () => {
          if (!activating) return
          try {
            await post(`/v1/admin/payment-providers/${encodeURIComponent(activating.code)}/activate`)
            notify('已切换收款通道', 'success')
            void load()
          } catch (e) { throw new Error(errorText(e, '切换失败')) }
        }}
      />
    </>
  )
}
