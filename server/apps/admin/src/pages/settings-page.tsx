import { StatePanel } from '@ankotti/admin-ui'
import type { PageProps } from '@/shell/workspace-context'

export function SettingsPage(_: PageProps) {
  return <StatePanel kind="empty" title="待重做" message="SettingsPage" />
}
