// 表格里的用户名：点开用户详情工作标签（新标签页打开也能直接到 /admin/users/<id>）。
import { Link } from '@ankotti/admin-ui'
import { useWorkspace } from '@/shell/workspace-context'

export function UserLink({ id, name }: { id: string | null | undefined; name: string | null | undefined }) {
  const ws = useWorkspace()
  if (!id || !name) return <>{name || '—'}</>
  return (
    <Link
      href={`/admin/users/${id}`}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return
        e.preventDefault()
        ws.openUser(id, name)
      }}
    >
      {name}
    </Link>
  )
}
