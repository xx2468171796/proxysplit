// 「公司员工」开关：只有员工账号登录的客户端才上报节点清单（docs/节点上报.md）。只有超级管理员能改，服务端同事务写审计。
import * as React from 'react'
import { Switch, errorText, useNotify } from '@ankotti/admin-ui'
import { patch } from '@/lib/api'

export function StaffSwitch({ userId, staff, canEdit, onChanged }: { userId: string; staff: boolean; canEdit: boolean; onChanged: () => void }) {
  const notify = useNotify()
  const [busy, setBusy] = React.useState(false)
  const change = (next: boolean) => {
    setBusy(true)
    patch(`/v1/admin/users/${userId}/staff`, { staff: next })
      .then(() => { notify(next ? '已设为公司员工' : '已取消公司员工', 'success'); onChanged() })
      .catch((e: unknown) => notify(errorText(e, '修改失败'), 'error'))
      .finally(() => setBusy(false))
  }
  return <Switch id={`staff-${userId}`} aria-label="公司员工" checked={staff} disabled={!canEdit || busy} onCheckedChange={change} />
}
