import { StatePanel } from '@ankotti/admin-ui'

export function UserDetailPage(_: { userId: string; active: boolean }) {
  return <StatePanel kind="empty" title="待重做" message="UserDetailPage" />
}
