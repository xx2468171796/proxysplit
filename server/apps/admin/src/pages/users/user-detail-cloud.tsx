// 用户详情的「云端配置」「日志·审计」分区。云端配置只给元数据（不含配置内容、分享码、密码）。
import * as React from 'react'
import { CellDate, DataTable, DateTimeDisplay, DescriptionList, LogTimeline, Panel, StatePanel, StatusBadge, errorText, type Column } from '@ankotti/admin-ui'
import { JsonViewer } from '@ankotti/admin-ui/display'
import { get } from '@/lib/api'
import { bytes } from '@/lib/format'
import { auditActionLabel, auditResult, targetTypeLabel } from '../audit/labels'
import type { UserActivity, UserCloud, UserDetail } from './types'

type Profile = UserCloud['profiles'][number]
const profileColumns: Column<Profile>[] = [
  { key: 'name', title: '配置名', maxWidth: 220, mobile: 'primary', truncate: (p) => p.name, render: (p) => p.name },
  { key: 'device', title: '保存自', maxWidth: 180, truncate: (p) => p.deviceName, render: (p) => p.deviceName || '—' },
  { key: 'size', title: '大小', width: 90, numeric: true, render: (p) => bytes(p.size) },
  { key: 'shared', title: '分享', width: 90, render: (p) => (p.shared ? <StatusBadge tone="info">已分享</StatusBadge> : '未分享') },
  { key: 'locked', title: '恢复密码', width: 100, render: (p) => (p.locked ? <StatusBadge tone="brand">已设置</StatusBadge> : '未设置') },
  { key: 'updated', title: '更新时间', width: 150, render: (p) => <CellDate value={p.updatedAt} time /> },
]

export function CloudSection({ userId, active, member }: { userId: string; active: boolean; member: boolean }) {
  const [state, setState] = React.useState<{ data?: UserCloud; error?: string; loading: boolean }>({ loading: false })
  const [nonce, setNonce] = React.useState(0)
  const wanted = active || nonce > 0
  React.useEffect(() => {
    if (!wanted) return
    const ac = new AbortController()
    setState((s) => ({ ...s, loading: true }))
    get<UserCloud>(`/v1/admin/users/${userId}/cloud`, ac.signal)
      .then((data) => setState({ data, loading: false }))
      .catch((e: unknown) => { if (!ac.signal.aborted) setState({ loading: false, error: errorText(e, '云端配置加载失败') }) })
    return () => ac.abort()
  }, [userId, wanted, nonce])

  if (state.error) return <StatePanel kind="error" title="云端配置加载失败" message={state.error} onRetry={() => setNonce((n) => n + 1)} />
  const sync = state.data?.sync
  const note = member ? '会员：普通会员 1 份、超级会员 5 份命名配置' : '当前不是会员：云同步和云端配置不可用，已保存的仍保留'
  return (
    <>
      <Panel title="自动云同步" description={note}>
        {state.loading && !state.data ? <StatePanel kind="loading" title="正在加载" message="读取云同步元数据" />
          : sync ? <DescriptionList columns={2} items={[
            { label: '版本', value: `v${sync.version}` },
            { label: '大小', value: bytes(sync.size) },
            { label: '最后上传设备', value: sync.deviceName || '—' },
            { label: '更新时间', value: <DateTimeDisplay value={sync.updatedAt} /> },
          ]} />
          : <StatePanel kind="empty" title="还没有云同步数据" message="会员登录客户端后会自动上传一份加密配置。" />}
      </Panel>
      <Panel title="云端命名配置" count={state.data?.profiles.length}>
        <DataTable caption="云端命名配置" columns={profileColumns} rows={state.data?.profiles ?? []} rowKey={(p) => p.id}
          loading={state.loading && !state.data} pagination={{ mode: 'all' }} emptyLabel="没有保存过命名配置" />
      </Panel>
    </>
  )
}

export function LogsSection({ detail: d }: { detail: UserDetail }) {
  const actor = (a: UserActivity) => (a.action.startsWith('admin.') ? { name: '管理员' } : { name: d.user.username })
  return (
    <Panel title="最近 100 条操作" count={d.activity.length}>
      <LogTimeline<UserActivity>
        caption="用户相关审计"
        items={d.activity}
        getId={(a) => `${a.createdAt}-${a.action}-${a.targetId}`}
        time={(a) => a.createdAt}
        actor={actor}
        text={(a) => auditActionLabel(a.action)}
        target={(a) => `${targetTypeLabel(a.targetType)} ${a.targetId}`}
        result={(a) => { const r = auditResult(a.result); return { label: r.label, tone: r.tone === 'brand' || r.tone === 'info' ? 'neutral' : r.tone } }}
        detail={(a) => (a.metadata && Object.keys(a.metadata).length ? <JsonViewer value={a.metadata} label="附加信息" /> : null)}
        emptyLabel="没有相关操作记录"
      />
    </Panel>
  )
}
