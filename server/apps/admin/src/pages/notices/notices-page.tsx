// 通知与公告：公司统一通知包 tongzhi 的整块后台（通知列表 / 发通知 / 定向发送）。老「公告」已迁进来。
import { createTongzhiAdminClient } from 'tongzhi/client'
import { NoticeAdmin } from 'tongzhi/react/admin'
import 'tongzhi/react/styles.css'
import 'tongzhi/react/admin.css'
import { PageBody } from '@ankotti/admin-ui'
import { apiBase, authHeaders } from '@/lib/api'
import type { PageProps } from '@/shell/workspace-context'

const api = createTongzhiAdminClient({ base: `${apiBase}/v1/admin/tongzhi`, headers: authHeaders })

export function NoticesPage(_: PageProps) {
  return (
    <PageBody>
      <NoticeAdmin api={api} theme="light" audienceHints={{ tiers: '会员档位：free / trial / standard / premium' }} />
    </PageBody>
  )
}
