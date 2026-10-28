// 设备（T02 资源列表页）：全部用户的设备，按平台 / 在线 / 解绑 / 版本筛选，解绑走确认框。
import * as React from 'react'
import { Unlink } from 'lucide-react'
import {
  CellDate, CellText, Choice, ConfirmDialog, DataTable, Input, PageBody, PageHeader, QueryBar, ResourcePanel,
  RowActionBar, StatusBadge, errorText, useNotify, type Column,
} from '@ankotti/admin-ui'
import { del } from '@/lib/api'
import { useServerList } from '@/lib/list'
import { PLATFORM, isOnline, options, platform } from '@/lib/format'
import { UserLink } from '@/components/user-link'
import type { PageProps } from '@/shell/workspace-context'

export type DeviceRow = {
  id: string; userId: string; username: string; name: string; platform: string; appVersion: string
  revoked: boolean; firstSeenAt: string; lastSeenAt: string
}

export function deviceState(d: Pick<DeviceRow, 'revoked' | 'lastSeenAt'>) {
  if (d.revoked) return { label: '已解绑', tone: 'neutral' as const }
  return isOnline(d.lastSeenAt) ? { label: '在线', tone: 'success' as const } : { label: '离线', tone: 'neutral' as const }
}

export function DevicesPage(_: PageProps) {
  const notify = useNotify()
  const [version, setVersion] = React.useState('')
  const list = useServerList<DeviceRow, { platform: string; online: string; revoked: string }>('/v1/admin/devices', {
    filters: { platform: '', online: '', revoked: '' },
    sort: { key: 'lastSeenAt', direction: 'desc' },
    extra: { appVersion: version.trim() },
  })
  const [target, setTarget] = React.useState<DeviceRow | null>(null)

  const columns: Column<DeviceRow>[] = [
    { key: 'name', title: '设备', sortable: true, maxWidth: 260, mobile: 'primary', truncate: (d) => d.name,
      render: (d) => <CellText primary={d.name} secondary={platform(d.platform)} /> },
    { key: 'username', title: '所属用户', sortable: true, width: 160, render: (d) => <UserLink id={d.userId} name={d.username} /> },
    { key: 'platform', title: '平台', sortable: true, width: 100, render: (d) => platform(d.platform) },
    { key: 'appVersion', title: '版本', sortable: true, width: 100, render: (d) => d.appVersion || '—' },
    { key: 'status', title: '状态', width: 96, render: (d) => { const s = deviceState(d); return <StatusBadge tone={s.tone}>{s.label}</StatusBadge> } },
    { key: 'firstSeenAt', title: '首次上线', sortable: true, width: 150, render: (d) => <CellDate value={d.firstSeenAt} time /> },
    { key: 'lastSeenAt', title: '最近活跃', sortable: true, width: 150, render: (d) => <CellDate value={d.lastSeenAt} time /> },
    { key: 'actions', title: '操作', kind: 'actions', render: (d) => (
      <RowActionBar label={`${d.name}的更多操作`} actions={[
        { key: 'unbind', label: '解绑', icon: <Unlink />, destructive: true, menuOnly: false, disabled: d.revoked, disabledReason: '已经解绑', onSelect: () => setTarget(d) },
      ]} />
    ) },
  ]

  return (
    <>
      <PageHeader title="设备" description="所有用户登录过的设备。15 分钟内有心跳算在线；解绑后该设备的会话立即失效，用户需重新登录。" />
      <PageBody fill>
        <ResourcePanel title="设备" {...list.panel} unit="台"
          filters={
            <QueryBar {...list.queryBar} placeholder="搜索设备名 / 用户名">
              <Choice label="平台" size="sm" clearable placeholder="全部平台" value={list.query.filters.platform} onChange={(v) => list.setFilter('platform', v)} options={options(PLATFORM)} />
              <Choice label="在线" size="sm" clearable placeholder="在线与离线" value={list.query.filters.online} onChange={(v) => list.setFilter('online', v)} options={[{ value: 'true', label: '在线' }, { value: 'false', label: '离线' }]} />
              <Choice label="解绑" size="sm" clearable placeholder="全部绑定状态" value={list.query.filters.revoked} onChange={(v) => list.setFilter('revoked', v)} options={[{ value: 'false', label: '未解绑' }, { value: 'true', label: '已解绑' }]} />
              <Input size="sm" width={140} aria-label="版本号" placeholder="版本号（精确）" clearable onClear={() => setVersion('')} value={version} onChange={(e) => setVersion(e.target.value)} />
            </QueryBar>
          }>
          <DataTable caption="设备列表" columns={columns} rowKey={(d) => d.id} {...list.table} />
        </ResourcePanel>
      </PageBody>
      <ConfirmDialog
        open={!!target}
        title={`解绑设备「${target?.name ?? ''}」？`}
        tone="danger"
        destructive
        confirmLabel="解绑"
        impact={[`所属用户：${target?.username ?? ''}`, '该设备上的会话立即失效，用户需重新登录并重新占用设备名额']}
        onClose={() => setTarget(null)}
        onConfirm={async () => {
          if (!target) return
          try {
            await del(`/v1/admin/devices/${target.id}`)
            notify('已解绑设备', 'success')
            list.refresh()
          } catch (e) {
            throw new Error(errorText(e, '解绑失败'))
          }
        }}
      />
    </>
  )
}
