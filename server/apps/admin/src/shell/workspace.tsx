// 后台外壳：AdminShell + 按需打开的工作标签（首页固定），地址栏同步 /admin/<页> 与 /admin/users/<id>。
import * as React from 'react'
import { UserRound } from 'lucide-react'
import { AdminShell, AppearanceButton, CommandPalette, ContentSkeleton, navCommands, type WorkspaceItem } from '@ankotti/admin-ui'
import { logout } from '@/lib/api'
import { NAVIGATION, PAGES, UserDetailPage } from './pages'
import { WorkspaceContext, type PageParams, type WorkspaceApi } from './workspace-context'

type Tab = { id: string; params?: PageParams; title?: string }
const HOME = 'overview'
const BASE = '/admin/'

function tabFromPath(pathname: string): Tab {
  const rest = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname.replace(/^\//, '')
  const [first = '', second] = rest.split('/')
  if (first === 'users' && second) return { id: `user:${second}`, title: '用户详情' }
  return { id: PAGES[first] ? first : HOME }
}
const pathOf = (id: string) => (id.startsWith('user:') ? `${BASE}users/${id.slice(5)}` : id === HOME ? BASE : BASE + id)

export function Workspace({ username }: { username: string }) {
  const [tabs, setTabs] = React.useState<Tab[]>(() => {
    const first = tabFromPath(location.pathname)
    return first.id === HOME ? [{ id: HOME }] : [{ id: HOME }, first]
  })
  const [activeId, setActiveId] = React.useState(() => tabFromPath(location.pathname).id)

  React.useEffect(() => {
    const next = pathOf(activeId)
    if (location.pathname !== next) history.replaceState(null, '', next + location.search)
  }, [activeId])

  const api = React.useMemo<WorkspaceApi>(() => ({
    openPage: (id, params) => {
      setTabs((list) => (list.some((t) => t.id === id)
        ? list.map((t) => (t.id === id && params ? { ...t, params } : t))
        : [...list, { id, ...(params ? { params } : {}) }]))
      setActiveId(id)
    },
    openUser: (userId, name) => {
      const id = `user:${userId}`
      setTabs((list) => (list.some((t) => t.id === id) ? list : [...list, { id, title: name }]))
      setActiveId(id)
    },
    close: (id) => closeTabs([id]),
  }), [])

  const closeTabs = (ids: readonly string[]) => {
    setTabs((list) => {
      const next = list.filter((t) => t.id === HOME || !ids.includes(t.id))
      setActiveId((cur) => (ids.includes(cur) ? next[next.length - 1]?.id ?? HOME : cur))
      return next
    })
  }

  const items: WorkspaceItem[] = tabs.map((t) => {
    const nav = NAVIGATION.find((n) => n.id === t.id)
    const active = t.id === activeId
    if (t.id.startsWith('user:')) {
      return {
        id: t.id, title: t.title ?? '用户详情', icon: UserRound, crumbs: [{ label: '用户与会员' }],
        content: <React.Suspense fallback={<ContentSkeleton rows={6} />}><UserDetailPage userId={t.id.slice(5)} active={active} /></React.Suspense>,
      }
    }
    const Page = PAGES[t.id]
    return {
      id: t.id, title: nav?.title ?? t.id, icon: nav?.icon ?? UserRound, pinned: t.id === HOME, closable: t.id !== HOME,
      content: Page ? <React.Suspense fallback={<ContentSkeleton rows={6} />}><Page active={active} params={t.params} /></React.Suspense> : null,
    }
  })

  return (
    <WorkspaceContext.Provider value={api}>
      <AdminShell
        brand="ProxySplit"
        logo="P"
        crumbRoot="运营后台"
        navigation={NAVIGATION}
        tabs={items}
        activeId={activeId}
        onNavigate={(id) => api.openPage(id)}
        onCloseTab={(id) => closeTabs([id])}
        onCloseTabs={closeTabs}
        documentTitle={(t) => `${t} · ProxySplit 运营后台`}
        account={{ name: username, role: '管理员' }}
        onSignOut={logout}
        globalShortcut
        headerActions={<>
          <CommandPalette commands={navCommands(NAVIGATION, (id) => api.openPage(id))} />
          <AppearanceButton />
        </>}
      />
    </WorkspaceContext.Provider>
  )
}
